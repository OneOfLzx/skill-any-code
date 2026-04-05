import { OpenAIClient } from '../../../src/infrastructure/llm/openai.client';
import { ErrorCode } from '../../../src/common/errors';
import OpenAI from 'openai';

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    })),
  };
});

describe('LLM错误处理与重试测试（V2.1）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('UT-LLM-014: LLM调用失败时按max_retries重试，最终成功', async () => {
    const client = new OpenAIClient({
      base_url: 'http://127.0.0.1:12345/v1',
      api_key: 'k',
      model: 'm',
      temperature: 0.1,
      max_tokens: 1000,
      timeout: 1000,
      max_retries: 1,
      retry_delay: 1,
      context_window_size: 1000,
      cache_enabled: true,
      cache_dir: './.cache',
      cache_max_size_mb: 0,
    });

    const instance = (OpenAI as unknown as jest.Mock).mock.results.at(-1)?.value;
    const create = instance.chat.completions.create as jest.Mock;
    create
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({
        model: 'm',
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

    const resp = await client.call('prompt');
    expect(JSON.parse(resp.content)).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
  });

  test('UT-LLM-017: 达到最大重试后抛出 LLM_CALL_FAILED', async () => {
    const client = new OpenAIClient({
      base_url: 'http://127.0.0.1:12345/v1',
      api_key: 'k',
      model: 'm',
      temperature: 0.1,
      max_tokens: 1000,
      timeout: 1000,
      max_retries: 0,
      retry_delay: 1,
      context_window_size: 1000,
      cache_enabled: true,
      cache_dir: './.cache',
      cache_max_size_mb: 0,
    });

    const instance = (OpenAI as unknown as jest.Mock).mock.results.at(-1)?.value;
    const create = instance.chat.completions.create as jest.Mock;
    create.mockRejectedValue(new Error('always fail'));

    await expect(client.call('prompt')).rejects.toMatchObject({ code: ErrorCode.LLM_CALL_FAILED });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
