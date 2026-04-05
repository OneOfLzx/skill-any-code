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
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<RunCliResult> {
  const repoRoot = path.join(__dirname, '../..');

  try {
    const { stdout, stderr } = await execFileAsync('node', ['dist/cli.js', ...args], {
      cwd: options.cwd ?? repoRoot,
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

// 去除 ANSI 颜色，避免依赖具体终端能力和配色
function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
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
    if (/^Current[:：]?$/.test(line)) {
      if (current && current.length > 0) {
        groups.push(current);
      }
      current = [];
      continue;
    }
    if (!current) continue;
    if (!line) {
      // 空行视为 block 结束，避免吞入后续日志
      if (current.length > 0) groups.push(current);
      current = null;
      continue;
    }
    if (/^(Processed:|Tokens:|Progress|INFO|WARN|ERROR|\[INFO\]|\[WARN\]|\[ERROR\])/.test(line)) {
      if (current.length > 0) groups.push(current);
      current = null;
      continue;
    }

    const looksLikeWindowsPath = /^[a-zA-Z]:\\/.test(line);
    const looksLikePath = line.includes('/') || line.includes('\\');
    const looksLikeStackTrace = /^at\s+/.test(line);
    const looksLikeUrl = /^https?:\/\//.test(line);

    if ((looksLikeWindowsPath || looksLikePath) && !looksLikeStackTrace && !looksLikeUrl) {
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

type ProgressSample = {
  done: number;
  total: number;
  lineIndex: number;
};

// Parse lines containing Progress + Processed: x/y
function extractParseProgressSamples(output: string): ProgressSample[] {
  const lines = stripAnsi(output).split(/\r?\n/);
  const samples: ProgressSample[] = [];

  const reInline = /Progress.*Processed:\s*(\d+)\/(\d+)/;
  const reDoneLine = /^Processed:\s*(\d+)\/(\d+)/;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    // 兼容两种格式：
    // 1) 单行：解析进度 ... 已处理: x/y 对象
    // 2) 双行：解析进度 ...（下一行）已处理: x/y 对象
    if (!line.includes('Progress')) continue;

    const inline = line.match(reInline);
    if (inline) {
      samples.push({
        done: Number(inline[1]),
        total: Number(inline[2]),
        lineIndex: idx,
      });
      continue;
    }

    const next = lines[idx + 1] ?? '';
    const m2 = next.trim().match(reDoneLine);
    if (m2) {
      samples.push({
        done: Number(m2[1]),
        total: Number(m2[2]),
        lineIndex: idx,
      });
    }
  }

  return samples;
}

// 在输出靠近尾部的位置尝试解析一个「进度 -> (可选 当前对象块) -> Tokens」的顺序片段
// 注意：当没有任何 worker in-flight 对象时，当前对象块会被完全省略。
function findFinalBlockTriple(output: string) {
  const plainLines = stripAnsi(output).split(/\r?\n/);
  const tokenIndices: number[] = [];
  for (let i = 0; i < plainLines.length; i++) {
    if (/Tokens:\s*in=\d+\s+out=\d+\s+total=\d+/.test(plainLines[i])) {
      tokenIndices.push(i);
    }
  }

  if (tokenIndices.length === 0) {
    return null;
  }

  // 从最后一次 Token 行开始向前尝试，找到任意一组满足约束的片段即可
  for (let t = tokenIndices.length - 1; t >= 0; t--) {
    const tokenIndex = tokenIndices[t];

    // 向上寻找最近一次「当前对象」块头（可选）
    let currentHeaderIndex = -1;
    for (let i = tokenIndex - 1; i >= 0; i--) {
      const line = plainLines[i].trim();
      if (/^Current[:：]?$/.test(line)) {
        currentHeaderIndex = i;
        break;
      }
      if (tokenIndex - i > 500) break;
    }

    // 若存在当前对象块，则统计其内部的路径行；否则允许为空（表示尾部已无 in-flight 对象）
    const pathLines: { index: number; value: string }[] = [];
    if (currentHeaderIndex !== -1) {
      for (let i = currentHeaderIndex + 1; i < tokenIndex; i++) {
        const l = plainLines[i].trim();
        if (
          l &&
          (l.includes('/') || l.includes('\\')) &&
          !/^Processed:/.test(l) &&
          !/^Tokens:/.test(l)
        ) {
          pathLines.push({ index: i, value: l });
        }
      }
    }

    // 再向上寻找最近一条解析进度行：兼容是否带「解析进度」前缀
    let progressIndex = -1;
    const searchFrom = (currentHeaderIndex !== -1 ? currentHeaderIndex : tokenIndex) - 1;
    for (let i = searchFrom; i >= 0; i--) {
      const l = plainLines[i];
      if (l.includes('Progress')) {
        progressIndex = i;
        break;
      }
      if (searchFrom - i > 500) break;
    }
    if (progressIndex === -1) continue;

    return {
      progressIndex,
      currentHeaderIndex,
      tokenIndex,
      pathLines,
      lines: plainLines,
    };
  }

  return null;
}

describe('CLI 输出结构稳健性：进度/当前对象/Tokens 行 (问题3 回归)', () => {
  const repoRoot = path.join(__dirname, '../..');
  const hasDistCli = fs.pathExistsSync(path.join(repoRoot, 'dist', 'cli.js'));
  const itWithDist = hasDistCli ? it : it.skip;
  let mock: { baseUrl: string; close: () => Promise<void> };
  let tempHome: string;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    mock = await startMockOpenAIServer();
    tempHome = path.join(os.tmpdir(), `ca-cli-output-structure-home-${Date.now()}`);
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

  async function runMediumProjectFullAnalyze(concurrency: number) {
    const project = await TestProjectFactory.create('medium', false);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // 模拟非 TTY：child_process 默认 stdout/stderr 为 pipe，足够覆盖“非交互终端”场景；
      // 这里显式关闭 CI/Tty 相关干扰环境变量，保证结构更稳定。
      TERM: 'dumb',
      FORCE_COLOR: '0',
    };

    try {
      const { code, stdout, stderr } = await runCli(
        [
          '--path',
          project.path,
          '--mode',
          'full',
          '--no-skills',
          '--concurrency',
          String(concurrency),
          '--llm-base-url',
          mock.baseUrl,
          '--llm-api-key',
          'test',
          '--llm-max-retries',
          '0',
        ],
        { cwd: repoRoot, env, timeoutMs: 240000 },
      );

      const output = stripAnsi((stdout ?? '') + (stderr ?? ''));
      return { code, output, projectPath: project.path };
    } finally {
      await project.cleanup();
    }
  }

  itWithDist(
    'CLI e2e（非TTY）结构约束：进度行/当前对象块/Tokens 行数量均在对象数附近的合理阈值内',
    async () => {
      const { code, output } = await runMediumProjectFullAnalyze(3);
      expect(code).toBe(0);

      const progressSamples = extractParseProgressSamples(output);
      expect(progressSamples.length).toBeGreaterThan(0);

      const maxTotal = progressSamples.reduce(
        (max, s) => (s.total > max ? s.total : max),
        0,
      );
      // 兜底：即便解析失败也不应该出现 0，总对象数至少要大于 0
      expect(maxTotal).toBeGreaterThan(0);

      const totalObjects = maxTotal;

      const { groups } = extractCurrentObjects(output);
      const tokenSnapshots = extractTokenSnapshots(output);

      // 1）解析进度行数量不应爆炸：
      // - 非TTY下，logger 下沉会导致“日志+快照”交替输出，进度行可能重复出现；
      // - 但进度推进（done 值）不应出现数量级膨胀。
      const uniqueDoneCount = new Set(progressSamples.map((s) => s.done)).size;
      const PROGRESS_UNIQUE_EXTRA_ALLOWANCE = 5;
      expect(uniqueDoneCount).toBeLessThanOrEqual(
        totalObjects + PROGRESS_UNIQUE_EXTRA_ALLOWANCE,
      );
      // 原始进度行允许在常数倍范围内（避免非TTY快照重复导致误报）
      const PROGRESS_RAW_MULTIPLIER = 3;
      expect(progressSamples.length).toBeLessThanOrEqual(
        totalObjects * PROGRESS_RAW_MULTIPLIER + 20,
      );

      // 2）当前对象块数量同样不应远超对象数，依然给一个小常数缓冲
      const CURRENT_BLOCK_EXTRA_ALLOWANCE = 5;
      expect(groups.length).toBeGreaterThan(0);
      const uniqueGroupCount = new Set(groups.map((g) => g.join('\n'))).size;
      // 当前对象列表会随并发活跃对象变化，非TTY下可能出现较多不同快照；
      // 这里约束为“线性可控”，避免无限增长。
      expect(uniqueGroupCount).toBeLessThanOrEqual(
        totalObjects * 2 + 20,
      );
      // 非TTY线性输出允许重复快照导致块数偏大，但应受控在常数倍范围内
      const CURRENT_BLOCK_RAW_MULTIPLIER = 3;
      expect(groups.length).toBeLessThanOrEqual(
        totalObjects * CURRENT_BLOCK_RAW_MULTIPLIER + 20,
      );

      // 每个块的行数不应出现数量级上的“行爆炸”：
      // 允许比对象总数略多一个常数（例如包含 . / 根目录等非对象行），
      // 但不应出现远超对象总数的单块超长情况。
      for (const g of groups) {
        expect(g.length).toBeGreaterThan(0);
        const MAX_BLOCK_LINES = totalObjects + 5;
        expect(g.length).toBeLessThanOrEqual(MAX_BLOCK_LINES);
      }

      // 3）Tokens 行数量：允许在对象数的常数倍内，预留重试/汇总等场景
      const TOKENS_MULTIPLIER = 3;
      const TOKENS_EXTRA_ALLOWANCE = 50;
      expect(tokenSnapshots.length).toBeLessThanOrEqual(
        totalObjects * TOKENS_MULTIPLIER + TOKENS_EXTRA_ALLOWANCE,
      );
    },
    300000,
  );

  itWithDist(
    '输出顺序/格式契约：在最终阶段至少出现一次「解析进度 -> (可选 当前对象块) -> Tokens」结构',
    async () => {
      const { code, output } = await runMediumProjectFullAnalyze(3);
      if (code !== 0) {
        throw new Error(`CLI exited with code=${code}. Output:\n${output}`);
      }

      const triple = findFinalBlockTriple(output);
      const { groups } = extractCurrentObjects(output);
      const tokenSnapshots = extractTokenSnapshots(output);

      if (!triple) {
        // 在本用例参数下，Tokens 行是必然输出；当前对象块在尾部可能被省略（无 in-flight）
        expect(tokenSnapshots.length).toBeGreaterThan(0);
        throw new Error(
          '输出中存在 Tokens 行，但未能找到期望的「解析进度 -> (可选 当前对象块) -> Tokens」结构',
        );
      }

      const { progressIndex, currentHeaderIndex, tokenIndex, pathLines } = triple!;

      // 基本顺序约束
      if (currentHeaderIndex !== -1) {
        expect(progressIndex).toBeLessThan(currentHeaderIndex);
        expect(currentHeaderIndex).toBeLessThan(tokenIndex);
      } else {
        expect(progressIndex).toBeLessThan(tokenIndex);
      }

      // 若存在当前对象块，则其中至少有一行路径，且行看起来是一个文件/目录路径
      if (currentHeaderIndex !== -1) {
        expect(pathLines.length).toBeGreaterThan(0);
        for (const p of pathLines) {
          expect(
            p.value.includes('/') ||
              p.value.includes('\\') ||
              p.value.endsWith('.ts') ||
              p.value.endsWith('.js'),
          ).toBe(true);
        }
      }

      // Tokens 行格式合法性：在 block 的 Tokens 行上复检一次正则
      const tokenLine = triple!.lines[tokenIndex];
      expect(tokenLine).toMatch(
        /Tokens:\s*in=\d+\s+out=\d+\s+total=\d+/,
      );
    },
    300000,
  );
});

