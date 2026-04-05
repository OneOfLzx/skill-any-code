import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { TestProjectFactory } from '../utils/test-project-factory';
import { createTestConfigInDir } from '../utils/test-config-helper';

const execFileAsync = promisify(execFile);

interface RunCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<RunCliResult> {
  const repoRoot = path.join(__dirname, '../..');
  const distCli = path.join(repoRoot, 'dist', 'cli.js');

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [distCli, ...args], {
      cwd: options?.cwd ?? repoRoot,
      env: { ...process.env, ...options?.env },
      timeout: options?.timeoutMs ?? 180000,
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
  // eslint-disable-next-line no-control-regex
  // 同时移除颜色码与光标控制等 CSI 序列，避免影响基于文本的断言/正则匹配
  return input.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

describe('CLI 进度条首帧 total 非魔法数字回归 (E2E-CLI-PROG-INIT-*)', () => {
  const repoRoot = path.join(__dirname, '../..');
  const distCli = path.join(repoRoot, 'dist', 'cli.js');
  const hasDistCli = fs.pathExistsSync(distCli);
  const itWithDist = hasDistCli ? it : it.skip;

  async function countObjectsForProject(projectRoot: string): Promise<number> {
    const stat = await fs.stat(projectRoot);
    if (stat.isFile()) return 1;

    let count = 0;

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          (entry.name === '.skill-any-code-result' || entry.name === '.skill-any-code-internal')
        ) {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isFile()) {
          count += 1;
        } else if (entry.isDirectory()) {
          await walk(full);
        }
      }
      // 目录本身也计为一个对象（包括根目录），与 AnalysisService.countObjects 行为保持一致
      count += 1;
    };

    await walk(projectRoot);
    return count;
  }

  itWithDist(
    'E2E-CLI-PROG-INIT-001: 首帧解析进度行 total 不应固定为 100',
    async () => {
      const project = await TestProjectFactory.create('small', false);
      const expectedTotal = await countObjectsForProject(project.path);
      let mock: { baseUrl: string; close: () => Promise<void> } | null = null;
      let tempHome = '';

      try {
        mock = await startMockOpenAIServer();
        tempHome = path.join(os.tmpdir(), `sac-prog-init-home-${Date.now()}`);
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
            project.path,
            '--mode',
            'full',
            '--no-skills',
            '--llm-base-url',
            mock.baseUrl,
            '--llm-api-key',
            'test',
            '--llm-max-retries',
            '0',
          ],
          { cwd: repoRoot, timeoutMs: 240000, env },
        );

        const combined = stripAnsi((stdout ?? '') + (stderr ?? '')).replace(/\r/g, '\n');
        expect(code).toBe(0);

        let firstProgressTotal: number | null = null;

        // Compatibility:
        // 1) Single-line: Progress ... Processed: 0/total
        // 2) Two-line: Progress ... (next line) Processed: 0/total
        const mInline = /Progress[^\n]*Processed:\s*0\/(\d+)/.exec(combined);
        const mSplit = /Progress[^\n]*\nProcessed:\s*0\/(\d+)/.exec(combined);
        const m = mInline ?? mSplit;
        if (m) firstProgressTotal = Number(m[1]);

        expect(firstProgressTotal).not.toBeNull();
        expect(firstProgressTotal).not.toBe(100);
        expect(firstProgressTotal).toBe(expectedTotal);
      } finally {
        if (mock) {
          await mock.close();
        }
        if (tempHome) await fs.remove(tempHome).catch(() => {});
        await project.cleanup();
      }
    },
    300000,
  );

  itWithDist(
    'E2E-CLI-PROG-INIT-002: 任何位置都不应出现 0/100 对象或 0/100 片段',
    async () => {
      const project = await TestProjectFactory.create('small', false);
      let mock: { baseUrl: string; close: () => Promise<void> } | null = null;
      let tempHome = '';

      try {
        mock = await startMockOpenAIServer();
        tempHome = path.join(os.tmpdir(), `sac-prog-init-home-${Date.now()}`);
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
            project.path,
            '--mode',
            'full',
            '--no-skills',
            '--llm-base-url',
            mock.baseUrl,
            '--llm-api-key',
            'test',
            '--llm-max-retries',
            '0',
          ],
          { cwd: repoRoot, timeoutMs: 240000, env },
        );

        const combined = stripAnsi((stdout ?? '') + (stderr ?? '')).replace(/\r/g, '\n');
        expect(code).toBe(0);

        expect(combined).not.toMatch(/Progress[^\n]*Processed:\s*0\/100/);
      } finally {
        if (mock) {
          await mock.close();
        }
        if (tempHome) await fs.remove(tempHome).catch(() => {});
        await project.cleanup();
      }
    },
    300000,
  );
});

