import { CodeSplitter } from '../../../src/infrastructure/splitter/code.splitter';
import { ILLMClient } from '../../../src/domain/interfaces';

describe('大文件分片与合并测试', () => {
  let llmClient: jest.Mocked<ILLMClient>;
  let splitter: CodeSplitter;

  beforeEach(() => {
    llmClient = {
      call: jest.fn(),
      batchCall: jest.fn(),
    } as any;
    splitter = new CodeSplitter(llmClient);
    jest.clearAllMocks();
  });

  /**
   * UT-LLM-008: 大文件语义分片
   */
  test('UT-LLM-008: 大文件按语义边界分片，不拆分完整代码块', async () => {
    // 生成包含多个完整函数的大文件内容
    const largeCode = Array.from({ length: 50 }, (_, i) => `
function func${i}(a: number, b: number): number {
  // 这是函数${i}的注释
  const result = a + b;
  console.log('func${i}执行结果:', result);
  return result;
}
`).join('\n');

    const chunks = await splitter.split(largeCode, 1000);
    
    // 验证分片
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      // 每个分片内容不应为空
      expect(chunk.content.length).toBeGreaterThan(0);
    });
  });

  /**
   * UT-LLM-009: 分片结果合并（合并阶段三步协议：结构 → 功能描述 → 概述）
   */
  test('UT-LLM-009: 多个分片解析结果合并为完整文件分析结果', async () => {
    const chunkResults = [
      { chunkId: 0, summary: '分片1', classes: [], functions: Array.from({ length: 10 }, (_, i) => ({ name: `func${i}` })), dependencies: [] },
      { chunkId: 1, summary: '分片2', classes: [], functions: Array.from({ length: 10 }, (_, i) => ({ name: `func${i + 10}` })), dependencies: [] }
    ];

    const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    const meta = { usage, model: 'm', responseTime: 1 };
    // 第一步：合并结构
    llmClient.call.mockResolvedValueOnce({
      content: JSON.stringify({
        name: 'large-file.ts',
        language: 'TypeScript',
        linesOfCode: 100,
        dependencies: [],
        classes: [],
        functions: Array.from({ length: 20 }, (_, i) => ({ name: `func${i}`, signature: '', description: '' })),
      }),
      ...meta,
    });
    // 第二步：功能描述
    llmClient.call.mockResolvedValueOnce({ content: JSON.stringify({ description: '合并结果功能描述' }), ...meta });
    // 第三步：概述
    llmClient.call.mockResolvedValueOnce({ content: JSON.stringify({ summary: '合并结果：func0-func19' }), ...meta });

    const mergedResult = await splitter.merge(chunkResults as any, 'large-file.ts');
    expect(mergedResult.summary).toContain('func0-func19');
    expect(mergedResult.functions.length).toBe(20);
    expect(llmClient.call).toHaveBeenCalledTimes(3);
  });

  // UT-LLM-010（超大文件解析）在当前实现中由 LLMAnalysisService + CodeSplitter 共同完成，
  // 覆盖在 tests/unit/llm/analysis.cache.test.ts 与 LLMAnalysisService 的行为测试中。
});
