import * as fs from 'fs-extra';
import * as path from 'path';
import { getE2ELLMMood, loadE2EApiKey } from './utils/e2e-env';

describe('E2E Env Helpers (文档第11章规范)', () => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const privDataDir = path.join(projectRoot, 'tests', 'priv_data');
  const apiKeyFile = path.join(privDataDir, 'api_key.txt');

  afterEach(async () => {
    delete process.env.SKILL_ANY_CODE_E2E_LLM_MODE;
    await fs.remove(privDataDir);
  });

  describe('getE2ELLMMood', () => {
    test('默认使用 mock 模式', () => {
      delete process.env.SKILL_ANY_CODE_E2E_LLM_MODE;

      const result = getE2ELLMMood();
      expect(result.mode).toBe('mock');
      expect(result.useMockLLM).toBe(true);
    });

    test('显式设置为 real 时不使用 mock', () => {
      process.env.SKILL_ANY_CODE_E2E_LLM_MODE = 'real';

      const result = getE2ELLMMood();
      expect(result.mode).toBe('real');
      expect(result.useMockLLM).toBe(false);
    });

    test('非法取值时回退到 mock', () => {
      process.env.SKILL_ANY_CODE_E2E_LLM_MODE = 'unknown';

      const result = getE2ELLMMood();
      expect(result.mode).toBe('mock');
      expect(result.useMockLLM).toBe(true);
    });
  });

  describe('loadE2EApiKey', () => {
    test('不存在 api_key.txt 时返回 null', async () => {
      const key = await loadE2EApiKey(projectRoot);
      expect(key).toBeNull();
    });

    test('读取首个非空非注释行作为 API Key', async () => {
      await fs.ensureDir(privDataDir);
      await fs.writeFile(
        apiKeyFile,
        [
          '# comment line',
          '',
          '   ',
          'sk-test-abc123',
          'sk-other-should-be-ignored',
        ].join('\n'),
        'utf-8',
      );

      const key = await loadE2EApiKey(projectRoot);
      expect(key).toBe('sk-test-abc123');
    });
  });
});

