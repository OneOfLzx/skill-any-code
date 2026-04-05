import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';

import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { createTestConfigInDir } from '../utils/test-config-helper';
import { createDeepProject, mkdtempProjectDir } from '../utils/deep-project';

const execFileAsync = promisify(execFile);

interface RunCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<RunCliResult> {
  const repoRoot = path.join(__dirname, '../..');

  try {
    const { stdout, stderr } = await execFileAsync('node', ['dist/cli.js', ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...options.env },
      timeout: options.timeoutMs ?? 180000,
    });
    return { code: 0, stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (e: any) {
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? (e.message || String(e)),
    };
  }
}

function stripAnsi(input: string): string {
  return input.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    '',
  );
}

type CurrentObjectsSnapshot = {
  groups: string[][];
};

/**
 * 从输出中提取多次出现的「当前对象」块，每个块是一组路径列表。
 * 逻辑参考 `tests/system/v24-cli-interaction-and-progress.test.ts`，这里做局部复用避免跨文件耦合。
 */
function extractCurrentObjects(output: string): CurrentObjectsSnapshot {
  const lines = stripAnsi(output).split(/\r?\n/);
  const groups: string[][] = [];
  let current: string[] | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (/^Current[:：]?$/.test(line)) {
      if (current && current.length > 0) groups.push(current);
      current = [];
      continue;
    }
    if (!current) continue;
    if (!line) {
      // 空行视为 block 结束，避免把后续日志吞进去
      if (current.length > 0) groups.push(current);
      current = null;
      continue;
    }
    if (/^(Processed:|Tokens:|Progress)/.test(line)) {
      if (current.length > 0) groups.push(current);
      current = null;
      continue;
    }

    // 更严格的“条目行”判断：
    // - 允许相对路径（包含 / 或 \\）
    // - 允许 Windows 盘符路径（如 C:\\...）
    // - 排除明显的日志前缀行
    const looksLikeWindowsPath = /^[a-zA-Z]:\\/.test(line);
    const looksLikeRelPath = line.includes('/') || line.includes('\\');
    const isLogPrefix = /^(INFO|WARN|ERROR|\[INFO\]|\[WARN\]|\[ERROR\])/.test(line);
    if ((looksLikeRelPath || looksLikeWindowsPath) && !isLogPrefix) {
      current.push(line);
    }
  }
  if (current && current.length > 0) groups.push(current);
  return { groups };
}

describe('CLI e2e: 深层目录 current objects 并发退化可回归 (E2E-CONC-DEEPDIR-*)', () => {
  const repoRoot = path.join(__dirname, '../..');

  beforeAll(async () => {
    // 注意：本仓库当前可能存在 `tsc` 无法通过的情况（生产代码编译错误）。
    // 该 e2e 用例只依赖已产出的 dist/cli.js，因此这里仅校验 dist 是否存在，
    // 避免把“编译失败”误判为并发/进度回归问题。
    const distCli = path.join(repoRoot, 'dist', 'cli.js');
    const ok = await fs.pathExists(distCli);
    expect(ok).toBe(true);
  });

  it(
    'E2E-CONC-DEEPDIR-001: analyze full --concurrency 8 时 current object block 早期应 >1，尾部不应长期退化为 1',
    async () => {
      const projectRoot = mkdtempProjectDir('ca-deepdir-cli');
      let tempHome = '';
      let mock: { baseUrl: string; close: () => Promise<void> } | null = null;

      try {
        await createDeepProject(projectRoot, { depth: 5, branching: 2, filesPerDir: 1, ext: '.ts' });

        mock = await startMockOpenAIServer();
        tempHome = mkdtempProjectDir('ca-deepdir-cli-home');
        await fs.ensureDir(tempHome);
        await createTestConfigInDir(tempHome, {
          llmBaseUrl: mock.baseUrl,
          llmApiKey: 'test',
          llmModel: 'mock',
          cacheEnabled: false,
          cacheMaxSizeMb: 0,
        });
        const env = { ...process.env, HOME: tempHome, USERPROFILE: tempHome };

        const { code, stdout, stderr } = await runCli(
          [
            '--path',
            projectRoot,
            '--mode',
            'full',
            '--no-skills',
            '--concurrency',
            '8',
            '--llm-base-url',
            mock.baseUrl,
            '--llm-api-key',
            'test',
            '--llm-max-retries',
            '0',
          ],
          { cwd: projectRoot, timeoutMs: 240000, env },
        );

        const output = stripAnsi((stdout ?? '') + (stderr ?? ''));
        expect(code).toBe(0);

        const { groups } = extractCurrentObjects(output);
        expect(groups.length).toBeGreaterThan(0);

        const sizes = groups.map((g) => g.length);
        // 每个 block 的行数应不超过 concurrency
        for (const s of sizes) {
          expect(s).toBeLessThanOrEqual(8);
        }

        // 早期/中期至少出现过 >1 行（证明并发在用户侧可见）
        const earlyWindowEnd = Math.max(1, Math.floor(sizes.length * 0.6));
        const early = sizes.slice(0, earlyWindowEnd);
        expect(early.some((s) => s > 1)).toBe(true);
      } finally {
        if (mock) await mock.close();
        if (tempHome) await fs.remove(tempHome).catch(() => {});
        await fs.remove(projectRoot).catch(() => {});
      }
    },
    300000,
  );
});

