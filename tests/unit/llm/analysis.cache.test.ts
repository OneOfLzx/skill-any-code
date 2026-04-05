import fs from 'fs-extra';
import path from 'path';
import { FileHashCache } from '../../../src/infrastructure/cache/file.hash.cache';
import { LLMAnalysisService } from '../../../src/application/services/llm.analysis.service';
import { CodeSplitter } from '../../../src/infrastructure/splitter/code.splitter';
import { ILLMClient } from '../../../src/domain/interfaces';
import { FileAnalysis } from '../../../src/common/types';

describe('解析结果缓存机制测试', () => {
  const cacheDir = path.join(__dirname, '../../.cache/test');
  let cache: FileHashCache;
  let llmClient: jest.Mocked<ILLMClient>;
  let splitter: CodeSplitter;
  let svc: LLMAnalysisService;
  const baseConfig = {
    base_url: 'http://127.0.0.1:12345/v1',
    api_key: 'k',
    model: 'm',
    temperature: 0.1,
    max_tokens: 1000,
    timeout: 1000,
    max_retries: 0,
    retry_delay: 10,
    context_window_size: 1000,
    cache_enabled: true,
    cache_dir: cacheDir,
  };

  beforeEach(async () => {
    await fs.remove(cacheDir);
    cache = new FileHashCache({ cacheDir, maxSizeMb: 500 });
    llmClient = {
      call: jest.fn(),
      batchCall: jest.fn(),
    } as any;
    splitter = new CodeSplitter(llmClient);
    svc = new LLMAnalysisService(llmClient, splitter, cache, baseConfig as any);
  });

  afterEach(async () => {
    await fs.remove(cacheDir);
  });

  /** 三步协议下，为一次文件解析 mock 三次 LLM 调用（结构 → 功能描述 → 概述） */
  function mockThreeStepCalls(opts: { name: string; language: string; linesOfCode: number; dependencies: string[]; classes: any[]; functions: any[]; description: string; summary: string }) {
    const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    const meta = { usage, model: 'm', responseTime: 1 };
    llmClient.call
      .mockResolvedValueOnce({ content: JSON.stringify({ name: opts.name, language: opts.language, linesOfCode: opts.linesOfCode, dependencies: opts.dependencies, classes: opts.classes, functions: opts.functions }), ...meta })
      .mockResolvedValueOnce({ content: JSON.stringify({ description: opts.description }), ...meta })
      .mockResolvedValueOnce({ content: JSON.stringify({ summary: opts.summary }), ...meta });
  }

  /**
   * UT-LLM-011: 未修改文件缓存命中
   */
  test('UT-LLM-011: 文件内容未修改时命中缓存，不调用LLM', async () => {
    const code = 'export const a = 1;';
    const filePath = 'test.ts';
    const fileHash = FileHashCache.calculateFileHash(code);

    mockThreeStepCalls({
      name: 'test.ts',
      language: 'TypeScript',
      linesOfCode: 1,
      dependencies: [],
      classes: [],
      functions: [],
      description: '测试功能描述',
      summary: '测试文件',
    });

    const result1 = await svc.analyzeFile(filePath, code, fileHash);
    expect(llmClient.call).toHaveBeenCalledTimes(3);
    expect(result1.summary).toBe('测试文件');

    // 第二次解析，缓存命中
    const result2 = await svc.analyzeFile(filePath, code, fileHash);
    expect(llmClient.call).toHaveBeenCalledTimes(3);
    expect(result2.summary).toBe(result1.summary);
  });

  /**
   * UT-LLM-012: 修改文件缓存未命中
   */
  test('UT-LLM-012: 文件内容修改后缓存未命中，重新调用LLM', async () => {
    const code1 = 'export const a = 1;';
    const code2 = 'export const a = 2;';
    const filePath = 'test.ts';

    mockThreeStepCalls({ name: 'test.ts', language: 'TypeScript', linesOfCode: 1, dependencies: [], classes: [], functions: [], description: 'd1', summary: 'v1' });
    mockThreeStepCalls({ name: 'test.ts', language: 'TypeScript', linesOfCode: 1, dependencies: [], classes: [], functions: [], description: 'd2', summary: 'v2' });

    const hash1 = FileHashCache.calculateFileHash(code1);
    const result1 = await svc.analyzeFile(filePath, code1, hash1);
    expect(result1.summary).toBe('v1');

    const hash2 = FileHashCache.calculateFileHash(code2);
    const result2 = await svc.analyzeFile(filePath, code2, hash2);
    expect(llmClient.call).toHaveBeenCalledTimes(6);
    expect(result2.summary).toBe('v2');
  });

  /**
   * UT-LLM-013: 缓存手动清理
   */
  test('UT-LLM-013: 手动清理缓存后所有缓存失效', async () => {
    const code = 'export const a = 1;';
    const filePath = 'test.ts';

    mockThreeStepCalls({ name: 'test.ts', language: 'TypeScript', linesOfCode: 1, dependencies: [], classes: [], functions: [], description: 'desc', summary: 'once' });
    mockThreeStepCalls({ name: 'test.ts', language: 'TypeScript', linesOfCode: 1, dependencies: [], classes: [], functions: [], description: 'desc', summary: 'once' });

    const hash = FileHashCache.calculateFileHash(code);
    await svc.analyzeFile(filePath, code, hash);
    expect(await fs.pathExists(cacheDir)).toBe(true);

    await cache.clear();
    const filesAfterClear = await fs.readdir(cacheDir);
    expect(filesAfterClear.length).toBe(0);

    await svc.analyzeFile(filePath, code, hash);
    expect(llmClient.call).toHaveBeenCalledTimes(6);
  });
});
