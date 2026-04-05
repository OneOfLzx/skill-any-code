import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import { createHash } from 'crypto';
import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { TestProjectFactory } from '../utils/test-project-factory';
import { createTestConfigInDir } from '../utils/test-config-helper';
import { readFileHashWhenAnalyzedOrThrow } from '../utils/analyzed-record';

const execAsync = promisify(exec);

interface RunCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], options?: { timeoutMs?: number }): Promise<RunCliResult> {
  const repoRoot = path.join(__dirname, '../..');
  const cmd = `node dist/cli.js ${args.join(' ')}`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: repoRoot,
      env: { ...process.env },
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

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function readFileHashWhenAnalyzed(projectPath: string, relFilePath: string): Promise<string> {
  return await readFileHashWhenAnalyzedOrThrow(projectPath, relFilePath);
}

describe('E2E/CLI：非Git项目 mode=auto 增量解析（ST-INC-NONGIT-*）', () => {
  const repoRoot = path.join(__dirname, '../..');

  beforeAll(async () => {
    const ok = await fs.pathExists(path.join(repoRoot, 'dist', 'cli.js'));
    if (!ok) {
      // eslint-disable-next-line jest/no-jasmine-globals
      pending('dist/cli.js not found, skip CLI incremental tests');
    }
  });

  test(
    'ST-INC-NONGIT-002: 非Git目录两次 CLI analyze(mode=auto)，第二次变更后不得走“无变更直接返回”路径（hash 更新）',
    async () => {
      const mock = await startMockOpenAIServer();
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      const tempHome = await fs.mkdtemp(path.join(require('os').tmpdir(), 'ca-nongit-cli-home-'));
      await createTestConfigInDir(tempHome, {
        llmBaseUrl: mock.baseUrl,
        llmApiKey: 'test',
        llmModel: 'mock',
        cacheEnabled: false,
        cacheMaxSizeMb: 0,
      });
      process.env.HOME = tempHome;
      process.env.USERPROFILE = tempHome;
      const project = await TestProjectFactory.create('small', false);
      const targetRel = path.join('src', 'index.ts');
      const targetAbs = path.join(project.path, targetRel);

      try {
        const first = await runCli([
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
        ]);
        expect(first.code).toBe(0);

        const hash1 = await readFileHashWhenAnalyzed(project.path, targetRel);
        expect(hash1.length).toBeGreaterThan(0);

        const newContent = `// ST-INC-NONGIT-002\nexport const v = ${Date.now()};\n`;
        await fs.writeFile(targetAbs, newContent, 'utf-8');
        const expectedHash2 = sha256(newContent);

        const second = await runCli([
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
        ]);
        expect(second.code).toBe(0);
        expect(second.stdout + second.stderr).not.toContain('没有检测到变更文件');

        const hash2 = await readFileHashWhenAnalyzed(project.path, targetRel);
        expect(hash2).not.toBe(hash1);
        expect(hash2).toBe(expectedHash2);
      } finally {
        await mock.close();
        process.env.HOME = originalHome;
        process.env.USERPROFILE = originalUserProfile;
        await fs.remove(tempHome).catch(() => {});
        await project.cleanup();
      }
    },
    300000,
  );
});

