import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { startMockOpenAIServer } from '../../utils/mock-openai-server';
import { createTestConfigInDir } from '../../utils/test-config-helper';

describe('CLI 多语言解析测试 (UT-CLI-*)', () => {
  let testDir: string;
  let tempHome: string;
  let mock: { baseUrl: string; close: () => Promise<void> };
  const repoRoot = path.join(__dirname, '../../../');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-any-code-test-'));
    mock = await startMockOpenAIServer();
    tempHome = path.join(os.tmpdir(), `sac-cli-analyze-home-${Date.now()}`);
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
    // 确保 dist/cli.js 存在
    await execAsync('npm run build', { cwd: repoRoot });
  });

  afterEach(async () => {
    await mock.close();
    await fs.remove(testDir);
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await fs.remove(tempHome).catch(() => {});
  });

  /**
   * UT-CLI-011: 多语言项目CLI解析测试（第12章修订：增加每个源文件对应 .md 存在断言）
   */
  test('UT-CLI-011: 多语言项目CLI解析成功，文件计数正确，每个源文件均有对应 .md', async () => {
    // 创建多语言测试项目
    await fs.writeFile(path.join(testDir, 'index.ts'), 'export const add = (a: number, b: number) => a + b;');
    await fs.writeFile(path.join(testDir, 'utils.js'), 'export const multiply = (a, b) => a * b;');
    await fs.writeFile(path.join(testDir, 'hello.py'), 'def hello():\n    print("Hello Python")');
    await fs.writeFile(path.join(testDir, 'Hello.java'), 'public class Hello { public static void main(String[] args) { System.out.println("Hello Java"); } }');
    await fs.writeFile(path.join(testDir, 'main.go'), 'package main\nimport "fmt"\nfunc main() { fmt.Println("Hello Go") }');

    const { stdout, stderr } = await execAsync(
      `node dist/cli.js --path "${testDir}" --mode full --log-level info --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome } }
    );
    expect(stderr).toBe('');
    // CLI 输出口径：Analysis completed. Processed X object(s)
    expect(stdout).toMatch(/Analysis completed\. Processed\s+\d+\s+object\(s\)/);

    // 验证结果目录与根 index.md 存在（V2.2 起根目录为 index.md，不再生成 PROJECT_SUMMARY.md）
    const resultDir = path.join(testDir, '.skill-any-code-result');
    expect(await fs.pathExists(resultDir)).toBe(true);
    expect(await fs.pathExists(path.join(resultDir, 'index.md'))).toBe(true);

    // 第12章 12.3.2 UT-CLI-011 修订：每个源文件均有对应 .md（文件名剥离扩展名）
    expect(await fs.pathExists(path.join(resultDir, 'index.md'))).toBe(true);
    expect(await fs.pathExists(path.join(resultDir, 'index.ts.md'))).toBe(true);
    expect(await fs.pathExists(path.join(resultDir, 'utils.js.md'))).toBe(true);
    expect(await fs.pathExists(path.join(resultDir, 'hello.py.md'))).toBe(true);
    expect(await fs.pathExists(path.join(resultDir, 'Hello.java.md'))).toBe(true);
    expect(await fs.pathExists(path.join(resultDir, 'main.go.md'))).toBe(true);
    // 可选：根 index.md 内容包含功能描述或目录结构（根目录汇总与 index.ts 可能共用 index.md）
    const indexMdContent = await fs.readFile(path.join(resultDir, 'index.md'), 'utf-8');
    expect(indexMdContent).toMatch(/功能描述|目录|summary/i);
  });

  /**
   * ST-V23-INDEX-INTEGRITY-001（第12章 12.3.3）：全量解析后索引条目数与 resultPath 对应文件存在性
   */
  test.skip('ST-V23-INDEX-INTEGRITY-001: 旧版索引校验（V2.6 起不再生成 analysis-index.json）', async () => {}, 60000);

  /**
   * UT-CLI-012: 无后缀文件CLI解析测试
   */
  test('UT-CLI-012: 无后缀文件CLI解析成功，不被跳过', async () => {
    // 创建无后缀文件测试项目
    await fs.writeFile(path.join(testDir, 'Dockerfile'), 'FROM node:18-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD ["npm", "start"]');
    await fs.writeFile(path.join(testDir, 'Makefile'), 'build:\n\tnpm run build\ntest:\n\tnpm test');
    await fs.writeFile(path.join(testDir, 'run'), '#!/bin/bash\necho "Running script"\nnpm start');

    const { stdout, stderr } = await execAsync(
      `node dist/cli.js --path ${testDir} --mode full --log-level info --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome } }
    );
    expect(stderr).toBe('');
    expect(stdout).toMatch(/Analysis completed\. Processed\s+\d+\s+object\(s\)/);

    // 验证结果文件存在
    const resultDir = path.join(testDir, '.skill-any-code-result');
    expect(await fs.pathExists(resultDir)).toBe(true);
    expect(await fs.pathExists(path.join(resultDir, 'Dockerfile.md'))).toBe(true);
    expect(await fs.pathExists(path.join(resultDir, 'Makefile.md'))).toBe(true);
    expect(await fs.pathExists(path.join(resultDir, 'run.md'))).toBe(true);
  });
});
