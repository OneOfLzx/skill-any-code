import OpenAI from 'openai';
import { OpenAIClient } from '../../../src/infrastructure/llm/openai.client';
import { LLMConfig } from '../../../src/common/types';
import { AppError, ErrorCode } from '../../../src/common/errors';

jest.mock('openai');

const omitUndefined = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;

const createConfig = (partial: Partial<LLMConfig> = {}): LLMConfig => {
  const clean = omitUndefined(partial);

  return {
    model: 'test-model',
    api_key: 'test-key',
    base_url: 'http://localhost:12345',
    temperature: 0.1,
    max_tokens: 100,
    timeout: 1000,
    proxy: undefined,
    max_retries: 0,
    retry_delay: 1,
    context_window_size: 1000,
    cache_enabled: false,
    cache_dir: '/tmp',
    cache_max_size_mb: 10,
    ...clean,
  };
};

describe('OpenAIClient connectTest (UT-LLM-CONNECT-001~004)', () => {
  const mockCreate = jest.fn();

  beforeEach(() => {
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    }));
    mockCreate.mockReset();
  });

  test('UT-LLM-CONNECT-001: 配置完整时 connectTest 应通过', async () => {
    mockCreate.mockResolvedValue({ status: 200 });
    const client = new OpenAIClient(createConfig());
    await expect(client.connectTest()).resolves.toBeUndefined();
    expect(mockCreate).toHaveBeenCalled();
  });

  test('UT-LLM-CONNECT-002: base_url 为空时 connectTest 抛出配置不完整错误', async () => {
    const client = new OpenAIClient(createConfig({ base_url: '' }));
    await expect(client.connectTest()).rejects.toBeInstanceOf(AppError);
    await expect(client.connectTest()).rejects.toMatchObject({
      code: ErrorCode.LLM_INVALID_CONFIG,
    });
  });

  test('UT-LLM-CONNECT-003: api_key 错误时应映射为鉴权失败', async () => {
    mockCreate.mockResolvedValue({ status: 401 });
    const client = new OpenAIClient(createConfig());
    await expect(client.connectTest()).rejects.toMatchObject({
      code: ErrorCode.LLM_CALL_FAILED,
      message: expect.stringContaining('鉴权失败'),
    });
  });

  test('UT-LLM-CONNECT-004: 模型不存在时应映射为模型错误', async () => {
    mockCreate.mockResolvedValue({ status: 404 });
    const client = new OpenAIClient(createConfig());
    await expect(client.connectTest()).rejects.toMatchObject({
      code: ErrorCode.LLM_CALL_FAILED,
      message: expect.stringContaining('模型不存在'),
    });
  });
});

