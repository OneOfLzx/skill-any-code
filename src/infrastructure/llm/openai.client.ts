import OpenAI from 'openai';
import { ILLMClient } from '../../domain/interfaces';
import { LLMConfig, LLMCallOptions, LLMResponse } from '../../common/types';
import { LLMUsageTracker } from './llm.usage.tracker';
import { AppError, ErrorCode } from '../../common/errors';
import { logger } from '../../common/logger';

export class OpenAIClient implements ILLMClient {
  private client: OpenAI;
  private config: LLMConfig;
  private tracker?: LLMUsageTracker;

  constructor(config: LLMConfig, tracker?: LLMUsageTracker) {
    this.config = config;
    this.tracker = tracker;
    this.client = new OpenAI({
      apiKey: config.api_key,
      baseURL: config.base_url,
      timeout: config.timeout,
      dangerouslyAllowBrowser: true,
    });
  }

  /**
   * 连接可用性校验（V2.5）
   * - 在进入任何解析流程前调用；
   * - 配置不完整或服务不可用时抛出带有明确 ErrorCode 的 AppError。
   */
  async testConnection(config: LLMConfig): Promise<void> {
    // 保持与最新配置一致（允许运行时通过 CLI/环境变量覆盖）
    this.config = config;
    // 基本配置校验：base_url / api_key / model 不能为空
    if (!this.config.base_url || !this.config.api_key || !this.config.model) {
      throw new AppError(
        ErrorCode.LLM_INVALID_CONFIG,
        'Incomplete LLM config. Please set base_url/api_key/model via config file, env vars, or CLI options.',
        {
          missing: {
            base_url: !this.config.base_url,
            api_key: !this.config.api_key,
            model: !this.config.model,
          },
        },
      );
    }

    try {
      const res = await this.client.chat.completions.create({
        model: this.config.model,
        temperature: 0,
        max_tokens: 1,
        messages: [{ role: 'system', content: 'health-check' }],
      } as any);

      const status = (res as any).status ?? 200;
      if (status === 401) {
        throw new AppError(ErrorCode.LLM_CALL_FAILED, 'LLM authentication failed (401)', { status });
      }
      if (status === 404) {
        throw new AppError(ErrorCode.LLM_CALL_FAILED, 'LLM model not found (404)', { status });
      }
      if (status < 200 || status >= 300) {
        throw new AppError(
          ErrorCode.LLM_CALL_FAILED,
          `LLM connectivity check returned non-2xx status: ${status}`,
          { status },
        );
      }
    } catch (e: any) {
      if (e instanceof AppError) {
        throw e;
      }
      const code = e?.code || e?.status;
      if (code === 'ETIMEDOUT') {
        throw new AppError(ErrorCode.LLM_TIMEOUT, 'LLM connectivity check timed out', e);
      }
      if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ECONNRESET') {
        throw new AppError(ErrorCode.LLM_CALL_FAILED, 'Unable to reach LLM service. Check network or base_url.', e);
      }
      throw new AppError(
        ErrorCode.LLM_CALL_FAILED,
        `LLM connectivity check failed: ${e?.message || String(e)}`,
        e,
      );
    }
  }

  /**
   * 向后兼容旧版本/测试中使用的 connectTest 名称。
   * 内部直接代理到 V2.5 的 testConnection。
   */
  async connectTest(): Promise<void> {
    await this.testConnection(this.config);
  }

  async call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    const retries = options?.retries ?? this.config.max_retries;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: options?.model ?? this.config.model,
          temperature: options?.temperature ?? this.config.temperature,
          max_tokens: options?.maxTokens ?? this.config.max_tokens,
          messages: [
            { role: 'user', content: prompt }
          ]
        });

        const content = response.choices[0].message.content || '';
        const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

        const normalizedUsage = {
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
        };

        if (this.tracker) {
          this.tracker.addUsage(normalizedUsage);
        }

        return {
          content,
          usage: normalizedUsage,
          model: response.model,
          responseTime: Date.now() - startTime,
        };
      } catch (error: any) {
        const errorMessage = error?.message || 'Unknown LLM call error';
        logger.debug(`LLM call attempt ${attempt + 1} failed: ${errorMessage}`);

        if (attempt === retries) {
          if (error?.status === 429) {
            throw new AppError(ErrorCode.LLM_RATE_LIMITED, 'LLM service rate limited', error);
          } else if (error?.code === 'ETIMEDOUT') {
            throw new AppError(ErrorCode.LLM_TIMEOUT, 'LLM call timeout', error);
          } else {
            throw new AppError(ErrorCode.LLM_CALL_FAILED, `LLM call failed: ${errorMessage}`, error);
          }
        }

        await this.sleep(this.config.retry_delay * Math.pow(2, attempt));
      }
    }

    throw new AppError(ErrorCode.LLM_CALL_FAILED, 'Max retries exceeded');
  }

  async batchCall(prompts: string[], options?: LLMCallOptions): Promise<LLMResponse[]> {
    const results: LLMResponse[] = [];
    for (const prompt of prompts) {
      results.push(await this.call(prompt, options));
    }
    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
