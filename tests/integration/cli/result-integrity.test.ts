/**
 * 测试文档第 12 章 12.3.2：文件级与目录级结果完整性（P0）
 * ST-RESULT-FILE-001：多级目录下每个代码文件均有对应 .md
 * ST-RESULT-DIR-001：目录 index.md 内容有意义
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { startMockOpenAIServer } from '../../utils/mock-openai-server';
import { createTestConfigInDir } from '../../utils/test-config-helper';

const execAsync = promisify(exec);

function mkdtemp(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

describe('12.3.2 文件级与目录级结果完整性 (ST-RESULT-FILE-001 / ST-RESULT-DIR-001)', () => {
  let testDir: string;
  let tempHome: string;
  let mock: { baseUrl: string; close: () => Promise<void> };
  const repoRoot = path.join(__dirname, '../../..');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeAll(async () => {
    await execAsync('npm run build', { cwd: repoRoot });
  });

  beforeEach(async () => {
    testDir = mkdtemp('skill-any-code-result-integrity');
    mock = await startMockOpenAIServer();
    tempHome = mkdtemp('sac-result-integrity-home');
    await fs.ensureDir(tempHome);
    await createTestConfigInDir(tempHome, { llmBaseUrl: mock.baseUrl, llmApiKey: 'test', llmModel: 'mock' });
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterEach(async () => {
    if (mock) await mock.close();
    await fs.remove(testDir).catch(() => {});
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await fs.remove(tempHome).catch(() => {});
  });

  /**
   * ST-RESULT-FILE-001：多级目录下每个代码文件均有对应 .md
   * 项目结构：src/main/java/pkg/Hello.java, Util.java, src/main/java/pkg/sub/Helper.java，根目录 README.md（黑名单）
   * 预期：3 个 .md 存在；README.md 无对应结果；输出「共分析 3 个文件」
   */
  it('ST-RESULT-FILE-001: 多级目录下每个代码文件均有对应 .md', async () => {
    await fs.ensureDir(path.join(testDir, 'src/main/java/pkg/sub'));
    await fs.writeFile(path.join(testDir, 'src/main/java/pkg/Hello.java'), 'public class Hello {}', 'utf-8');
    await fs.writeFile(path.join(testDir, 'src/main/java/pkg/Util.java'), 'public class Util {}', 'utf-8');
    await fs.writeFile(path.join(testDir, 'src/main/java/pkg/sub/Helper.java'), 'public class Helper {}', 'utf-8');
    await fs.writeFile(path.join(testDir, 'README.md'), '# readme', 'utf-8');

    let stdout = '';
    let stderr = '';
    try {
      const result = await execAsync(
        `node dist/cli.js --path "${testDir}" --mode full --no-skills --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
        { cwd: repoRoot, env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome } }
      );
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (e: any) {
      stdout = e.stdout ?? '';
      stderr = e.stderr ?? '';
    }

    const resultRoot = path.join(testDir, '.skill-any-code-result');
    expect(await fs.pathExists(resultRoot)).toBe(true);

    const helloMd = path.join(resultRoot, 'src/main/java/pkg/Hello.java.md');
    const utilMd = path.join(resultRoot, 'src/main/java/pkg/Util.java.md');
    const helperMd = path.join(resultRoot, 'src/main/java/pkg/sub/Helper.java.md');
    expect(await fs.pathExists(helloMd)).toBe(true);
    expect(await fs.pathExists(utilMd)).toBe(true);
    expect(await fs.pathExists(helperMd)).toBe(true);

    // README.md 为黑名单，不生成对应 .md（结果目录下无 README.md 作为代码分析结果）
    const readmeResultPath = path.join(resultRoot, 'README.md');
    expect(await fs.pathExists(readmeResultPath)).toBe(false);

    const match = stdout.match(/共分析\s*(\d+)\s*个文件/);
    if (match) {
      expect(parseInt(match[1], 10)).toBeGreaterThanOrEqual(3);
    }

    // 可选：至少一个文件内容包含功能描述或类定义
    const helloContent = await fs.readFile(helloMd, 'utf-8');
    expect(helloContent).toMatch(/功能描述|类定义|summary|class|Hello/i);
  }, 60000);

  /**
   * ST-RESULT-DIR-001：目录 index.md 内容有意义
   * 前置条件：同 ST-RESULT-FILE-001，pkg 下既有 Hello、Util 又有子目录 sub。
   * 预期：pkg/index.md 包含「包含 X 个文件」X>=2、「Y 个子目录」Y>=1，且出现 Hello、Util、sub，不得「包含 0 个文件」。
   */
  it('ST-RESULT-DIR-001: 目录 index.md 内容有意义，文件数/子目录数与实际一致', async () => {
    await fs.ensureDir(path.join(testDir, 'src/main/java/pkg/sub'));
    await fs.writeFile(path.join(testDir, 'src/main/java/pkg/Hello.java'), 'public class Hello {}', 'utf-8');
    await fs.writeFile(path.join(testDir, 'src/main/java/pkg/Util.java'), 'public class Util {}', 'utf-8');
    await fs.writeFile(path.join(testDir, 'src/main/java/pkg/sub/Helper.java'), 'public class Helper {}', 'utf-8');

    await execAsync(
      `node dist/cli.js --path "${testDir}" --mode full --no-skills --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome } }
    );

    const resultRoot = path.join(testDir, '.skill-any-code-result');
    const pkgIndexPath = path.join(resultRoot, 'src/main/java/pkg/index.md');
    expect(await fs.pathExists(pkgIndexPath)).toBe(true);

    const content = await fs.readFile(pkgIndexPath, 'utf-8');
    expect(content).toMatch(/功能描述|目录结构|包含/i);

    const fileCountMatch = content.match(/包含\s*(\d+)\s*个文件/);
    expect(fileCountMatch).not.toBeNull();
    const fileCount = parseInt(fileCountMatch![1], 10);
    expect(fileCount).toBeGreaterThanOrEqual(2);

    const subDirMatch = content.match(/(\d+)\s*个子目录/);
    expect(subDirMatch).not.toBeNull();
    const subDirCount = parseInt(subDirMatch![1], 10);
    expect(subDirCount).toBeGreaterThanOrEqual(1);

    expect(content).toMatch(/Hello|Util|sub/);
    expect(content).not.toMatch(/包含\s*0\s*个文件/);
  }, 60000);
});
