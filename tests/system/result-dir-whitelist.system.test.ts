import path from 'path';
import * as fs from 'fs-extra';
import { TestProjectFactory } from '../utils/test-project-factory';
import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { getStoragePath } from '../../src/common/utils';
import { listAllFilesRecursively, assertOnlyAllowedResultFiles } from '../utils/result-dir-whitelist';
import { createTestConfigInDir } from '../utils/test-config-helper';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const repoRoot = path.join(__dirname, '../..');

describe('System: 结果目录文件白名单契约（应用层）', () => {
  beforeAll(async () => {
    // 该用例需要运行 dist 产物（worker 依赖 parse.worker.js），因此先 build
    await execAsync('npm run build', { cwd: repoRoot });
  });

  test(
    'ST-RESULT-WHITELIST-APP-001: full 模式下结果目录只允许 .md（不允许任何 JSON）',
    async () => {
      const mock = await startMockOpenAIServer();
      const testProject = await TestProjectFactory.create('small', false);
      const projectPath = testProject.path;

      const outputDir = '.result-whitelist-system';

      try {
        // AnalysisAppService 会从默认 "~/.config/skill-any-code/config.yaml" 加载配置。
        // 为避免依赖真实用户 HOME，这里将 HOME/USERPROFILE 临时指向 tmp 并写入测试配置。
        const prevHome = process.env.HOME;
        const prevUserProfile = process.env.USERPROFILE;
        const fakeHome = path.join(os.tmpdir(), `sac-whitelist-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        await fs.ensureDir(fakeHome);
        process.env.HOME = fakeHome;
        process.env.USERPROFILE = fakeHome;
        await createTestConfigInDir(fakeHome, { cacheEnabled: false, cacheMaxSizeMb: 0 });

        try {
          // 使用 dist 的应用层实现，确保 worker 路径与生产形态一致
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { AnalysisAppService } = require(path.join(repoRoot, 'dist', 'application', 'analysis.app.service.js'));
          const app = new AnalysisAppService();
          const res = await app.runAnalysis({
            path: projectPath,
            mode: 'full',
            force: true,
            outputDir,
            llmConfig: {
              base_url: mock.baseUrl,
              api_key: 'test',
              model: 'mock',
              temperature: 0.1,
              max_tokens: 1000,
              // 给系统测试更宽裕的超时，避免 CI/Windows 上偶发慢导致 false negative
              timeout: 15000,
              max_retries: 0,
              retry_delay: 1,
              context_window_size: 1000,
              cache_enabled: false,
              cache_dir: path.join(projectPath, '.cache'),
              cache_max_size_mb: 0,
            },
          } as any);

          if (!res.success) {
            throw new Error(`runAnalysis failed: ${JSON.stringify(res.errors || [], null, 2)}`);
          }

          const storageRoot = getStoragePath(projectPath, outputDir);
          const exists = await fs.pathExists(storageRoot);
          expect(exists).toBe(true);

          const files = await listAllFilesRecursively(storageRoot);
          // 断言：结果目录中仅存在 .md 结果文件，不应出现任何 JSON。
          assertOnlyAllowedResultFiles(files);
        } finally {
          // 恢复环境变量（尽量不影响后续测试）
          process.env.HOME = prevHome;
          process.env.USERPROFILE = prevUserProfile;
        }
      } finally {
        await mock.close();
        await testProject.cleanup();
      }
    },
    180000,
  );
});

