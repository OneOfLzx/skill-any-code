import fs from 'fs-extra';
import path from 'path';
import { AnalysisService } from '../../src/domain/services/analysis.service';
import { createDeepProject, mkdtempProjectDir } from '../utils/deep-project';

// 通过 mock OpenAIClient 来：
// - 避免真实网络调用
// - 注入少量延迟，制造可观测的并发“重叠窗口”
jest.mock('../../src/infrastructure/llm/openai.client', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let callIdx = 0;
  return {
    OpenAIClient: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockImplementation(async (_req: any) => {
        // 让调用具备轻微抖动，避免“同 tick 全部完成”导致并发采样缺失。
        // 使用确定性延迟，避免 Math.random 带来的 flaky。
        const ms = 12 + (callIdx++ % 8) * 3; // 12,15,18,...,33
        await sleep(ms);
        return {
          content: JSON.stringify({
            name: 'mock',
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
          model: 'mock',
          responseTime: ms,
        };
      }),
      batchCall: jest.fn(),
    })),
  };
});

describe('System/Integration: 深层目录并发退化可回归 (ST-CONC-DEEPDIR-*)', () => {
  it(
    'ST-CONC-DEEPDIR-001: deep+branching 项目中并发可观测且不超过 concurrency（语义：仅 worker in-flight）',
    async () => {
      const projectRoot = mkdtempProjectDir('ca-deepdir-system');
      const resultRoot = mkdtempProjectDir('ca-deepdir-system-result');
      await fs.ensureDir(resultRoot);

      try {
        const stats = await createDeepProject(projectRoot, {
          // 目录数：1+2+4+8+16=31；文件数同等（每目录 1 个文件）=> 31 files，落在 20~80 范围
          depth: 5,
          branching: 2,
          filesPerDir: 1,
          ext: '.ts',
        });

        // 控制规模：文件数量适中，避免系统测试过慢
        expect(stats.fileCount).toBeGreaterThanOrEqual(20);

        const storageService = {
          getStoragePath: jest.fn().mockReturnValue(resultRoot),
          saveFileAnalysis: jest.fn().mockResolvedValue(true),
          saveDirectoryAnalysis: jest.fn().mockResolvedValue(true),
        } as any;

        const blacklistService = {
          load: jest.fn().mockResolvedValue(undefined),
          isIgnored: jest.fn().mockReturnValue(false),
        } as any;

        const analysis = new AnalysisService(
          {} as any,
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
            cache_dir: path.join(projectRoot, '.cache'),
            cache_max_size_mb: 0,
          } as any,
        );

        const activeSet = new Set<string>();
        const startAt = new Map<string, number>();
        const endAt = new Map<string, number>();
        const typeByKey = new Map<string, 'file' | 'directory'>();

        const activeSamples: number[] = [];
        const completionBeforeSamples: number[] = [];
        const completionKeys: string[] = [];

        const keyOf = (obj: { type: string; path: string }) => `${obj.type}:${obj.path}`;

        const res = await analysis.fullAnalysis({
          projectRoot,
          depth: -1,
          concurrency: 8,
          onObjectStarted: (obj: any) => {
            const k = keyOf(obj);
            typeByKey.set(k, obj.type);
            startAt.set(k, Date.now());
            activeSet.add(k);
            activeSamples.push(activeSet.size);
          },
          onObjectCompleted: (obj: any) => {
            const k = keyOf(obj);
            endAt.set(k, Date.now());
            // 记录完成前并发度（删除前的 activeSet.size），避免把“完成后自然收尾”误判为退化
            const before = activeSet.size;
            // completed 回调在失败/成功都会触发；activeSet 应该被释放
            activeSet.delete(k);
            completionBeforeSamples.push(before);
            completionKeys.push(k);
          },
        } as any);

        expect(res.success).toBe(true);

        const maxActive = Math.max(...activeSamples, 0);
        expect(maxActive).toBeGreaterThan(1);
        expect(maxActive).toBeLessThanOrEqual(8);

        // 所有 started 最终都应 completed，activeSet 被释放干净
        expect(activeSet.size).toBe(0);
      } finally {
        await fs.remove(projectRoot).catch(() => {});
        await fs.remove(resultRoot).catch(() => {});
      }
    },
    240000,
  );
});

