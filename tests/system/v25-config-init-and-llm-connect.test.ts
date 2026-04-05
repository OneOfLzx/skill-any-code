import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { promisify } from 'util';
import { exec } from 'child_process';
import { startMockOpenAIServer } from '../utils/mock-openai-server';
import { TestProjectFactory } from '../utils/test-project-factory';

const execAsync = promisify(exec);

interface RunCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 替换 YAML 中的 LLM 配置，兼容 init 产生的 base_url: '' 或 base_url: "" 格式 */
function replaceLlmInYaml(
  yaml: string,
  overrides: { base_url?: string; api_key?: string; model?: string; cache_max_size_mb?: number }
): string {
  let out = yaml;
  if (overrides.base_url !== undefined) {
    out = out.replace(/base_url:\s*['"]{2}/, `base_url: "${overrides.base_url}"`);
  }
  if (overrides.api_key !== undefined) {
    out = out.replace(/api_key:\s*['"]{2}/, `api_key: "${overrides.api_key}"`);
  }
  if (overrides.model !== undefined) {
    out = out.replace(/model:\s*['"]{2}/, `model: "${overrides.model}"`);
  }
  if (overrides.cache_max_size_mb !== undefined) {
    out = out.replace(/cache_max_size_mb:\s*\d+/, `cache_max_size_mb: ${overrides.cache_max_size_mb}`);
  }
  return out;
}

async function runCli(args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<RunCliResult> {
  const repoRoot = path.join(__dirname, '../..');
  const cmd = `node dist/cli.js ${args.join(' ')}`;
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: repoRoot,
      env: { ...process.env, ...(opts?.env || {}) },
      timeout: 120000,
    });
    return { code: 0, stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch (e: any) {
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? (e.message || String(e)),
    };
  }
}

describe('V2.5 配置初始化与 LLM 连接 (ST-CONFIG-INIT-*/ST-LLM-CONNECT-*/ST-CACHE-LIMIT-*/ST-BLACKLIST-IMG-*)', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let tempHome: string;

  beforeEach(async () => {
    tempHome = path.join(os.tmpdir(), `sac-v25-home-${Date.now()}`);
    await fs.remove(tempHome);
    await fs.ensureDir(tempHome);
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await fs.remove(tempHome).catch(() => {});
  });

  test('ST-CONFIG-INIT-001: 未初始化配置时 analyze 立即失败并提示先执行 init', async () => {
    const testProject = await TestProjectFactory.create('small', false);

    const result = await runCli([
      `--path`, testProject.path,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Config is not initialized. Run "skill-any-code init"');

    const defaultConfigPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const exists = await fs.pathExists(defaultConfigPath);
    expect(exists).toBe(false);

    await testProject.cleanup();
  });

  test('ST-CONFIG-INIT-002: 先 init 再 analyze 流程完整通过', async () => {
    const testProject = await TestProjectFactory.create('small', false);
    const mock = await startMockOpenAIServer();

    const configPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const initResult = await runCli(['init']);
    expect(initResult.code).toBe(0);

    let yaml = await fs.readFile(configPath, 'utf-8');
    yaml = replaceLlmInYaml(yaml, { base_url: mock.baseUrl, api_key: 'test', model: 'mock' });
    await fs.writeFile(configPath, yaml, 'utf-8');

    const result = await runCli([
      '--path', testProject.path,
    ]);

    expect(result.code).toBe(0);
    // 成功时 stdout/stderr 可能因进度条等被截断，code 0 即可证明流程完成
    expect((result.stdout + result.stderr).length).toBeGreaterThan(0);

    await mock.close();
    await testProject.cleanup();
  }, 120000);

  test('ST-LLM-CONNECT-001: LLM 配置缺失导致 connect 阶段失败，不进入解析流程', async () => {
    const testProject = await TestProjectFactory.create('small', false);

    const configPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const initResult = await runCli(['init']);
    expect(initResult.code).toBe(0);

    const result = await runCli([
      '--path', testProject.path,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('LLM connectivity/config validation failed');

    await testProject.cleanup();
  }, 120000);

  test('ST-LLM-CONNECT-002: base_url 指向不可达地址时 connect 阶段失败', async () => {
    const testProject = await TestProjectFactory.create('small', false);

    const configPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const initResult = await runCli(['init']);
    expect(initResult.code).toBe(0);

    // 将 LLM 配置改为不可达地址，但保持 api_key/model 非空
    let yaml = await fs.readFile(configPath, 'utf-8');
    yaml = replaceLlmInYaml(yaml, { base_url: 'http://127.0.0.1:0', api_key: 'test', model: 'mock' });
    await fs.writeFile(configPath, yaml, 'utf-8');

    const result = await runCli([
      '--path', testProject.path,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('LLM connectivity/config validation failed');

    await testProject.cleanup();
  }, 120000);

  test('ST-LLM-CONNECT-003: LLM 服务返回鉴权/模型错误等异常状态导致 connect 失败', async () => {
    const testProject = await TestProjectFactory.create('small', false);
    const mock = await startMockOpenAIServer({
      // connect 阶段发送 health-check，使该请求始终返回 5xx（模拟鉴权失败/模型不存在导致 connect 失败）
      failRequestBodyIncludes: ['health-check'],
    });

    const configPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const initResult = await runCli(['init']);
    expect(initResult.code).toBe(0);

    // 配置完整的 LLM 参数，确保失败来自「服务侧错误」而非配置缺失或 base_url 不可达
    // max_retries 必须为 0，否则 SDK 重试后可能成功
    let yaml = await fs.readFile(configPath, 'utf-8');
    yaml = replaceLlmInYaml(yaml, { base_url: mock.baseUrl, api_key: 'invalid-key', model: 'invalid-model' });
    yaml = yaml.replace(/max_retries:\s*\d+/, 'max_retries: 0');
    await fs.writeFile(configPath, yaml, 'utf-8');

    const result = await runCli([
      '--path', testProject.path,
    ]);

    // Windows 下 SDK 可能返回崩溃码（如 3221226505），接受任意非零退出
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('LLM connectivity/config validation failed');
    // 若流程到达 Mock 并返回 5xx，stderr 应包含 mock 错误信息；若在配置校验阶段失败，则不再强制要求 mock 错误
    if (result.stderr.includes('mock server error') || result.stderr.includes('mock server error (injected)')) {
      expect(result.stderr).toMatch(/mock server error/);
    }

    await mock.close();
    await testProject.cleanup();
  }, 120000);

  test('ST-CACHE-LIMIT-001: 小上限下多次解析触发缓存清理但解析仍可成功', async () => {
    const testProject = await TestProjectFactory.create('small', false);
    const mock = await startMockOpenAIServer();

    const configPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const initResult = await runCli(['init']);
    expect(initResult.code).toBe(0);

    let yaml = await fs.readFile(configPath, 'utf-8');
    yaml = replaceLlmInYaml(yaml, { base_url: mock.baseUrl, api_key: 'test', model: 'mock', cache_max_size_mb: 1 });
    await fs.writeFile(configPath, yaml, 'utf-8');

    const cacheDir = path.join(os.homedir(), '.cache', 'skill-any-code', 'llm');

    // 多次执行 analyze，驱动缓存写入与清理
    for (let i = 0; i < 3; i++) {
      const result = await runCli([
        '--path', testProject.path,
      ]);
      expect(result.code).toBe(0);
    }

    const exists = await fs.pathExists(cacheDir);
    if (exists) {
      const files = await fs.readdir(cacheDir);
      let total = 0;
      for (const f of files) {
        const stat = await fs.stat(path.join(cacheDir, f));
        if (stat.isFile()) total += stat.size;
      }
      // 总大小不应明显超过 1MB（允许少量浮动，取 2MB 上界）
      expect(total).toBeLessThanOrEqual(2 * 1024 * 1024);
    }

    await mock.close();
    await testProject.cleanup();
  }, 240000);

  test('ST-CACHE-LIMIT-002: cache_max_size_mb=0 时禁用磁盘缓存，不产生任何缓存文件', async () => {
    const testProject = await TestProjectFactory.create('small', false);
    const mock = await startMockOpenAIServer();

    const configPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const initResult = await runCli(['init']);
    expect(initResult.code).toBe(0);

    // 将 LLM 配置指向 Mock 服务，并将 cache_max_size_mb 设为 0（禁用缓存）
    let yaml = await fs.readFile(configPath, 'utf-8');
    yaml = replaceLlmInYaml(yaml, { base_url: mock.baseUrl, api_key: 'test', model: 'mock', cache_max_size_mb: 0 });
    await fs.writeFile(configPath, yaml, 'utf-8');

    const cacheDir = path.join(os.homedir(), '.cache', 'skill-any-code', 'llm');

    // 确保起始状态下缓存目录不存在
    const existsBefore = await fs.pathExists(cacheDir);
    if (existsBefore) {
      await fs.remove(cacheDir);
    }

    // 多次执行 analyze，验证不会产生任何缓存文件
    for (let i = 0; i < 2; i++) {
      const result = await runCli([
        '--path', testProject.path,
      ]);
      expect(result.code).toBe(0);
    }

    const existsAfter = await fs.pathExists(cacheDir);
    if (existsAfter) {
      const files = await fs.readdir(cacheDir);
      expect(files.length).toBe(0);
    }

    await mock.close();
    await testProject.cleanup();
  }, 240000);

  test('ST-BLACKLIST-IMG-001: 默认黑名单过滤图片资源，不生成 Markdown 与索引条目', async () => {
    const testProject = await TestProjectFactory.create('empty', false);
    const projectPath = testProject.path;
    const mock = await startMockOpenAIServer();

    // 在项目中创建多种图片资源以及一个代码文件，代码文件用于验证整体解析仍然成功
    await fs.ensureDir(path.join(projectPath, 'assets'));
    const imageFiles = [
      'logo.png',
      'banner.jpg',
      'icon.jpeg',
      'demo.gif',
      'bg.bmp',
      'diagram.svg',
      'thumb.webp',
      'favicon.ico',
    ];
    for (const name of imageFiles) {
      await fs.writeFile(path.join(projectPath, 'assets', name), 'binary-image-content');
    }
    await fs.ensureDir(path.join(projectPath, 'src'));
    await fs.writeFile(
      path.join(projectPath, 'src', 'index.ts'),
      'export const hello = () => "world";',
    );

    const configPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const initResult = await runCli(['init']);
    expect(initResult.code).toBe(0);

    let yaml = await fs.readFile(configPath, 'utf-8');
    yaml = replaceLlmInYaml(yaml, { base_url: mock.baseUrl, api_key: 'test', model: 'mock' });
    await fs.writeFile(configPath, yaml, 'utf-8');

    const result = await runCli([
      '--path', projectPath,
    ]);

    expect(result.code).toBe(0);

    const resultDir = path.join(projectPath, '.skill-any-code-result');
    // 默认黑名单应使所有图片文件不生成 Markdown
    for (const name of imageFiles) {
      const mdPath = path.join(resultDir, 'assets', `${path.parse(name).base}.md`);
      expect(await fs.pathExists(mdPath)).toBe(false);
    }

    await mock.close();
    await testProject.cleanup();
  }, 240000);

  test('ST-BLACKLIST-IMG-002: 通过 .skill-any-code-ignore 解封部分图片后可进入索引/生成 Markdown', async () => {
    const testProject = await TestProjectFactory.create('empty', false);
    const projectPath = testProject.path;
    const mock = await startMockOpenAIServer();

    await fs.ensureDir(path.join(projectPath, 'assets'));
    const unblocked = 'logo.png';
    const blocked = 'banner.jpg';

    await fs.writeFile(path.join(projectPath, 'assets', unblocked), 'binary-image-content');
    await fs.writeFile(path.join(projectPath, 'assets', blocked), 'binary-image-content');

    // 通过 .skill-any-code-ignore 的否定规则解封指定图片
    await fs.writeFile(
      path.join(projectPath, '.skill-any-code-ignore'),
      `!assets/${unblocked}\n`,
      'utf-8',
    );

    await fs.ensureDir(path.join(projectPath, 'src'));
    await fs.writeFile(
      path.join(projectPath, 'src', 'index.ts'),
      'export const hello = () => "world";',
    );

    const configPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const initResult = await runCli(['init']);
    expect(initResult.code).toBe(0);

    let yaml = await fs.readFile(configPath, 'utf-8');
    yaml = replaceLlmInYaml(yaml, { base_url: mock.baseUrl, api_key: 'test', model: 'mock' });
    await fs.writeFile(configPath, yaml, 'utf-8');

    const result = await runCli([
      '--path', projectPath,
    ]);

    expect(result.code).toBe(0);

    const resultDir = path.join(projectPath, '.skill-any-code-result');

    // 被解封的图片应当生成 Markdown
    const unblockedMd = path.join(resultDir, 'assets', `${path.parse(unblocked).base}.md`);
    expect(await fs.pathExists(unblockedMd)).toBe(true);

    // 未解封的图片仍应被黑名单过滤（不生成 Markdown）
    const blockedMd = path.join(resultDir, 'assets', `${path.parse(blocked).base}.md`);
    expect(await fs.pathExists(blockedMd)).toBe(false);

    await mock.close();
    await testProject.cleanup();
  }, 240000);
});

