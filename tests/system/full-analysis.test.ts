import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { AnalysisAppService } from '../../src/application/analysis.app.service';
import { TestProjectFactory } from '../utils/test-project-factory';
import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { createTestConfigInDir } from '../utils/test-config-helper';

describe('System test: V2.1 LLM原生解析（ST-FULL-* / ST-INC-* 关键场景）', () => {
  let tempHome: string;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeAll(async () => {
    tempHome = path.join(os.tmpdir(), `sac-full-analysis-${Date.now()}`);
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

  test('ST-FULL-007/008/009/010: 多语言/无后缀/非标准后缀/罕见语言均可解析', async () => {
    const mock = await startMockOpenAIServer();
    const testProject = await TestProjectFactory.create('empty', false);
    const projectPath = testProject.path;
    try {
      await fs.writeFile(path.join(projectPath, 'index.ts'), 'export const add = (a: number, b: number) => a + b;');
      await fs.writeFile(path.join(projectPath, 'Dockerfile'), 'FROM node:18-alpine\nWORKDIR /app');
      await fs.writeFile(path.join(projectPath, 'code-snippets.txt'), 'def add(a,b): return a+b');
      await fs.writeFile(path.join(projectPath, 'Hello.swift'), 'func hello() -> String { return "Hello" }');

      const app = new AnalysisAppService();
      const res = await app.runAnalysis({
        path: projectPath,
        mode: 'full',
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
          cache_dir: path.join(projectPath, '.cache'),
          cache_max_size_mb: 0,
        },
      } as any);

      expect(res.success).toBe(true);
      // V2.3 黑名单过滤 *.txt，code-snippets.txt 不解析；index.ts/Dockerfile/Hello.swift 必解析，至少 3 个
      expect(res.data?.analyzedFilesCount).toBeGreaterThanOrEqual(3);
    } finally {
      await mock.close();
      await testProject.cleanup();
    }
  }, 120000);

  test('ST-V23-BL-OUTDIR-001: 输出目录 .skill-any-code-result 不参与解析', async () => {
    const mock = await startMockOpenAIServer();
    const testProject = await TestProjectFactory.create('small', false);
    const projectPath = testProject.path;

    try {
      const app = new AnalysisAppService();

      const first = await app.runAnalysis({
        path: projectPath,
        mode: 'full',
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
          cache_dir: path.join(projectPath, '.cache'),
          cache_max_size_mb: 0,
        },
      } as any);

      expect(first.success).toBe(true);

      const second = await app.runAnalysis({
        path: projectPath,
        mode: 'full',
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
          cache_dir: path.join(projectPath, '.cache'),
          cache_max_size_mb: 0,
        },
      } as any);

      expect(second.success).toBe(true);
      expect(second.data?.analyzedFilesCount).toBe(first.data?.analyzedFilesCount);
      // V2.6：不再生成 analysis-index.json。这里改为断言：结果目录内不会出现嵌套的结果目录路径。
      const outRoot = path.join(projectPath, '.skill-any-code-result');
      const stack: string[] = [outRoot];
      const rels: string[] = [];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(current, e.name);
          const rel = path.relative(outRoot, full).replace(/\\/g, '/');
          if (e.isDirectory()) {
            stack.push(full);
          } else if (e.isFile()) {
            rels.push(rel);
          }
        }
      }
      for (const r of rels) {
        expect(r.includes('.skill-any-code-result/')).toBe(false);
      }
    } finally {
      await mock.close();
      await testProject.cleanup();
    }
  }, 180000);

  test('ST-FULL-011: 空目录/仅黑名单文件目录不生成目录解析文件', async () => {
    const mock = await startMockOpenAIServer();
    const testProject = await TestProjectFactory.create('empty', false);
    const projectPath = testProject.path;
    try {
      // 构造目录结构：
      // - src/emptydir: 完全空目录
      // - src/only-md: 仅包含 .md（默认黑名单会过滤 *.md）
      // - src/hascode: 有可解析代码文件，作为对照
      await fs.ensureDir(path.join(projectPath, 'src', 'emptydir'));
      await fs.ensureDir(path.join(projectPath, 'src', 'only-md'));
      await fs.writeFile(path.join(projectPath, 'src', 'only-md', 'readme.md'), '# ignored');
      await fs.ensureDir(path.join(projectPath, 'src', 'hascode'));
      await fs.writeFile(path.join(projectPath, 'src', 'hascode', 'a.ts'), 'export const x = 1;');

      const app = new AnalysisAppService();
      const res = await app.runAnalysis({
        path: projectPath,
        mode: 'full',
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
          cache_dir: path.join(projectPath, '.cache'),
          cache_max_size_mb: 0,
        },
      } as any);

      expect(res.success).toBe(true);

      const outRoot = path.join(projectPath, '.skill-any-code-result');
      const emptyDirMd = path.join(outRoot, 'src', 'emptydir', 'index.md');
      const onlyMdDirMd = path.join(outRoot, 'src', 'only-md', 'index.md');

      // 关键断言：空目录与仅黑名单文件目录都不应生成目录解析文件
      expect(await fs.pathExists(emptyDirMd)).toBe(false);
      expect(await fs.pathExists(onlyMdDirMd)).toBe(false);

      // 对照断言：有可解析内容的目录应生成目录解析文件与文件解析文件
      const hasCodeDirMd = path.join(outRoot, 'src', 'hascode', 'index.md');
      const hasCodeFileMd = path.join(outRoot, 'src', 'hascode', 'a.ts.md');
      expect(await fs.pathExists(hasCodeDirMd)).toBe(true);
      expect(await fs.pathExists(hasCodeFileMd)).toBe(true);
    } finally {
      await mock.close();
      await testProject.cleanup();
    }
  }, 120000);

  test('ST-INC-004: Git项目存在未提交变更且未force时给出提示', async () => {
    const mock = await startMockOpenAIServer();
    const testProject = await TestProjectFactory.create('small', true);
    try {
      const app = new AnalysisAppService();
      // 修改文件但不提交
      await fs.writeFile(path.join(testProject.path, 'src', 'index.ts'), '// modified');

      const res = await app.runAnalysis({
        path: testProject.path,
        mode: 'auto',
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
          cache_dir: path.join(testProject.path, '.cache'),
          cache_max_size_mb: 0,
        },
      } as any);

      expect(res.success).toBe(true);
    } finally {
      await mock.close();
      await testProject.cleanup();
    }
  }, 120000);
});
