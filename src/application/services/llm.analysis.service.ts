import type { ILLMClient, IFileSplitter, IAnalysisCache } from '../../domain/interfaces';
import type { FileAnalysis, LLMConfig, FileChunkAnalysis } from '../../common/types';
import {
  FILE_STRUCTURE_PROMPT,
  FILE_DESCRIPTION_PROMPT,
  FILE_SUMMARY_PROMPT,
  PARSE_RETRY_HINT,
  CHUNK_ANALYSIS_PROMPT,
  MERGE_STRUCTURE_PROMPT,
  DIRECTORY_DESCRIPTION_PROMPT,
  DIRECTORY_SUMMARY_PROMPT
} from '../../infrastructure/llm/prompt.template';
import Mustache from 'mustache';
import { AppError, ErrorCode } from '../../common/errors';
import { FileHashCache } from '../../infrastructure/cache/file.hash.cache';
import path from 'path';

function truncateByCodePoints(input: string, maxCodePoints: number): string {
  const cps = Array.from(input)
  if (cps.length <= maxCodePoints) return input
  return cps.slice(0, maxCodePoints).join('')
}

export class LLMAnalysisService {
  private llmClient: ILLMClient;
  private fileSplitter: IFileSplitter;
  private cache: IAnalysisCache;
  private config: LLMConfig;

  constructor(
    llmClient: ILLMClient,
    fileSplitter: IFileSplitter,
    cache: IAnalysisCache,
    config: LLMConfig
  ) {
    this.llmClient = llmClient;
    this.fileSplitter = fileSplitter;
    this.cache = cache;
    this.config = config;
  }

  async analyzeFile(filePath: string, fileContent: string, fileHash: string): Promise<FileAnalysis> {
    // 先查缓存
    if (this.config.cache_enabled) {
      const cachedResult = await this.cache.get(fileHash);
      if (cachedResult) {
        cachedResult.path = filePath;
        cachedResult.lastAnalyzedAt = new Date().toISOString();
        return cachedResult;
      }
    }

    let result: FileAnalysis;

    // 基于“字符长度（code points）”判断是否需要切片
    const fileCharLen = Array.from(fileContent).length
    if (fileCharLen > this.config.context_window_size) {
      result = await this.analyzeLargeFile(filePath, fileContent)
    } else {
      result = await this.analyzeSmallFile(filePath, fileContent)
    }

    // 保存缓存
    if (this.config.cache_enabled) {
      await this.cache.set(fileHash, result);
    }

    result.path = filePath;
    result.lastAnalyzedAt = new Date().toISOString();
    return result;
  }

  /** 三步协议（需求 10.5.3 / 10.9.1）：结构 → 功能描述 → 概述，程序组装为完整 FileAnalysis；某次解析失败仅重试当次（10.9.2）。 */
  private async analyzeSmallFile(filePath: string, fileContent: string): Promise<FileAnalysis> {
    const opts = { temperature: 0.1 }

    // Step 1: Symbols（松散 Markdown / 纯文本输出；不做 JSON 校验）
    const symbolsPrompt = Mustache.render(FILE_STRUCTURE_PROMPT, { filePath, fileContent })
    const symbolsRes = await this.llmClient.call(symbolsPrompt, opts)
    const symbols = symbolsRes.content?.trim() ?? ''

    // Step 2: Description（整文件 raw text）
    const descPrompt = Mustache.render(FILE_DESCRIPTION_PROMPT, { filePath, fileContent })
    const descRes = await this.llmClient.call(descPrompt, opts)
    const description = descRes.content?.trim() ?? ''

    // Step 3: Summary（Symbols + Description，简单拼接输入；不做 JSON 校验）
    const summaryPrompt = Mustache.render(FILE_SUMMARY_PROMPT, { symbols, description })
    const summaryRes = await this.llmClient.call(summaryPrompt, opts)
    const summary = summaryRes.content?.trim() ?? ''

    const name = path.basename(filePath)
    const language = this.detectLanguage(filePath)
    const linesOfCode = fileContent.split(/\r?\n/).length

    return {
      type: 'file',
      path: filePath,
      name,
      language,
      linesOfCode,
      dependencies: [],
      description,
      summary,
      symbols,
      // 新流水线以 Symbols 为主，不再依赖结构 JSON；保留字段以兼容类型。
      classes: [],
      functions: [],
      lastAnalyzedAt: new Date().toISOString(),
      commitHash: '',
    }
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'TypeScript';
      case '.js':
      case '.jsx':
        return 'JavaScript';
      case '.py':
        return 'Python';
      case '.java':
        return 'Java';
      case '.go':
        return 'Go';
      case '.cs':
        return 'C#';
      default:
        return '';
    }
  }

  /** 单次调用：解析失败则仅重试该次一次，不重做已成功步骤（需求 10.9.2）。 */
  private async callWithParseRetry<T>(
    prompt: string,
    options: { temperature?: number },
    parseFn: (content: string) => T
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.llmClient.call(
          attempt === 1 ? prompt + PARSE_RETRY_HINT : prompt,
          { ...options, retries: 0 }
        );
        return parseFn(response.content);
      } catch (e) {
        lastError = e;
      }
    }
    throw new AppError(
      ErrorCode.LLM_RESPONSE_PARSE_FAILED,
      `Failed to parse LLM response after retry: ${(lastError as Error)?.message}`,
      lastError
    );
  }

  private async analyzeLargeFile(filePath: string, fileContent: string): Promise<FileAnalysis> {
    // 分片：每段字符数（code points）<= context_window_size，无重叠
    const chunks = await this.fileSplitter.split(fileContent, this.config.context_window_size)

    const opts = { temperature: 0.1 }

    // 每个 chunk 只调用一次：输出 chunk-level Description + chunk-level Symbols（松散文本）
    const chunkOutputs: string[] = []
    for (const chunk of chunks) {
      const chunkPrompt = Mustache.render(CHUNK_ANALYSIS_PROMPT, {
        filePath,
        chunkId: chunk.id,
        chunkContent: chunk.content,
      })
      const response = await this.llmClient.call(chunkPrompt, opts)
      chunkOutputs.push(response.content?.trim() ?? '')
    }

    // 合并输入：简单拼接；若超长直接截断（UTF-8 安全通过 code points 实现）
    const mergedChunksText = chunkOutputs.join('\n\n')
    const mergedTextTruncated = truncateByCodePoints(mergedChunksText, this.config.context_window_size)

    // 合并阶段两次独立请求（两个独立上下文）
    const mergedDescPrompt = Mustache.render(FILE_DESCRIPTION_PROMPT, {
      filePath,
      mergedChunksText: mergedTextTruncated,
    })
    const mergedDescRes = await this.llmClient.call(mergedDescPrompt, opts)
    const description = mergedDescRes.content?.trim() ?? ''

    const mergedSymbolsPrompt = Mustache.render(MERGE_STRUCTURE_PROMPT, {
      filePath,
      mergedChunksText: mergedTextTruncated,
    })
    const mergedSymbolsRes = await this.llmClient.call(mergedSymbolsPrompt, opts)
    const symbols = mergedSymbolsRes.content?.trim() ?? ''

    // 最终 summary：输入 Symbols + Description
    const summaryPrompt = Mustache.render(FILE_SUMMARY_PROMPT, { symbols, description })
    const summaryRes = await this.llmClient.call(summaryPrompt, opts)
    const summary = summaryRes.content?.trim() ?? ''

    const name = path.basename(filePath)
    const language = this.detectLanguage(filePath)
    const linesOfCode = fileContent.split(/\r?\n/).length

    return {
      type: 'file',
      path: filePath,
      name,
      language,
      linesOfCode,
      dependencies: [],
      description,
      summary,
      symbols,
      classes: [],
      functions: [],
      lastAnalyzedAt: new Date().toISOString(),
      commitHash: '',
    }
  }

  /**
   * 目录两步协议（需求 10.6.3 / 10.9.3）：基于子项精简信息先生成 description，再生成 summary。
   */
  async analyzeDirectory(
    childrenDirs: Array<{ name: string; summary: string; description: string }>,
    childrenFiles: Array<{ name: string; summary: string; description: string }>
  ): Promise<{ description: string; summary: string }> {
    const opts = { temperature: 0.1 };
    const payload = { childrenDirs, childrenFiles };
    const childrenJson = JSON.stringify(payload, null, 2);

    // 第一步：功能描述
    const description = await this.callWithParseRetry(
      Mustache.render(DIRECTORY_DESCRIPTION_PROMPT, { childrenJson }),
      opts,
      (content) => (content?.trim() ?? '')
    );

    // 第二步：概述
    const summary = await this.callWithParseRetry(
      Mustache.render(DIRECTORY_SUMMARY_PROMPT, { description, childrenJson }),
      opts,
      (content) => (content?.trim() ?? '')
    );

    return { description, summary };
  }

}
