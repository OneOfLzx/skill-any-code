import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { IncrementalService } from '../../src/domain/services/incremental.service';
import { GitService } from '../../src/infrastructure/git.service';
import { LocalStorageService } from '../../src/infrastructure/storage.service';
import { TestProjectFactory } from '../utils/test-project-factory';
import { AnalysisAppService } from '../../src/application/analysis.app.service';
import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { createTestConfigInDir } from '../utils/test-config-helper';

describe('Module interaction integration test（V2.1）', () => {
  let tempHome: string;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeAll(async () => {
    tempHome = path.join(os.tmpdir(), `ca-module-interaction-${Date.now()}`);
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

  test('GitService <-> IncrementalService: 无历史记录时增量不可用；写入元数据后可用', async () => {
    const testProject = await TestProjectFactory.create('small', true);
    const gitService = new GitService(testProject.path);
    const storageService = new LocalStorageService(testProject.path);
    const incrementalService = new IncrementalService(gitService, storageService);

    const canIncremental1 = await incrementalService.canDoIncremental(testProject.path);
    expect(canIncremental1.available).toBe(false);

    const currentCommit = await gitService.getCurrentCommit();
    const projectSlug = await gitService.getProjectSlug();
    await storageService.saveMetadata(projectSlug, {
      projectRoot: testProject.path,
      lastAnalyzedAt: new Date().toISOString(),
      gitCommits: [
        {
          hash: currentCommit,
          branch: await gitService.getCurrentBranch(),
          analyzedAt: new Date().toISOString(),
        },
      ],
      analysisVersion: '1.0',
      analyzedFilesCount: 6,
      schemaVersion: '1.0',
    });

    const canIncremental2 = await incrementalService.canDoIncremental(testProject.path);
    expect(canIncremental2.available).toBe(true);
    expect(canIncremental2.baseCommit).toBe(currentCommit);

    await testProject.cleanup();
  }, 120000);

  test('AnalysisAppService: 注入llmConfig后可完成全量解析（不出网）', async () => {
    const mock = await startMockOpenAIServer();
    const testProject = await TestProjectFactory.create('small', false);
    try {
      const app = new AnalysisAppService();
      const res = await app.runAnalysis({
        path: testProject.path,
        mode: 'full',
        force: true,
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
      expect(res.data?.analyzedFilesCount).toBeGreaterThan(0);
    } finally {
      await mock.close();
      await testProject.cleanup();
    }
  }, 120000);
});
