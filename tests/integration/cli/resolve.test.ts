/**
 * V2.6 CLI resolve 子命令集成测试：完整流程 解析 → resolve 查询（不依赖索引）
 * 对应测试文档 10.4.2、10.4.7 ST-V23-FLOW-001
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { startMockOpenAIServer } from '../../utils/mock-openai-server';
import { createTestProject, mkdtemp } from '../../utils/create-test-project';
import { createTestConfigInDir } from '../../utils/test-config-helper';

const execAsync = promisify(exec);

describe('CLI resolve 集成测试 (V23)', () => {
  let testDir: string;
  let tempHome: string;
  let mock: { baseUrl: string; close: () => Promise<void> };
  const repoRoot = path.join(__dirname, '../../../');

  beforeAll(async () => {
    await execAsync('npm run build', { cwd: repoRoot });
  });

  beforeEach(async () => {
    testDir = mkdtemp('skill-any-code-resolve-int');
    tempHome = mkdtemp('skill-any-code-resolve-config');
    mock = await startMockOpenAIServer();
    await createTestConfigInDir(tempHome, {
      llmBaseUrl: mock.baseUrl,
      llmApiKey: 'test',
      llmModel: 'mock',
    });
    await createTestProject(testDir, {
      files: ['src/index.ts', 'src/utils/helper.ts'],
      directories: ['src', 'src/utils'],
    });
  });

  afterEach(async () => {
    await mock.close();
    await fs.remove(testDir).catch(() => {});
    await fs.remove(tempHome).catch(() => {});
  });

  const configPath = () => path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
  const execEnv = () => ({ HOME: tempHome, USERPROFILE: tempHome });

  it('UT-V26-RESOLVE-001: 解析后 resolve 应返回对应 Markdown 相对路径', async () => {
    await execAsync(
      `node dist/cli.js --path "${testDir}" --mode full --no-skills --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, ...execEnv() } }
    );

    const relPath = 'src/index.ts';
    const { stdout, stderr } = await execAsync(
      `node dist/cli.js resolve "${relPath}" --project "${testDir}"`,
      { cwd: repoRoot, env: { ...process.env, ...execEnv() } }
    );

    expect(stderr).toBe('');
    const result = stdout.trim();
    expect(result).not.toBe('N/A');
    // 特殊规则：index.xxx 文件结果为 index.xxx.md（避免与目录级 index.md 冲突）
    expect(result).toBe('.skill-any-code-result/src/index.ts.md');
    expect(await fs.pathExists(path.join(testDir, result.replace(/\//g, path.sep)))).toBe(true);
  }, 60000);

  it('UT-V26-RESOLVE-003: 不存在的路径应输出 N/A', async () => {
    await execAsync(
      `node dist/cli.js --path "${testDir}" --mode full --no-skills --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, ...execEnv() } }
    );

    const { stdout } = await execAsync(
      `node dist/cli.js resolve "src/nonexistent.ts" --project "${testDir}"`,
      { cwd: repoRoot, env: { ...process.env, ...execEnv() } }
    );
    expect(stdout.trim()).toBe('N/A');
  }, 60000);

  it('UT-V26-RESOLVE-004: 未生成结果 md 时 resolve 返回 N/A（exit 0 + N/A）', async () => {
    const { stdout } = await execAsync(
      `node dist/cli.js resolve "src/index.ts" --project "${testDir}"`,
      { cwd: repoRoot, env: { ...process.env, ...execEnv() } }
    );
    expect(stdout.trim()).toBe('N/A');
  });
});
