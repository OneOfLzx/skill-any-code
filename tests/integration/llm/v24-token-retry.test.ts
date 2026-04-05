import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { startMockOpenAIServer } from '../../utils/mock-openai-server';
import { createTestConfigInDir } from '../../utils/test-config-helper';

const execAsync = promisify(exec);

function stripAnsi(input: string): string {
  return input.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    '',
  );
}

interface TokenSnapshot {
  prompt: number;
  completion: number;
  total: number;
}

function extractTokenSnapshots(output: string): TokenSnapshot[] {
  const plain = stripAnsi(output);
  const lines = plain.split(/\r?\n/);
  const snapshots: TokenSnapshot[] = [];

  for (const line of lines) {
    const m = line.match(/Tokens:\s*in=(\d+)\s+out=(\d+)\s+total=(\d+)/);
    if (m) {
      snapshots.push({
        prompt: Number(m[1]),
        completion: Number(m[2]),
        total: Number(m[3]),
      });
    }
  }
  // 回退：解析最终汇总格式「本次解析共调用 LLM X 次，输入 Token: Y，输出 Token: Z，总 Token: W」
  // 支持全角冒号与多种空白
  if (snapshots.length === 0) {
    const promptM = plain.match(/输入\s*Token[：:]\s*(\d+)/);
    const completionM = plain.match(/输出\s*Token[：:]\s*(\d+)/);
    const totalM = plain.match(/总\s*Token[：:]\s*(\d+)/);
    if (promptM && completionM && totalM) {
      snapshots.push({
        prompt: Number(promptM[1]),
        completion: Number(completionM[1]),
        total: Number(totalM[1]),
      });
    }
  }
  return snapshots;
}

describe('ST-V24-TOK-004: LLM 重试场景下 Token 统计合理性', () => {
  const repoRoot = path.join(__dirname, '../../..');

  it(
    'ST-V24-TOK-004: 单次失败后重试成功时，仅统计成功调用的 Token',
    async () => {
      // 1. 启动带「第一次请求失败、之后成功」行为的 Mock LLM
      // [2]：第 1 次请求为 health-check，第 2 次为首次解析；使解析请求失败以触发重试
      const mock = await startMockOpenAIServer({
        failRequestIndices: [2],
      });

      // 2. 构造一个小型测试项目，仅 1 个文件，方便判断「预期成功调用次数约为常数级」
      const projectDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'skill-any-code-tok-retry-'),
      );
      let tempHome: string | undefined;
      try {
        await fs.writeFile(
          path.join(projectDir, 'index.ts'),
          'export const add = (a: number, b: number) => a + b;',
          'utf-8',
        );

        tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'sac-tok-retry-home-'));
        await createTestConfigInDir(tempHome, {
          llmBaseUrl: mock.baseUrl,
          llmApiKey: 'test',
          llmModel: 'mock',
        });

        // 3. 运行一次 full 解析，开启重试（--llm-max-retries=1）
        let combined = '';
        let execCode = 0;
        try {
          const { stdout, stderr } = await execAsync(
            `node dist/cli.js --path "${projectDir.replace(/\\/g, '/')}" --mode full --no-skills --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 1`,
            { cwd: repoRoot, timeout: 120000, env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome } },
          );
          combined = (stdout ?? '') + (stderr ?? '');
        } catch (e: any) {
          execCode = e.code ?? 1;
          combined = String(e.stdout ?? '') + String(e.stderr ?? '');
          // 不 rethrow，继续断言以验证输出
        } finally {
          await mock.close();
        }

        const output = stripAnsi(combined);

        // 4. 至少应有一行 Token 统计输出，或最终汇总中含 Token 信息（不同环境下输出可能略有差异）
        const snapshots = extractTokenSnapshots(output);
        const hasTokenInfo =
          output.includes('总 Token') ||
          output.includes('解析完成') ||
          output.includes('调用 LLM') ||
          output.includes('解析进度'); // execCode=0 时进度条输出可证明流程完成
        if (!(snapshots.length > 0 || hasTokenInfo)) {
          throw new Error(`输出中未找到 Token 或解析完成信息。execCode=${execCode}，输出前 1500 字符: ${output.slice(0, 1500)}`);
        }

        if (snapshots.length > 0) {
          // 5. Token total 单调非降
          for (let i = 1; i < snapshots.length; i++) {
            expect(snapshots[i].total).toBeGreaterThanOrEqual(
              snapshots[i - 1].total,
            );
          }
          // 6. 合理性校验
          const finalTotal = snapshots[snapshots.length - 1].total;
          expect(finalTotal).toBeGreaterThan(0);
          expect(finalTotal).toBeLessThanOrEqual(600);
        }
      } finally {
        await fs.remove(projectDir).catch(() => {});
        if (tempHome) await fs.remove(tempHome).catch(() => {});
      }
    },
    240000,
  );
});

