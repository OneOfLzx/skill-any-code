import http from 'http';
import { AddressInfo } from 'net';

type MockOpenAIOptions = {
  /**
   * If provided, always return this JSON object as the model content (stringified).
   * Otherwise, a generic FileAnalysis-like JSON will be returned.
   */
  fixedContent?: Record<string, any>;
  /**
   * If provided, choose response content dynamically by request body / index.
   * This is useful for multi-step prompt protocols where each step expects a different JSON shape.
   */
  dynamicContent?: (args: { bodyStr: string; requestIndex: number }) => Record<string, any> | undefined;
  /**
   * 1-based request indices that should return 5xx (e.g. [2] = second LLM request returns 500).
   * Used for ST-LLM-PARTIAL-FAIL-001.
   */
  failRequestIndices?: number[];
  /**
   * 若提供，则请求 body 内容（字符串）包含任一子串时返回 500。用于按路径确定性失败（如 two.ts）。
   */
  failRequestBodyIncludes?: string[];
};

export async function startMockOpenAIServer(options: MockOpenAIOptions = {}) {
  let requestCount = 0;
  const failRequestIndices = new Set(options.failRequestIndices ?? []);
  const failRequestBodyIncludes = options.failRequestBodyIncludes ?? [];

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url || req.method !== 'POST') {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      // OpenAI SDK with baseURL ".../v1" will call "/chat/completions"
      if (!req.url.endsWith('/chat/completions')) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      const chunks: Buffer[] = [];
      await new Promise<void>((resolve) => {
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve());
      });
      const bodyStr = Buffer.concat(chunks).toString('utf-8');

      requestCount += 1;
      if (failRequestIndices.has(requestCount)) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'mock server error (injected)' }));
        return;
      }
      if (failRequestBodyIncludes.some((s) => bodyStr.includes(s))) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'mock server error (path-injected)' }));
        return;
      }

      const dynamic =
        options.dynamicContent?.({ bodyStr, requestIndex: requestCount }) ??
        undefined;

      // 默认情况下，根据多步协议提示自动返回对应 JSON 形状，避免“提示要求 {summary}/{description} 但 mock 返回 FileAnalysis”导致解析失败。
      const autoContent = (() => {
        // 目录/文件的 description 步：只需要 {"description": "..."}
        // 注意：不要用裸 '{"description"' 匹配，很多提示会包含示例 schema，可能误命中。
        if (
          bodyStr.includes('只返回一个 JSON对象：{"description"') ||
          bodyStr.includes('只返回一个 JSON 对象：{"description"')
        ) {
          return { description: 'mock description' };
        }
        // 文件/目录的 summary 步：只需要 {"summary": "..."}
        // 同理，不要用裸 '{"summary"' 匹配，避免误命中 schema。
        if (
          bodyStr.includes('只返回一个JSON对象：{"summary"') ||
          bodyStr.includes('只返回一个 JSON 对象：{"summary"')
        ) {
          return { summary: 'mock summary' };
        }
        // 文件结构/分片/合并结构步：只需要 classes/functions
        if (bodyStr.includes('仅提取') || bodyStr.includes('需要返回的JSON结构如下') || bodyStr.includes('返回的JSON结构（仅包含以下字段）')) {
          return { classes: [], functions: [] };
        }
        return undefined;
      })();

      const contentObj =
        options.fixedContent ??
        dynamic ??
        autoContent ??
        ({
          // 兜底：尽可能包含常用字段，且不依赖严格 schema
          classes: [],
          functions: [],
          summary: 'mock summary',
          description: 'mock description',
        } satisfies Record<string, any>);

      const responseBody = {
        id: 'mock-chatcmpl-1',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'mock-model',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify(contentObj),
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(responseBody));
    } catch (e: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e?.message || 'mock server error' }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}

