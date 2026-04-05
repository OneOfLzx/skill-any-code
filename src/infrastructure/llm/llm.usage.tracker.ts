import type { TokenUsageStats } from '../../common/types'

/**
 * 单次解析周期内的 LLM Token 使用统计器。
 *
 * - 对所有调用做累计统计；
 * - 通过 onSnapshot 回调向上层（如 CLI 渲染器）推送最新快照；
 * - 不直接向 stdout 打印 Token 行，由 CLI 统一渲染「Tokens: ...」。
 */
export class LLMUsageTracker {
  private stats: TokenUsageStats = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCalls: 0,
  }

  constructor(
    private readonly onSnapshot?: (stats: TokenUsageStats) => void,
  ) {}

  addUsage(usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): void {
    this.stats.totalPromptTokens += usage.promptTokens ?? 0
    this.stats.totalCompletionTokens += usage.completionTokens ?? 0
    this.stats.totalTokens += usage.totalTokens ?? 0
    this.stats.totalCalls += 1

    const snapshot = this.getStats()

    if (this.onSnapshot) {
      this.onSnapshot(snapshot)
    }
  }

  /**
   * 将外部汇总（例如 worker 线程返回的本任务 usage delta）累加到总量中。
   * 注意：这里的 totalCalls 表示调用次数增量，而不是“任务数”。
   */
  addTotals(delta: Partial<TokenUsageStats>): void {
    this.stats.totalPromptTokens += delta.totalPromptTokens ?? 0
    this.stats.totalCompletionTokens += delta.totalCompletionTokens ?? 0
    this.stats.totalTokens += delta.totalTokens ?? 0
    this.stats.totalCalls += delta.totalCalls ?? 0

    const snapshot = this.getStats()

    if (this.onSnapshot) {
      this.onSnapshot(snapshot)
    }
  }

  getStats(): TokenUsageStats {
    return { ...this.stats }
  }

  reset(): void {
    this.stats = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCalls: 0,
    }
  }
}

