import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import { TestProjectFactory } from '../utils/test-project-factory';
import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { listAllFilesRecursively } from '../utils/result-dir-whitelist';
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
  const cliAbs = path.join(options.cwd, 'dist', 'cli.js');
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliAbs, ...args], {
      cwd: options.cwd,
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

function findJsonFiles(files: string[]): string[] {
  return files.filter((p) => (p.split('/').pop() || p).toLowerCase().endsWith('.json'));
}

describe('System: 结果目录不应出现多余 JSON（仅 md）', () => {
  const repoRoot = path.join(__dirname, '../..');
  let hasDistCli = false;

  beforeAll(async () => {
    hasDistCli = await fs.pathExists(path.join(repoRoot, 'dist', 'cli.js'));
  });

  test(
    'ST-RESULT-NO-PERFILE-JSON-001: full analyze 后结果目录不应出现任何 json（仅 md）',
    async () => {
      const mock = await startMockOpenAIServer();
      const testProject = await TestProjectFactory.create('small', false);
      const projectPath = testProject.path;
      const outputDir = '.result-no-perfile-json-system';
      const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ca-result-no-json-home-'));
      await createTestConfigInDir(tempHome, {
        llmBaseUrl: mock.baseUrl,
        llmApiKey: 'test',
        llmModel: 'mock',
        cacheEnabled: false,
        cacheMaxSizeMb: 0,
      });

      try {
        if (!hasDistCli) {
          // eslint-disable-next-line jest/no-jasmine-globals
          pending('dist/cli.js not found, skip CLI-based result-dir-no-json test');
        }

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          TERM: 'dumb',
          FORCE_COLOR: '0',
          HOME: tempHome,
          USERPROFILE: tempHome,
        };

        const { code, stderr } = await runCli(
          [
            '--path',
            projectPath,
            '--mode',
            'full',
            '--no-skills',
            '--output-dir',
            outputDir,
            '--llm-base-url',
            mock.baseUrl,
            '--llm-api-key',
            'test',
            '--llm-max-retries',
            '0',
          ],
          { cwd: repoRoot, env, timeoutMs: 240000 },
        );

        expect(code).toBe(0);
        expect(stderr).toBe('');

        const resultRoot = path.join(projectPath, outputDir);
        expect(await fs.pathExists(resultRoot)).toBe(true);

        const files = await listAllFilesRecursively(resultRoot);
        const jsons = findJsonFiles(files);

        expect(jsons).toEqual([]);

        // 正向断言：至少产出 1 个 md，避免“没写结果也通过”
        expect(files.some((p) => p.toLowerCase().endsWith('.md'))).toBe(true);
      } finally {
        await fs.remove(tempHome).catch(() => {});
        await mock.close();
        await testProject.cleanup();
      }
    },
    180000,
  );

  test.skip(
    'ST-RESULT-STRICT-ONLY-MD-001: 严格模式下结果目录只能有 .md（当前实现预计会失败）',
    async () => {
      const mock = await startMockOpenAIServer();
      const testProject = await TestProjectFactory.create('small', false);
      const projectPath = testProject.path;
      const outputDir = '.result-strict-only-md-system';
      const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ca-result-no-json-home-'));
      await createTestConfigInDir(tempHome, {
        llmBaseUrl: mock.baseUrl,
        llmApiKey: 'test',
        llmModel: 'mock',
        cacheEnabled: false,
        cacheMaxSizeMb: 0,
      });

      try {
        if (!hasDistCli) {
          // eslint-disable-next-line jest/no-jasmine-globals
          pending('dist/cli.js not found, skip CLI-based result-dir-no-json test');
        }

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          TERM: 'dumb',
          FORCE_COLOR: '0',
          HOME: tempHome,
          USERPROFILE: tempHome,
        };

        const { code, stderr } = await runCli(
          [
            '--path',
            projectPath,
            '--mode',
            'full',
            '--no-skills',
            '--output-dir',
            outputDir,
            '--llm-base-url',
            mock.baseUrl,
            '--llm-api-key',
            'test',
            '--llm-max-retries',
            '0',
          ],
          { cwd: repoRoot, env, timeoutMs: 240000 },
        );

        expect(code).toBe(0);
        expect(stderr).toBe('');

        const resultRoot = path.join(projectPath, outputDir);
        const files = await listAllFilesRecursively(resultRoot);
        const jsons = findJsonFiles(files);

        // 严格：不允许任何 .json
        expect(jsons).toEqual([]);
      } finally {
        await fs.remove(tempHome).catch(() => {});
        await mock.close();
        await testProject.cleanup();
      }
    },
    180000,
  );
});

