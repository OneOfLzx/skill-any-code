import OpenAI from 'openai';
import { OpenAIClient } from '../../../src/infrastructure/llm/openai.client';
import { ErrorCode } from '../../../src/common/errors';

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            model: 'mock-model',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    name: 'add.ts',
                    language: 'TypeScript',
                    linesOfCode: 1,
                    dependencies: [],
                    summary: '测试文件',
                    classes: [],
                    functions: [],
                    classDiagram: '',
                    sequenceDiagram: '',
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        },
      },
    })),
  };
});

describe('LLM 客户端与解析测试', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * UT-LLM-004: 正常LLM调用解析
   */
  test('UT-LLM-004: 正常代码文件调用LLM解析返回正确结构', async () => {
    const client = new OpenAIClient({
      base_url: 'http://127.0.0.1:12345/v1',
      api_key: 'test',
      model: 'mock-model',
      temperature: 0.1,
      max_tokens: 1000,
      timeout: 1000,
      max_retries: 0,
      retry_delay: 10,
      context_window_size: 1000,
      cache_enabled: true,
      cache_dir: './.cache',
      cache_max_size_mb: 0,
    });

    const resp = await client.call('prompt');
    const parsed = JSON.parse(resp.content);
    expect(parsed.summary).toBe('测试文件');
    expect(parsed.language).toBe('TypeScript');
    expect((OpenAI as unknown as jest.Mock)).toHaveBeenCalled();
  });

  /**
   * UT-LLM-005: 罕见语言代码解析
   */
  test('UT-LLM-014(覆盖): OpenAIClient 限流错误映射为 LLM_RATE_LIMITED', async () => {
    const client = new OpenAIClient({
      base_url: 'http://127.0.0.1:12345/v1',
      api_key: 'test',
      model: 'mock-model',
      temperature: 0.1,
      max_tokens: 1000,
      timeout: 1000,
      max_retries: 0,
      retry_delay: 10,
      context_window_size: 1000,
      cache_enabled: true,
      cache_dir: './.cache',
      cache_max_size_mb: 0,
    });

    // 让 create 抛出 status=429
    const instance = (OpenAI as unknown as jest.Mock).mock.results.at(-1)?.value;
    instance.chat.completions.create.mockRejectedValueOnce({ status: 429, message: 'rate limited' });

    await expect(client.call('prompt')).rejects.toMatchObject({ code: ErrorCode.LLM_RATE_LIMITED });
  });

  /**
   * UT-LLM-006: 无后缀文件解析
   */
  test('UT-LLM-017(覆盖): OpenAIClient 超时错误映射为 LLM_TIMEOUT', async () => {
    const client = new OpenAIClient({
      base_url: 'http://127.0.0.1:12345/v1',
      api_key: 'test',
      model: 'mock-model',
      temperature: 0.1,
      max_tokens: 1000,
      timeout: 1,
      max_retries: 0,
      retry_delay: 10,
      context_window_size: 1000,
      cache_enabled: true,
      cache_dir: './.cache',
      cache_max_size_mb: 0,
    });

    const instance = (OpenAI as unknown as jest.Mock).mock.results.at(-1)?.value;
    instance.chat.completions.create.mockRejectedValueOnce({ code: 'ETIMEDOUT', message: 'timeout' });

    await expect(client.call('prompt')).rejects.toMatchObject({ code: ErrorCode.LLM_TIMEOUT });
  });
});
