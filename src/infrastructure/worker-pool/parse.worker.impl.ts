import * as path from 'path'
import { DirectoryAnalysis, FileAnalysis, LLMConfig, ModificationLog } from '../../common/types'
import { OpenAIClient } from '../llm/openai.client'
import { LLMUsageTracker } from '../llm/llm.usage.tracker'
import { CodeSplitter } from '../splitter/code.splitter'
import { FileHashCache } from '../cache/file.hash.cache'
import { LLMAnalysisService } from '../../application/services/llm.analysis.service'
import * as crypto from 'crypto'

export type WorkerUsageDelta = {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalCalls: number
}

export async function parseFile(
  filePath: string,
  fileContent: string,
  fileHash: string,
  language?: string,
  llmConfig?: LLMConfig
): Promise<{ analysis: FileAnalysis; usage: WorkerUsageDelta }> {
  if (!llmConfig) {
    throw new Error('LLM config is required for file parsing')
  }

  // 初始化LLM相关服务
  const tracker = new LLMUsageTracker()
  const llmClient = new OpenAIClient(llmConfig, tracker)
  const fileSplitter = new CodeSplitter(llmClient)
  const cache = new FileHashCache({
    cacheDir: llmConfig.cache_dir,
    maxSizeMb: llmConfig.cache_max_size_mb,
  })
  const llmAnalysisService = new LLMAnalysisService(llmClient, fileSplitter, cache, llmConfig)

  const result = await llmAnalysisService.analyzeFile(filePath, fileContent, fileHash)
  return { analysis: result, usage: tracker.getStats() }
}

export async function aggregateDirectory(
  dirPath: string,
  payload: {
    childrenDirs: Array<{ name: string; summary: string; description?: string }>
    childrenFiles: Array<{ name: string; summary: string; description?: string }>
  },
  llmConfig?: LLMConfig
): Promise<{ description: string; summary: string; usage: WorkerUsageDelta }> {
  const name = path.basename(dirPath)
  const childrenDirsPayload = (payload?.childrenDirs ?? []).map(d => ({
    name: d.name,
    summary: d.summary,
    description: d.description ?? d.summary,
  }))
  const childrenFilesPayload = (payload?.childrenFiles ?? []).map(f => ({
    name: f.name,
    summary: f.summary,
    description: f.description ?? f.summary,
  }))

  // LLM 不可用时回退到可解释的聚合文案
  if (!llmConfig || !llmConfig.base_url || !llmConfig.model) {
    const fileCount = childrenFilesPayload.length
    const dirCount = childrenDirsPayload.length
    const fallback = `The "${name}" directory contains ${fileCount} file(s) and ${dirCount} subdirectory(ies) and helps organize related source code and modules.`
    return { description: fallback, summary: fallback, usage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalCalls: 0 } }
  }

  // 初始化LLM相关服务（worker 内做本任务 token 统计，返回给主线程聚合）
  const tracker = new LLMUsageTracker()
  const llmClient = new OpenAIClient(llmConfig, tracker)
  const fileSplitter = new CodeSplitter(llmClient)
  const cache = new FileHashCache({
    cacheDir: llmConfig.cache_dir,
    maxSizeMb: llmConfig.cache_max_size_mb,
  })
  const llmAnalysisService = new LLMAnalysisService(llmClient, fileSplitter, cache, llmConfig)

  try {
    const dirResultFromLLM = await llmAnalysisService.analyzeDirectory(childrenDirsPayload, childrenFilesPayload)
    return {
      description: dirResultFromLLM.description,
      summary: dirResultFromLLM.summary,
      usage: tracker.getStats(),
    }
  } catch {
    const fileCount = childrenFilesPayload.length
    const dirCount = childrenDirsPayload.length
    const fallback = `The "${name}" directory contains ${fileCount} file(s) and ${dirCount} subdirectory(ies) and helps organize related source code and modules.`
    return { description: fallback, summary: fallback, usage: tracker.getStats() }
  }
}

export async function validateResult(parentResult: DirectoryAnalysis, childResult: FileAnalysis | DirectoryAnalysis): Promise<{
  valid: boolean
  corrections?: Partial<FileAnalysis | DirectoryAnalysis>
  log?: ModificationLog
}> {
  // 简单的校验逻辑：检查子项是否在父项的结构中存在
  const existsInStructure = parentResult.structure.some(item => item.name === childResult.name)
  const corrections: Partial<FileAnalysis | DirectoryAnalysis> = {}
  let log: ModificationLog | undefined

  if (!existsInStructure) {
    // 修正：将子项添加到父项的结构中
    ;(corrections as Partial<DirectoryAnalysis>).structure = [
      ...parentResult.structure,
      {
        name: childResult.name,
        type: childResult.type,
        description: childResult.summary.substring(0, 100),
      },
    ]

    log = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      path: parentResult.path,
      type: 'omission',
      originalContent: JSON.stringify(parentResult.structure),
      correctedContent: JSON.stringify((corrections as Partial<DirectoryAnalysis>).structure),
      reason: `Child item ${childResult.name} missing from directory structure`,
    }

    return {
      valid: false,
      corrections,
      log,
    }
  }

  return { valid: true }
}

