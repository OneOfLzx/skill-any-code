import { TestProjectFactory } from '../utils/test-project-factory';
import { AssertUtils } from '../utils/assert-utils';
import { AnalysisAppService } from '../../src/application/analysis.app.service';
import { LocalStorageService } from '../../src/infrastructure/storage.service';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { createTestConfigInDir } from '../utils/test-config-helper';

describe('Full process integration test', () => {
  let analysisAppService: AnalysisAppService;
  let mock: { baseUrl: string; close: () => Promise<void> };
  let tempHome: string;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeAll(async () => {
    mock = await startMockOpenAIServer();
    tempHome = path.join(os.tmpdir(), `ca-full-process-${Date.now()}`);
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
    analysisAppService = new AnalysisAppService();
  });

  afterAll(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await fs.remove(tempHome).catch(() => {});
    await mock.close();
  });

  test('完整全量解析流程: 命令触发 -> 解析执行 -> 结果存储 -> 存储结构正确', async () => {
    // 创建测试项目
    const testProject = await TestProjectFactory.create('small', true);
    
    // 执行解析命令
    const result = await analysisAppService.runAnalysis({
      path: testProject.path,
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
        cache_dir: path.join(testProject.path, '.cache'),
        cache_max_size_mb: 0,
      }
    });

    // 断言解析完成（允许有不支持的文件类型的错误，当前版本仅支持TS/JS）
    expect(result.data?.analyzedFilesCount).toBeGreaterThan(0);
    expect(result.data?.mode).toBe('full');

    // 验证存储目录结构
    const projectSlug = result.data!.projectName;
    const storageService = new LocalStorageService(testProject.path);
    const storageRoot = storageService.getStoragePath(projectSlug);

    // 验证核心文件存在（V2.2 起根目录为 index.md，不再生成 PROJECT_SUMMARY.md）
    await AssertUtils.fileExists(path.join(storageRoot, 'index.md'));

    // 验证源码目录分析文件存在
    await AssertUtils.directoryExists(path.join(storageRoot, 'src'));
    await AssertUtils.fileExists(path.join(storageRoot, 'src', 'index.md'));
    await AssertUtils.fileExists(path.join(storageRoot, 'src', 'utils', 'date.ts.md'));
    await AssertUtils.fileExists(path.join(storageRoot, 'src', 'components', 'Button.tsx.md'));

    // 验证文件内容格式正确
    await AssertUtils.validMarkdownFile(path.join(storageRoot, 'index.md'));
    await AssertUtils.validMarkdownFile(path.join(storageRoot, 'src', 'index.md'));

    // V2.6：不再生成 .analysis_metadata.json
    expect(await fs.pathExists(path.join(storageRoot, '.analysis_metadata.json'))).toBe(false);

    // V2.2 起无 getProjectSummary，根目录概述由 index.md 承担

    await testProject.cleanup();
  }, 300000); // 5分钟超时

  // V2.0版本移除了queryAppService，查询功能改为CLI子命令，该测试用例待重构
  // test('解析+查询完整流程: 解析完成后可正常查询结果', async () => {
  //   const testProject = await TestProjectFactory.create('small', true);
  //   const { queryAppService } = await createAppServices();

  //   // 执行解析
  //   await analysisAppService.runAnalysis({
  //     path: testProject.path,
  //     mode: 'full',
  //     force: true
  //   });

  //   // 查询文件摘要
  //   const summaryResult = await queryAppService.query({
  //     path: path.join(testProject.path, 'src/index.ts'),
  //     type: 'summary',
  //     projectSlug: testProject.slug
  //   });

  //   expect(summaryResult.success).toBe(true);
  //   expect(summaryResult.data?.summary).toBeDefined();

  //   // 查询完整分析结果
  //   const fullResult = await queryAppService.query({
  //     path: path.join(testProject.path, 'src/index.ts'),
  //     type: 'full',
  //     projectSlug: testProject.slug
  //   });

  //   expect(fullResult.success).toBe(true);
  //   expect(fullResult.data?.fullAnalysis?.classes?.length).toBeGreaterThan(0);

  //   await testProject.cleanup();
  // }, 300000);
});
