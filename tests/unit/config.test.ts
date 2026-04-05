import { configManager } from '../../src/common/config';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { Config } from '../../src/common/config';

describe('ConfigManager 配置路径测试 (UT-CFG-*)', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const tempHome = path.join(os.tmpdir(), 'skill-any-code-test-config');
  
  beforeEach(async () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    
    await fs.remove(tempHome);
    await fs.ensureDir(tempHome);
    
    (configManager as any).config = null;
    (configManager as any).configPath = '';
  });
  
  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    
    await fs.remove(tempHome);
  });
  
  test('UT-CFG-001: 配置路径波浪号展开测试，验证~路径正确解析为用户home目录', async () => {
    const customPath = '~/.test-config.yaml';
    await configManager.init(customPath);

    await configManager.load(customPath);

    const expectedPath = path.join(tempHome, '.test-config.yaml');
    expect((configManager as any).configPath).toBe(expectedPath);

    const exists = await fs.pathExists(expectedPath);
    expect(exists).toBe(true);
  });
  
  test('UT-CFG-002: 配置路径优先级测试，验证CLI参数优先级高于内部默认路径', async () => {
    const customPath = path.join(tempHome, 'custom-config.yaml');
    await configManager.init(customPath);

    await configManager.load(customPath);

    expect((configManager as any).configPath).toBe(customPath);

    const defaultPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const defaultExists = await fs.pathExists(defaultPath);
    expect(defaultExists).toBe(false);

    const customExists = await fs.pathExists(customPath);
    expect(customExists).toBe(true);
  });
  
  test('UT-CFG-003: 不传入自定义路径时使用默认配置路径', async () => {
    await configManager.init();

    await configManager.load();

    const expectedPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    expect((configManager as any).configPath).toBe(expectedPath);

    const exists = await fs.pathExists(expectedPath);
    expect(exists).toBe(true);
  });
  
  test('UT-CFG-004: Windows环境下USERPROFILE环境变量优先级测试', async () => {
    delete process.env.HOME;
    process.env.USERPROFILE = tempHome;

    await configManager.init();

    await configManager.load();

    const expectedPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    expect((configManager as any).configPath).toBe(expectedPath);
  });

  // ===== V2.5 配置初始化与默认值测试 (UT-CONFIG-001~004 / UT-BLACKLIST-IMG-001) =====

  test('UT-CONFIG-001: 配置文件不存在时 load 表示未初始化且不自动创建文件', async () => {
    const customPath = path.join(tempHome, 'v25-missing-config.yaml');

    const existsBefore = await fs.pathExists(customPath);
    expect(existsBefore).toBe(false);

    await expect(configManager.load(customPath)).rejects.toMatchObject({
      message: expect.stringContaining('配置文件未初始化'),
    });

    const existsAfter = await fs.pathExists(customPath);
    expect(existsAfter).toBe(false);
  });

  test('UT-CONFIG-002: init 会在配置不存在时创建默认配置文件', async () => {
    const customPath = path.join(tempHome, 'v25-init-config.yaml');

    await configManager.init(customPath);

    const exists = await fs.pathExists(customPath);
    expect(exists).toBe(true);

    const content = await fs.readFile(customPath, 'utf-8');
    const loaded = (await import('js-yaml')).default.load(content) as Config;
    const defaultConfig = (configManager as any).config as Config;

    expect(loaded).toEqual(defaultConfig);
  });

  test('UT-V25-CFG-LLM-DEFAULTS: 默认 LLM 配置 base_url/api_key/model 为空且包含 cache_max_size_mb', async () => {
    try {
      await configManager.load(path.join(tempHome, 'v25-defaults.yaml'));
    } catch {
      // 预期：因为文件不存在会抛「未初始化」，但内部仍会生成默认配置对象
    }
    const defaultConfig = (configManager as any).config as Config;
    expect(defaultConfig.llm.base_url).toBe('');
    expect(defaultConfig.llm.api_key).toBe('');
    expect(defaultConfig.llm.model).toBe('');
    expect(typeof defaultConfig.llm.cache_max_size_mb).toBe('number');
    expect(defaultConfig.llm.cache_max_size_mb).toBeGreaterThanOrEqual(0);
  });

  test('UT-BLACKLIST-IMG-001: 默认黑名单应包含常见图片与图标扩展名', async () => {
    try {
      await configManager.load(path.join(tempHome, 'v25-blacklist.yaml'));
    } catch {
      // 同上：忽略未初始化异常，仅使用默认配置对象
    }
    const defaultConfig = (configManager as any).config as Config;
    const patterns = defaultConfig.analyze.blacklist as string[];

    const required = [
      '*.png', '*.jpg', '*.jpeg', '*.gif',
      '*.bmp', '*.svg', '*.webp', '*.ico',
    ];

    for (const p of required) {
      expect(patterns).toContain(p);
    }
  });

  // ===== V2.3 新增配置项测试 (UT-CLI-007 / UT-V23-CFG-*) =====
  test('UT-V23-CFG-001: skills.default_providers 默认值应包含 opencode,cursor,claude,codex', async () => {
    await configManager.init();
    await configManager.load();
    const config = configManager.getConfig();
    expect(config.skills.default_providers).toBeDefined();
    expect(config.skills.default_providers).toContain('opencode');
    expect(config.skills.default_providers).toContain('cursor');
    expect(config.skills.default_providers).toContain('claude');
    expect(config.skills.default_providers).toContain('codex');
  });

  test('UT-V23-CFG-002: analyze.blacklist 默认值应为数组且包含常用模式', async () => {
    await configManager.init();
    await configManager.load();
    const config = configManager.getConfig();
    expect(Array.isArray(config.analyze.blacklist)).toBe(true);
    expect(config.analyze.blacklist.some((p: string) => p.includes('*.md') || p === '*.md')).toBe(true);
    expect(config.analyze.blacklist.some((p: string) => p.includes('node_modules'))).toBe(true);
  });

  test('UT-V23-CFG-006: 完整配置应包含 global、analyze、skills、llm 且 analyze 含 blacklist', async () => {
    await configManager.init();
    await configManager.load();
    const config = configManager.getConfig();
    expect(config).toHaveProperty('global');
    expect(config).toHaveProperty('analyze');
    expect(config).toHaveProperty('skills');
    expect(config).toHaveProperty('llm');
    expect(config.analyze).toHaveProperty('blacklist');
  });
});
