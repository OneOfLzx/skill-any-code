import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { configManager } from '../../src/common/config';

describe('CLI默认配置路径测试 (UT-CLI-CFG-*)', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const tempHome = path.join(os.tmpdir(), 'skill-any-code-test-cli-config');
  const originalCwd = process.cwd();

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
    process.chdir(originalCwd);
    await fs.remove(tempHome);
  });

  test('UT-CLI-CFG-002: CLI默认配置路径展开正确', async () => {
    // V2.5：先 init 创建配置，再 load 验证路径
    await configManager.init();
    await configManager.load();

    const expectedConfigPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const configExists = await fs.pathExists(expectedConfigPath);
    expect(configExists).toBe(true);

    const oldConfigPath = path.join(tempHome, '.old-config-location', 'config.yaml');
    const oldConfigExists = await fs.pathExists(oldConfigPath);
    expect(oldConfigExists).toBe(false);
  });
});
