import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { startMockOpenAIServer } from '../utils/mock-openai-server';

const execAsync = promisify(exec);

describe('Config System Test (ST-CFG-*)', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const tempHome = path.join(os.tmpdir(), 'skill-any-code-test-st-config');
  let tempProjectDir: string;
  const cliPath = path.join(__dirname, '../../dist/cli.js');
  const originalCwd = process.cwd();
  let mock: { baseUrl: string; close: () => Promise<void> };
  
  beforeEach(async () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    
    await fs.remove(tempHome);
    await fs.ensureDir(tempHome);
    
    tempProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-any-code-test-st-project-'));
    await fs.writeFile(path.join(tempProjectDir, 'index.ts'), 'console.log("test");');
    mock = await startMockOpenAIServer();
    
    // 先构建项目确保cli可用
    await execAsync('npm run build', { cwd: path.join(__dirname, '../../') });
  });
  
  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    process.chdir(originalCwd);
    
    await fs.remove(tempHome);
    await mock.close();
    await fs.remove(tempProjectDir);
  });
  
  test('ST-CFG-001: 默认配置路径场景测试，先 init 再 analyze 时配置在正确位置', async () => {
    process.chdir(tempProjectDir);

    await execAsync(`node ${cliPath} init`, {
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome
      }
    });

    await execAsync(`node ${cliPath} --path "${tempProjectDir}" --mode full --no-skills --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-model mock --llm-max-retries 0`, {
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome
      }
    });
    
    const expectedConfigPath = path.join(tempHome, '.config', 'skill-any-code', 'config.yaml');
    const projectConfigPath = path.join(tempProjectDir, '~', '.config', 'skill-any-code', 'config.yaml');
    
    const homeConfigExists = await fs.pathExists(expectedConfigPath);
    expect(homeConfigExists).toBe(true);
    
    const projectConfigExists = await fs.pathExists(projectConfigPath);
    expect(projectConfigExists).toBe(false);
  });
});
