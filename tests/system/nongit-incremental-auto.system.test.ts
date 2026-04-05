import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { createHash } from 'crypto';
import { TestProjectFactory } from '../utils/test-project-factory';
import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { createTestConfigInDir } from '../utils/test-config-helper';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileHashWhenAnalyzedOrThrow } from '../utils/analyzed-record';

const execAsync = promisify(exec);

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function readFileHashWhenAnalyzed(projectPath: string, relFilePath: string): Promise<string> {
  return await readFileHashWhenAnalyzedOrThrow(projectPath, relFilePath);
}

describe('系统集成：非Git项目增量解析（ST-INC-NONGIT-*）', () => {
  let AnalysisAppServiceCtor: new () => { runAnalysis: (p: any) => Promise<any> };
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let tempHome: string;

  beforeAll(async () => {
    // system test 需要 worker thread 的 dist/*.js 产物存在；不在此处触发构建，避免把编译失败误判为回归
    const repoRoot = path.join(__dirname, '../..');
    const distApp = path.join(repoRoot, 'dist', 'application', 'analysis.app.service.js');
    const ok = await fs.pathExists(distApp);
    if (!ok) {
      // eslint-disable-next-line jest/no-jasmine-globals
      pending('dist/application/analysis.app.service.js not found, skip system incremental tests');
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AnalysisAppServiceCtor = require('../../dist/application/analysis.app.service').AnalysisAppService;
  }, 300000);

  beforeEach(async () => {
    tempHome = path.join(os.tmpdir(), `ca-inc-nongit-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.ensureDir(tempHome);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await fs.remove(tempHome).catch(() => {});
  });

  test(
    'ST-INC-NONGIT-001: 非Git目录两次 analyze(mode=auto)，第二次文件变更后必须产生实际工作量（hash 更新）',
    async () => {
      const mock = await startMockOpenAIServer();
      const project = await TestProjectFactory.create('small', false);
      const targetRel = path.join('src', 'index.ts');
      const targetAbs = path.join(project.path, targetRel);

      try {
        await createTestConfigInDir(tempHome, {
          llmBaseUrl: mock.baseUrl,
          llmApiKey: 'test',
          llmModel: 'mock',
          cacheEnabled: false,
          cacheMaxSizeMb: 0,
        });

        const app = new AnalysisAppServiceCtor();
        const first = await app.runAnalysis({
          path: project.path,
          mode: 'auto',
          force: false,
          noSkills: true,
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
            cache_dir: path.join(project.path, '.cache'),
            cache_max_size_mb: 0,
          },
        } as any);

        expect(first.success).toBe(true);
        expect(first.data?.analyzedFilesCount).toBeGreaterThan(0);

        const hash1 = await readFileHashWhenAnalyzed(project.path, targetRel);

        // 修改文件内容（模拟用户复现：非Git目录第二次变更不应 0 工作量直接退出）
        const newContent = `// ST-INC-NONGIT-001\nexport const v = ${Date.now()};\n`;
        await fs.writeFile(targetAbs, newContent, 'utf-8');
        const expectedHash2 = sha256(newContent);

        const second = await app.runAnalysis({
          path: project.path,
          mode: 'auto',
          force: false,
          noSkills: true,
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
            cache_dir: path.join(project.path, '.cache'),
            cache_max_size_mb: 0,
          },
        } as any);

        expect(second.success).toBe(true);
        // 允许实现以“非Git增量”为名或回退全量，但必须有实际解析工作量
        expect(second.data?.analyzedFilesCount).toBeGreaterThan(0);

        const hash2 = await readFileHashWhenAnalyzed(project.path, targetRel);
        expect(hash2).not.toBe(hash1);
        expect(hash2).toBe(expectedHash2);
      } finally {
        await mock.close();
        await project.cleanup();
      }
    },
    240000,
  );

  test(
    'ST-INC-NONGIT-003: Git目录 mode=auto 仍可正常增量（避免非Git修复导致回归）',
    async () => {
      const mock = await startMockOpenAIServer();
      const project = await TestProjectFactory.create('small', true);
      const targetRel = path.join('src', 'index.ts');
      const targetAbs = path.join(project.path, targetRel);

      try {
        await createTestConfigInDir(tempHome, {
          llmBaseUrl: mock.baseUrl,
          llmApiKey: 'test',
          llmModel: 'mock',
          cacheEnabled: false,
          cacheMaxSizeMb: 0,
        });

        const app = new AnalysisAppServiceCtor();
        const baseline = await app.runAnalysis({
          path: project.path,
          mode: 'full',
          force: true,
          noSkills: true,
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
            cache_dir: path.join(project.path, '.cache'),
            cache_max_size_mb: 0,
          },
        } as any);

        expect(baseline.success).toBe(true);
        expect(baseline.data?.analyzedFilesCount).toBeGreaterThan(0);

        const hash1 = await readFileHashWhenAnalyzed(project.path, targetRel);

        // 在 Git 项目中制造未提交变更；mode=auto + force=true 应走增量并处理该文件
        const newContent = `// ST-INC-NONGIT-003\nexport const changed = ${Date.now()};\n`;
        // Windows 下偶发目录句柄/文件系统同步抖动，先确保目标目录存在再写入
        await fs.ensureDir(path.dirname(targetAbs));
        await fs.writeFile(targetAbs, newContent, 'utf-8');
        const expectedHash2 = sha256(newContent);

        const second = await app.runAnalysis({
          path: project.path,
          mode: 'auto',
          force: true,
          noSkills: true,
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
            cache_dir: path.join(project.path, '.cache'),
            cache_max_size_mb: 0,
          },
        } as any);

        expect(second.success).toBe(true);
        expect(second.data?.analyzedFilesCount).toBeGreaterThan(0);

        const hash2 = await readFileHashWhenAnalyzed(project.path, targetRel);
        expect(hash2).not.toBe(hash1);
        expect(hash2).toBe(expectedHash2);
      } finally {
        await mock.close();
        await project.cleanup();
      }
    },
    240000,
  );
});

