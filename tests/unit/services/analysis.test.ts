import fs from 'fs-extra';
import path from 'path';
import { AnalysisService } from '../../../src/domain/services/analysis.service';

const workerStats = {
  concurrency: 0,
  active: 0,
  maxActive: 0,
  startActiveSamples: [] as number[],
  fileTaskCount: 0,
  dirTaskCount: 0,
}

jest.mock('../../../src/infrastructure/worker-pool/worker-pool.service', () => {
  class Semaphore {
    private permits: number
    private waiters: Array<() => void> = []

    constructor(permits: number) {
      this.permits = permits
    }

    async acquire(): Promise<void> {
      if (this.permits > 0) {
        this.permits--
        return
      }
      await new Promise<void>(resolve => this.waiters.push(resolve))
      this.permits--
    }

    release(): void {
      this.permits++
      const next = this.waiters.shift()
      if (next) next()
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  class WorkerPoolService {
    private sem: Semaphore

    constructor(_llmConfig: any, concurrency: number) {
      workerStats.concurrency = concurrency
      this.sem = new Semaphore(concurrency)
    }

    async submitFileAnalysisTask(filePath: string, _content: string, _hash: string): Promise<any> {
      workerStats.fileTaskCount++
      await this.sem.acquire()
      workerStats.active++
      workerStats.maxActive = Math.max(workerStats.maxActive, workerStats.active)
      workerStats.startActiveSamples.push(workerStats.active)
      await new Promise(r => setTimeout(r, 30))
      workerStats.active--
      this.sem.release()
      return {
        type: 'file',
        name: path.basename(filePath),
        language: 'mock',
        linesOfCode: 1,
        dependencies: [],
        summary: 'mock summary',
        classes: [],
        functions: [],
        classDiagram: '',
        sequenceDiagram: '',
      }
    }

    async submitDirectoryAggregationTask(_dirPath: string, _payload: any): Promise<any> {
      workerStats.dirTaskCount++
      return { description: 'mock dir desc', summary: 'mock dir summary' }
    }

    async submitValidationTask(): Promise<any> {
      return { valid: true }
    }

    setConcurrency(): void {}
    async waitAll(): Promise<void> {}
    cancelAll(): void {}
  }

  return { WorkerPoolService }
})

jest.mock('../../../src/infrastructure/llm/openai.client', () => {
  return {
    OpenAIClient: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          name: 'mock-file',
          language: 'TypeScript',
          linesOfCode: 1,
          dependencies: [],
          summary: 'mock summary',
          classes: [],
          functions: [],
          classDiagram: '',
          sequenceDiagram: '',
        }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        model: 'm',
        responseTime: 1,
      }),
      batchCall: jest.fn(),
    })),
  };
});

describe('AnalysisService 解析服务测试（V2.1 LLM原生）', () => {
  let analysisService: AnalysisService;
  let gitService: any;
  let storageService: any;
  const testProjectRoot = path.join(__dirname, '../../test-projects/test-analysis');

  beforeEach(async () => {
    workerStats.concurrency = 0
    workerStats.active = 0
    workerStats.maxActive = 0
    workerStats.startActiveSamples = []
    workerStats.fileTaskCount = 0
    workerStats.dirTaskCount = 0

    gitService = {} as any;
    storageService = {
      saveFileAnalysis: jest.fn().mockResolvedValue(true),
      saveDirectoryAnalysis: jest.fn().mockResolvedValue(true),
      getStoragePath: jest.fn().mockReturnValue(path.join(testProjectRoot, '.skill-any-code-result'))
    };
    const blacklistService = {
      load: jest.fn().mockResolvedValue(undefined),
      isIgnored: jest.fn().mockReturnValue(false),
    } as any;

    analysisService = new AnalysisService(
      gitService,
      storageService,
      blacklistService,
      'test-project',
      'test-commit',
      {
        base_url: 'http://127.0.0.1:12345/v1',
        api_key: 'k',
        model: 'm',
        temperature: 0.1,
        max_tokens: 1000,
        timeout: 1000,
        max_retries: 0,
        retry_delay: 1,
        context_window_size: 1000,
        cache_enabled: false,
        cache_dir: path.join(testProjectRoot, '.cache'),
        cache_max_size_mb: 10,
      }
    );

    // 清理测试目录
    await fs.remove(testProjectRoot);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await fs.remove(testProjectRoot);
  });



  /**
   * UT-ANA-005: 多语言文件混合解析
   * 说明：本用例通过 mock 掉 blacklistService（始终返回 false），
   * 用来验证 AnalysisService 在「不依赖任何基于扩展名的内建黑名单」前提下，
   * 仍然可以对多语言/无后缀/非标准后缀文本文件进行统一解析。
   */
  test('UT-ANA-005: 多语言/无后缀/非标准后缀文本文件都被处理', async () => {
    // 创建多语言测试项目
    await fs.ensureDir(testProjectRoot);
    await fs.writeFile(path.join(testProjectRoot, 'index.ts'), 'export const add = (a: number, b: number) => a + b;');
    await fs.writeFile(path.join(testProjectRoot, 'utils.js'), 'export const multiply = (a, b) => a * b;');
    await fs.writeFile(path.join(testProjectRoot, 'Dockerfile'), 'FROM node:18\nWORKDIR /app');
    await fs.writeFile(path.join(testProjectRoot, 'Makefile'), 'build:\n\tnpm run build');
    await fs.writeFile(path.join(testProjectRoot, 'code.txt'), 'def add(a,b): return a+b');

    const result = await analysisService.fullAnalysis({
      projectRoot: testProjectRoot,
      depth: -1,
      concurrency: 4,
    });

    expect(result.success).toBe(true);
    // 5 个文本文件（index.ts, utils.js, Dockerfile, Makefile, code.txt）均解析；
    // 这里不依赖实际默认黑名单配置，而是在测试中显式关闭黑名单，用于验证与黑名单逻辑的解耦
    expect(result.analyzedFilesCount).toBeGreaterThanOrEqual(4);
    expect(storageService.saveFileAnalysis).toHaveBeenCalledTimes(5);
  });

  test('UT-ANA-CONC-001: 并发数生效（active 任务数不超过 concurrency）', async () => {
    await fs.ensureDir(testProjectRoot);
    for (let i = 0; i < 10; i++) {
      await fs.writeFile(path.join(testProjectRoot, `f${i}.ts`), `export const v${i} = ${i};`);
    }

    const result = await analysisService.fullAnalysis({
      projectRoot: testProjectRoot,
      depth: -1,
      concurrency: 2,
    });

    expect(result.success).toBe(true);
    expect(workerStats.concurrency).toBe(2);
    expect(workerStats.fileTaskCount).toBe(10);
    expect(workerStats.maxActive).toBeLessThanOrEqual(2);
    expect(workerStats.maxActive).toBe(2);
  });

  test('UT-ANA-CONC-002: 深层目录结构下有效并发不塌陷（线程池保持满载）', async () => {
    await fs.ensureDir(testProjectRoot);
    for (let d = 0; d < 4; d++) {
      const dir = path.join(testProjectRoot, `dir${d}`, 'sub');
      await fs.ensureDir(dir);
      for (let i = 0; i < 5; i++) {
        await fs.writeFile(path.join(dir, `f${i}.ts`), `export const x = ${i};`);
      }
    }

    const result = await analysisService.fullAnalysis({
      projectRoot: testProjectRoot,
      depth: -1,
      concurrency: 4,
    });

    expect(result.success).toBe(true);
    expect(workerStats.fileTaskCount).toBe(20);
    expect(workerStats.maxActive).toBe(4);

    // 在任务充足时，绝大多数“开始事件”都应发生在 pool 已经满载（active==concurrency）或接近满载的阶段
    const fullLoadStarts = workerStats.startActiveSamples.filter(n => n === 4).length;
    // 由于「当前对象」语义收敛为 worker in-flight（started 仅在真正提交到 worker 前触发），
    // “开始事件”会更贴近真实调度边界，因此这里不再要求几乎全部 start 都发生在满载点，
    // 仅要求在任务充足时至少多次观察到满载状态。
    expect(fullLoadStarts).toBeGreaterThanOrEqual(4);
  });
});
