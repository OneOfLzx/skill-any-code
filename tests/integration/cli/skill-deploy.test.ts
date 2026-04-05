/**
 * V2.3 Agent Skill 自动生成与部署集成测试
 * 对应测试文档 10.4.4：UT-V23-SKILL-001 ~ UT-V23-SKILL-013
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import { startMockOpenAIServer } from '../../utils/mock-openai-server';
import { createTestProject, mkdtemp } from '../../utils/create-test-project';
import { createTestConfigInDir } from '../../utils/test-config-helper';

const execAsync = promisify(exec);

describe('Skill 部署集成测试 (V23-SKILL)', () => {
  let testDir: string;
  let tempHome: string;
  let mock: { baseUrl: string; close: () => Promise<void> };
  const repoRoot = path.join(__dirname, '../../../');

  beforeAll(async () => {
    await execAsync('npm run build', { cwd: repoRoot });
  });

  beforeEach(async () => {
    testDir = mkdtemp('skill-any-code-skill');
    tempHome = mkdtemp('skill-any-code-skill-config');
    mock = await startMockOpenAIServer();
    await createTestConfigInDir(tempHome, {
      llmBaseUrl: mock.baseUrl,
      llmApiKey: 'test',
      llmModel: 'mock',
    });
    await createTestProject(testDir, {
      files: ['src/index.ts'],
      directories: ['src'],
    });
  });

  afterEach(async () => {
    await mock.close();
    await fs.remove(testDir).catch(() => {});
    await fs.remove(tempHome).catch(() => {});
  });

  const execEnv = () => ({ HOME: tempHome, USERPROFILE: tempHome });

  it('UT-V23-SKILL-001: 默认 providers 下应生成 .agents/skills/sac-query 和 .claude/skills/sac-query', async () => {
    await execAsync(
      `node dist/cli.js --path "${testDir}" --mode full --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, ...execEnv() } }
    );

    const agentsDir = path.join(testDir, '.agents', 'skills', 'skill-any-code');
    const claudeDir = path.join(testDir, '.claude', 'skills', 'skill-any-code');

    expect(await fs.pathExists(agentsDir)).toBe(true);
    expect(await fs.pathExists(claudeDir)).toBe(true);

    for (const dir of [agentsDir, claudeDir]) {
      expect(await fs.pathExists(path.join(dir, 'SKILL.md'))).toBe(true);
      expect(await fs.pathExists(path.join(dir, 'resolve-config.json'))).toBe(false);
      expect(await fs.pathExists(path.join(dir, 'scripts', 'get-summary.py'))).toBe(true);
    }
  }, 60000);

  it('UT-V23-SKILL-002: SKILL.md 应包含 name/sac-query、description、compatibility 及正文章节', async () => {
    await execAsync(
      `node dist/cli.js --path "${testDir}" --mode full --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, ...execEnv() } }
    );

    const skillMdPath = path.join(testDir, '.agents', 'skills', 'skill-any-code', 'SKILL.md');
    const content = await fs.readFile(skillMdPath, 'utf-8');
    expect(content).toMatch(/name:\s*sac-query/);
    expect(content).toMatch(/description:/);
    expect(content).toMatch(/compatibility:/);
    expect(content).toMatch(/使用场景|使用方法|使用流程|输入输出|示例/);
  }, 60000);

  it.skip('UT-V23-SKILL-003: 旧版 resolve-config.json（V2.6 起不再生成）', async () => {}, 60000);

  it('UT-V23-SKILL-007: --no-skills 应不生成 Skill 目录', async () => {
    await execAsync(
      `node dist/cli.js --path "${testDir}" --mode full --no-skills --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, ...execEnv() } }
    );

    const agentsDir = path.join(testDir, '.agents', 'skills', 'skill-any-code');
    const claudeDir = path.join(testDir, '.claude', 'skills', 'skill-any-code');
    expect(await fs.pathExists(agentsDir)).toBe(false);
    expect(await fs.pathExists(claudeDir)).toBe(false);
  }, 60000);

  it('UT-V23-SCRIPT-001/008: 独立脚本查询与 CLI resolve 输出一致', async () => {
    await execAsync(
      `node dist/cli.js --path "${testDir}" --mode full --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, ...execEnv() } }
    );

    const skillDir = path.join(testDir, '.agents', 'skills', 'skill-any-code');
    const scriptPath = path.join(skillDir, 'scripts', 'get-summary.py');
    const relPath = 'src/index.ts';

    const { stdout: scriptOut } = await execAsync(`python "${scriptPath}" "${relPath}"`, { cwd: testDir });
    const { stdout: cliOut } = await execAsync(
      `node dist/cli.js resolve "${relPath}" --project "${testDir}"`,
      { cwd: repoRoot, env: { ...process.env, ...execEnv() } }
    );

    expect(scriptOut.trim()).toBe(cliOut.trim());
    expect(scriptOut.trim()).not.toBe('N/A');
  }, 60000);
});
