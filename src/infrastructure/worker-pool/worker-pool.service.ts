import * as workerpool from 'workerpool'
import * as path from 'path'
import * as fs from 'fs'
import { IWorkerPoolService } from '../../domain/interfaces'
import { FileAnalysis, DirectoryAnalysis, ModificationLog, LLMConfig } from '../../common/types'
import { AppError, ErrorCode } from '../../common/errors'
import { DEFAULT_CONCURRENCY } from '../../common/constants'
import os from 'os'
import { aggregateDirectory, parseFile, validateResult } from './parse.worker.impl'

export interface DirectoryAggregationPayload {
  childrenDirs: Array<{ name: string; summary: string; description?: string }>
  childrenFiles: Array<{ name: string; summary: string; description?: string }>
}

export interface DirectoryAggregationLLMResult {
  description: string
  summary: string
}

type WorkerUsageDelta = {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalCalls: number
}

export class WorkerPoolService implements IWorkerPoolService {
  private pool?: workerpool.Pool
  private pendingTasks: Promise<any>[] = []
  private currentConcurrency: number
  private llmConfig: LLMConfig
  private readonly localMode: boolean

  constructor(llmConfig: LLMConfig, concurrency: number = DEFAULT_CONCURRENCY) {
    this.currentConcurrency = concurrency
    this.llmConfig = {
      ...llmConfig,
      cache_dir: WorkerPoolService.expandTilde(llmConfig.cache_dir),
    }

    const workerScript = path.join(__dirname, 'parse.worker.js')
    this.localMode = !fs.existsSync(workerScript)

    // Jest/ts-jest 直接执行 src 时，parse.worker.js 不存在。此时回退到“本进程执行”以保证核心逻辑可测。
    // 生产构建（dist）与 CLI 运行时，parse.worker.js 存在，继续使用 worker threads 提升性能。
    if (!this.localMode) {
      this.pool = workerpool.pool(workerScript, {
        maxWorkers: concurrency,
        workerType: 'thread',
      })
    }
  }

  private static expandTilde(p: string): string {
    if (!p) return p
    if (p.startsWith('~') && (p.length === 1 || p[1] === '/' || p[1] === '\\')) {
      return path.join(os.homedir(), p.slice(1))
    }
    return p
  }

  async submitFileAnalysisTask(
    filePath: string,
    fileContent: string,
    fileHash: string,
    language?: string
  ): Promise<{ analysis: FileAnalysis; usage: WorkerUsageDelta }> {
    if (this.localMode) {
      const task = parseFile(filePath, fileContent, fileHash, language, this.llmConfig)
      this.pendingTasks.push(task)
      try {
        return await task
      } finally {
        this.pendingTasks = this.pendingTasks.filter(t => t !== task)
      }
    }
    try {
      const task = this.pool!.exec('parseFile', [filePath, fileContent, fileHash, language, this.llmConfig])
      this.pendingTasks.push(task)
      
      const result = await task
      // 移除已完成的任务
      this.pendingTasks = this.pendingTasks.filter(t => t !== task)
      
      return result
    } catch (e) {
      throw new AppError(
        ErrorCode.WORKER_SCHEDULE_FAILED,
        'File analysis task failed',
        (e as Error).message,
      )
    }
  }

  async submitDirectoryAggregationTask(
    dirPath: string,
    payload: DirectoryAggregationPayload
  ): Promise<DirectoryAggregationLLMResult & { usage: WorkerUsageDelta }> {
    if (this.localMode) {
      const task = aggregateDirectory(dirPath, payload, this.llmConfig)
      this.pendingTasks.push(task)
      try {
        return await task
      } finally {
        this.pendingTasks = this.pendingTasks.filter(t => t !== task)
      }
    }
    try {
      const task = this.pool!.exec('aggregateDirectory', [dirPath, payload, this.llmConfig])
      this.pendingTasks.push(task)
      
      const result = await task
      this.pendingTasks = this.pendingTasks.filter(t => t !== task)
      
      return result
    } catch (e) {
      throw new AppError(ErrorCode.WORKER_SCHEDULE_FAILED, 'Directory aggregation task failed', (e as Error).message)
    }
  }

  async submitValidationTask(parentResult: DirectoryAnalysis, childResult: FileAnalysis | DirectoryAnalysis): Promise<{
    valid: boolean
    corrections?: Partial<FileAnalysis | DirectoryAnalysis>
    log?: ModificationLog
  }> {
    if (this.localMode) {
      const task = validateResult(parentResult, childResult)
      this.pendingTasks.push(task)
      try {
        return await task
      } finally {
        this.pendingTasks = this.pendingTasks.filter(t => t !== task)
      }
    }
    try {
      const task = this.pool!.exec('validateResult', [parentResult, childResult])
      this.pendingTasks.push(task)
      
      const result = await task
      this.pendingTasks = this.pendingTasks.filter(t => t !== task)
      
      return result
    } catch (e) {
      throw new AppError(ErrorCode.WORKER_SCHEDULE_FAILED, 'Validation task failed', (e as Error).message)
    }
  }

  setConcurrency(concurrency: number): void {
    this.currentConcurrency = concurrency
    if (this.localMode) {
      return
    }
    // 立即终止旧 worker，避免遗留线程占用资源
    void this.pool!.terminate(true).catch(() => {})
    this.pool = workerpool.pool(path.join(__dirname, 'parse.worker.js'), {
      maxWorkers: concurrency,
      workerType: 'thread'
    })
  }

  async waitAll(): Promise<void> {
    await Promise.all(this.pendingTasks)
  }

  cancelAll(): void {
    void this.pool?.terminate(true).catch(() => {})
    this.pendingTasks = []
  }

  async terminate(force: boolean = true): Promise<void> {
    if (this.pool) {
      await this.pool.terminate(force)
    }
    this.pendingTasks = []
  }
}