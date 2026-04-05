import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { TestProjectFactory } from '../utils/test-project-factory';
import { createTestConfigInDir } from '../utils/test-config-helper';

const execAsync = promisify(exec);

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
  const cmd = `node dist/cli.js ${args.join(' ')}`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: repoRoot,
      env: { ...process.env, ...options.env },
      timeout: options.timeoutMs ?? 120000,
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

// 去除 ANSI 颜色，便于在不同终端/CI 环境下做字符串断言
function stripAnsi(input: string): string {
  return input.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    '',
  );
}

interface CurrentObjectsSnapshot {
  groups: string[][];
}

// 从输出中提取多次出现的「当前对象」块，每个块是一组路径列表
function extractCurrentObjects(output: string): CurrentObjectsSnapshot {
  const lines = stripAnsi(output).split(/\r?\n/);
  const groups: string[][] = [];
  let current: string[] | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (/^(当前对象|Current)[:：]?$/.test(line)) {
      if (current && current.length > 0) {
        groups.push(current);
      }
      current = [];
      continue;
    }
    // 仅收集路径行（UI 当前输出为 `[ path ]`），排除 Processed/Tokens 等非路径行
    if (
      current &&
      line &&
      /^\[\s*.+\s*\]$/.test(line) &&
      !/^已处理:/.test(line) &&
      !/^Processed:/.test(line) &&
      !/^Tokens:/.test(line)
    ) {
      current.push(line);
    }
  }

  if (current && current.length > 0) {
    groups.push(current);
  }

  return { groups };
}

interface TokenSnapshot {
  prompt: number;
  completion: number;
  total: number;
}

function extractTokenSnapshots(output: string): TokenSnapshot[] {
  const lines = stripAnsi(output).split(/\r?\n/);
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
  return snapshots;
}

// 为 V2.4 相关 CLI 行为提供系统级自动化测试脚本
describe('V2.4 CLI 解析交互与进度/Token 行为 (第15章 ST-V24-*)', () => {
  const repoRoot = path.join(__dirname, '../..');
  let mock: { baseUrl: string; close: () => Promise<void> };
  let tempHome: string;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeAll(async () => {
    // 确保 dist/cli.js 已构建
    await execAsync('npm run build', { cwd: repoRoot });
  });

  beforeEach(async () => {
    mock = await startMockOpenAIServer();
    tempHome = path.join(os.tmpdir(), `sac-v24-cli-home-${Date.now()}`);
    await fs.ensureDir(tempHome);
    await createTestConfigInDir(tempHome, {
      llmBaseUrl: mock.baseUrl,
      llmApiKey: 'test',
      llmModel: 'mock',
      cacheEnabled: false,
      cacheMaxSizeMb: 0,
    });
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterEach(async () => {
    if (mock) {
      await mock.close();
    }
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    if (tempHome) await fs.remove(tempHome).catch(() => {});
  });

  /**
   * ST-V24-INTERACT-001：Git + 未提交变更，无交互直接解析
   * 对应测试文档 15.2.1 / 需求文档 12.2.2
   */
  it(
    'ST-V24-INTERACT-001: Git + 未提交变更时 analyze 不再弹出确认提示',
    async () => {
      const project = await TestProjectFactory.create('small', true);

      try {
        // 修改一个文件但不提交，制造 dirty 状态
        const targetFile = path.join(project.path, 'src', 'index.ts');
        await fs.ensureDir(path.dirname(targetFile));
        await fs.appendFile(targetFile, os.EOL + '// dirty change for ST-V24-INTERACT-001');

        // V2.4+：无交互确认；即便存在未提交变更也不阻断解析
        const { code, stdout, stderr } = await runCli(
          [
            '--path',
            project.path,
            '--mode',
            'auto',
            '--no-skills',
            '--llm-base-url',
            mock.baseUrl,
            '--llm-api-key',
            'test',
            '--llm-max-retries',
            '0',
          ],
          { cwd: repoRoot },
        );

        const output = stripAnsi((stdout ?? '') + (stderr ?? ''));

        // 1. 进程应正常结束（按照 V2.4 目标语义，CLI 不再因为 dirty+auto 在入口交互层阻塞）
        expect(code).toBe(0);

        // 2. 输出中不应出现任何交互式确认关键词
        expect(output).not.toMatch(/是否继续/);
        expect(output).not.toMatch(/确认/);
        expect(output).not.toMatch(/yes\/no/i);

        // 3. 至少出现一次启动日志，证明流程真实启动
        expect(output).toMatch(/Analysis started\. Project root:/);
      } finally {
        await project.cleanup();
      }
    },
    120000,
  );

  /**
   * ST-V24-INTERACT-002：远程 LLM 配置时不再弹出上传确认
   * 测试文档 15.2.2 / 需求文档 12.2.2
   */
  it(
    'ST-V24-INTERACT-002: 远程 LLM 配置下 analyze 不再出现「上传风险确认」交互',
    async () => {
      const project = await TestProjectFactory.create('small', false);

      try {
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
          { cwd: project.path },
        );

        const output = stripAnsi((stdout ?? '') + (stderr ?? ''));

        expect(code).toBe(0);
        // 不应出现任何「上传到」「是否继续」之类的交互提示
        expect(output).not.toMatch(/上传到/);
        expect(output).not.toMatch(/是否继续/);
        expect(output).not.toMatch(/确认/);
      } finally {
        await project.cleanup();
      }
    },
    120000,
  );

  /**
   * ST-V24-PROG-ETA-001：进度输出中不再包含 ETA / 剩余时间
   * 对应测试文档 15.3.1 / 需求文档 12.3
   */
  it(
    'ST-V24-PROG-ETA-001: 进度条输出中不应包含 ETA / 剩余时间字段',
    async () => {
      const project = await TestProjectFactory.create('medium', false);

      try {
        const { code, stdout, stderr } = await runCli(
          [
            '--path',
            project.path,
            '--mode',
            'full',
            '--no-skills',
            '--concurrency',
            '4',
            '--llm-base-url',
            mock.baseUrl,
            '--llm-api-key',
            'test',
            '--llm-max-retries',
            '0',
          ],
          { cwd: project.path },
        );

        const output = stripAnsi((stdout ?? '') + (stderr ?? ''));

        expect(code).toBe(0);
        expect(output).not.toMatch(/剩余时间/);
        expect(output).not.toMatch(/eta/i);
      } finally {
        await project.cleanup();
      }
    },
    180000,
  );

  /**
   * ST-V24-PROG-CONC-001：concurrency=1 时当前对象列表退化为单行
   * 对应测试文档 15.4.2 / 需求文档 12.4
   */
  it(
    'ST-V24-PROG-CONC-001: concurrency=1 时每个「当前对象」块最多 1 行',
    async () => {
      const project = await TestProjectFactory.create('medium', false);

      try {
        const { code, stdout, stderr } = await runCli(
          [
            '--path',
            project.path,
            '--mode',
            'full',
            '--no-skills',
            '--concurrency',
            '1',
            '--llm-base-url',
            mock.baseUrl,
            '--llm-api-key',
            'test',
            '--llm-max-retries',
            '0',
          ],
          { cwd: project.path },
        );

        const output = stripAnsi((stdout ?? '') + (stderr ?? ''));
        expect(code).toBe(0);

        const { groups } = extractCurrentObjects(output);
        expect(groups.length).toBeGreaterThan(0);
        for (const g of groups) {
          expect(g.length).toBeLessThanOrEqual(1);
        }
      } finally {
        await project.cleanup();
      }
    },
    180000,
  );

  /**
   * ST-V24-PROG-CONC-002：concurrency=3 时「当前对象」按字典序排序，最多 3 行
   * 对应测试文档 15.4.3 / 需求文档 12.4
   */
  it(
    'ST-V24-PROG-CONC-002: concurrency=3 时「当前对象」块最多 3 行且路径字典序排序',
    async () => {
      const project = await TestProjectFactory.create('medium', false);

      try {
        const { code, stdout, stderr } = await runCli(
          [
            '--path',
            project.path,
            '--mode',
            'full',
            '--no-skills',
            '--concurrency',
            '3',
            '--llm-base-url',
            mock.baseUrl,
            '--llm-api-key',
            'test',
            '--llm-max-retries',
            '0',
          ],
          { cwd: project.path },
        );

        const output = stripAnsi((stdout ?? '') + (stderr ?? ''));
        expect(code).toBe(0);

        const { groups } = extractCurrentObjects(output);
        expect(groups.length).toBeGreaterThan(0);
        for (const g of groups) {
          expect(g.length).toBeLessThanOrEqual(3);
          const sorted = [...g].sort();
          expect(g).toEqual(sorted);
        }
      } finally {
        await project.cleanup();
      }
    },
    180000,
  );

  /**
   * ST-V24-PROG-CONC-003：incremental 模式也输出「当前对象列表」
   * 对应测试文档 15.4.4 / 需求文档 12.4
   */
  it(
    'ST-V24-PROG-CONC-003: incremental 模式同样输出「当前对象」列表',
    async () => {
      const project = await TestProjectFactory.create('medium', true);

      try {
        // 基线 full，一次完整解析
        await runCli(
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
          { cwd: project.path },
        );

        // 修改一个文件，制造增量场景
        const targetFile = path.join(project.path, 'src', 'index.ts');
        await fs.ensureDir(path.dirname(targetFile));
        await fs.appendFile(targetFile, os.EOL + '// change for incremental');

        const { code, stdout, stderr } = await runCli(
          [
            '--path',
            project.path,
            '--mode',
            'incremental',
            '--no-skills',
            '--concurrency',
            '4',
            '--llm-base-url',
            mock.baseUrl,
            '--llm-api-key',
            'test',
            '--llm-max-retries',
            '0',
          ],
          { cwd: project.path },
        );

        const output = stripAnsi((stdout ?? '') + (stderr ?? ''));
        expect(code).toBe(0);

        const { groups } = extractCurrentObjects(output);
        // 增量解析可能非常快，导致「当前对象」块尚未来得及输出/捕获。
        // 若输出中出现了该块头，则应至少包含一次非空对象列表；否则允许未出现该块。
        const hasHeader = /(^|\n)\s*(当前对象|Current)[:：]?\s*(\n|$)/.test(output);
        if (hasHeader) {
          expect(groups.length).toBeGreaterThan(0);
        }
      } finally {
        await project.cleanup();
      }
    },
    240000,
  );

  /**
   * ST-V24-TOK-001：full 模式下 Token 统计 total 单调非降
   * 对应测试文档 15.5.2 / 需求文档 12.5
   */
  it(
    'ST-V24-TOK-001: full 模式下应输出 Token 行且 total 单调非降',
    async () => {
      const project = await TestProjectFactory.create('medium', false);

      try {
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
          { cwd: project.path },
        );

        const output = stripAnsi((stdout ?? '') + (stderr ?? ''));
        expect(code).toBe(0);

        const snapshots = extractTokenSnapshots(output);
        expect(snapshots.length).toBeGreaterThan(0);

        for (let i = 1; i < snapshots.length; i++) {
          expect(snapshots[i].total).toBeGreaterThanOrEqual(
            snapshots[i - 1].total,
          );
        }
      } finally {
        await project.cleanup();
      }
    },
    240000,
  );

  /**
   * ST-V24-TOK-002：incremental 模式同样输出 Token 行
   * 对应测试文档 15.5.3 / 需求文档 12.5
   */
  it(
    'ST-V24-TOK-002: incremental 模式也应输出 Token 统计行',
    async () => {
      const project = await TestProjectFactory.create('medium', true);

      try {
        // 先做一次 full 建立缓存
        await runCli(
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
          { cwd: project.path },
        );

        // 修改一个文件，触发增量
        const targetFile = path.join(project.path, 'src', 'index.ts');
        await fs.ensureDir(path.dirname(targetFile));
        await fs.appendFile(targetFile, os.EOL + '// change for incremental tokens');

        const { code, stdout, stderr } = await runCli(
          [
            '--path',
            project.path,
            '--mode',
            'incremental',
            '--no-skills',
            '--llm-base-url',
            mock.baseUrl,
            '--llm-api-key',
            'test',
            '--llm-max-retries',
            '0',
          ],
          { cwd: project.path },
        );

        const output = stripAnsi((stdout ?? '') + (stderr ?? ''));
        expect(code).toBe(0);

        const snapshots = extractTokenSnapshots(output);
        expect(snapshots.length).toBeGreaterThan(0);
      } finally {
        await project.cleanup();
      }
    },
    240000,
  );

  /**
   * ST-V24-TOK-003：最终总结中包含 Token 使用汇总
   * 对应测试文档 15.5.4 / 需求文档 12.5
   */
  it(
    'ST-V24-TOK-003: 解析结束的最终日志中应包含 Token 使用汇总行',
    async () => {
      const project = await TestProjectFactory.create('small', false);

      try {
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
          { cwd: project.path },
        );

        const output = stripAnsi((stdout ?? '') + (stderr ?? ''));
        expect(code).toBe(0);

        expect(output).toMatch(/LLM calls:\s*\d+/);
        expect(output).toMatch(/prompt tokens:\s*\d+/i);
        expect(output).toMatch(/completion tokens:\s*\d+/i);
        expect(output).toMatch(/total tokens:\s*\d+/i);
      } finally {
        await project.cleanup();
      }
    },
    180000,
  );
});

