import { configManager } from '../../src/common/config';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Config Path Integration Test (INT-CFG-*)', () => {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const tempHome = path.join(os.tmpdir(), 'skill-any-code-test-int-config');
  let tempProjectDir: string;
  
  beforeEach(async () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    
    await fs.remove(tempHome);
    await fs.ensureDir(tempHome);
    
    tempProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-any-code-test-project-'));
    await fs.writeFile(path.join(tempProjectDir, 'index.ts'), 'console.log("test");');
    
    (configManager as any).config = null;
    (configManager as any).configPath = '';
  });
  
  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    process.chdir(originalCwd);
    
    await fs.remove(tempHome);
    await fs.remove(tempProjectDir);
  });
  
  test('INT-CFG-001: 先 init 创建配置后 load 验证路径在用户目录而非项目目录', async () => {
    process.chdir(tempProjectDir);

    await configManager.init();
    await configManager.load();

    const expectedConfigPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const projectConfigPath = path.join(tempProjectDir, '~', '.config', 'skill-any-code', 'config.yaml');

    const homeConfigExists = await fs.pathExists(expectedConfigPath);
    expect(homeConfigExists).toBe(true);

    const projectConfigExists = await fs.pathExists(projectConfigPath);
    expect(projectConfigExists).toBe(false);
  });
  
  // CLI 不再提供 config 子命令；仅保留 ConfigManager 的路径行为集成验证（INT-CFG-001）
});
