import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { AnalysisAppService } from '../../src/application/analysis.app.service';
import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { createTestConfigInDir } from '../utils/test-config-helper';

const execAsync = promisify(exec);
const repoRoot = path.join(__dirname, '../../');

describe('CLI 子命令与参数 (V2.3 UT-CLI-001/003/004)', () => {
  beforeAll(async () => {
    await execAsync('npm run build', { cwd: repoRoot });
  });

  it('UT-CLI-001: 主命令帮助应包含 init/resolve，不包含 query/analyze/config', async () => {
    const { stdout } = await execAsync('node dist/cli.js --help', { cwd: repoRoot });
    expect(stdout).toMatch(/init/);
    expect(stdout).toMatch(/resolve/);
    // 仅断言“命令列表”里不存在 analyze/config（避免被 option 文案中的 analyze.max_concurrency 误伤）
    expect(stdout).not.toMatch(/^\s+analyze\s/m);
    expect(stdout).not.toMatch(/^\s+config\s/m);
    expect(stdout).not.toMatch(/\bquery\b/);
  });

  it('UT-CLI-003: 主命令帮助应包含 --skills-providers 和 --no-skills', async () => {
    const { stdout } = await execAsync('node dist/cli.js --help', { cwd: repoRoot });
    expect(stdout).toMatch(/skills-providers|skillsProviders/);
    expect(stdout).toMatch(/no-skills|noSkills/);
  });

  it('UT-V23-RESOLVE-008: resolve 帮助应包含 <absolute-path>、--project、--output-dir', async () => {
    const { stdout } = await execAsync('node dist/cli.js resolve --help', { cwd: repoRoot });
    expect(stdout).toMatch(/absolute-path|路径/);
    expect(stdout).toMatch(/\-\-project|\-p/);
    expect(stdout).toMatch(/output-dir/);
  });

  it('UT-V23-RESOLVE-009: resolve 缺少路径参数应报错且退出码非 0', async () => {
    let exitCode = 0;
    try {
      await execAsync('node dist/cli.js resolve', { cwd: repoRoot });
    } catch (e: any) {
      exitCode = e.code ?? 1;
    }
    expect(exitCode).not.toBe(0);
  });
});

describe('LLM 原生解析覆盖（替代旧 ParserRegistry）', () => {
  let tempHome: string;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeAll(async () => {
    tempHome = path.join(require('os').tmpdir(), `sac-parser-${Date.now()}`);
    await fs.ensureDir(tempHome);
    const mock = await startMockOpenAIServer();
    await createTestConfigInDir(tempHome, {
      llmBaseUrl: mock.baseUrl,
      llmApiKey: 'test',
      llmModel: 'mock',
      cacheEnabled: false,
      cacheMaxSizeMb: 0,
    });
    await mock.close();
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterAll(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await fs.remove(tempHome).catch(() => {});
  });

  test('UT-PARSE-006/009(覆盖): 任意后缀/无后缀文本文件都会进入LLM解析流程', async () => {
    const mock = await startMockOpenAIServer();
    const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'skill-any-code-parse-'));
    try {
      await fs.writeFile(path.join(tempDir, 'Dockerfile'), 'FROM node:18-alpine\nWORKDIR /app');
      await fs.writeFile(path.join(tempDir, 'add.py'), 'def add(a,b): return a+b');
      await fs.writeFile(path.join(tempDir, 'README.md'), '# doc\n```ts\nexport const a=1\n```');

      const app = new AnalysisAppService();
      const result = await app.runAnalysis({
        path: tempDir,
        mode: 'full',
        llmConfig: {
          base_url: mock.baseUrl,
          api_key: 'test',
          model: 'mock',
          temperature: 0.1,
          max_tokens: 1000,
          timeout: 1000,
          max_retries: 0,
          retry_delay: 1,
          context_window_size: 1000,
          cache_enabled: false,
          cache_dir: path.join(tempDir, '.cache'),
          cache_max_size_mb: 0,
        },
      } as any);

      expect(result.success).toBe(true);
      // 至少应覆盖 Dockerfile 与 add.py 两个文件进入解析流程（README.md 是否被黑名单过滤不作为强约束）
      expect(result.data?.analyzedFilesCount).toBeGreaterThanOrEqual(2);
    } finally {
      await mock.close();
      await fs.remove(tempDir);
    }
  }, 60000);
});
