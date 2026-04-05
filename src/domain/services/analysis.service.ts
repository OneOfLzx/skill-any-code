import * as fs from 'fs-extra'
import * as path from 'path'
import { createHash } from 'crypto'
import { IAnalysisService, IGitService, IStorageService, IBlacklistService } from '../interfaces'
import {
  FullAnalysisParams,
  IncrementalAnalysisParams,
  ResumeAnalysisParams,
  AnalysisParams,
  AnalysisResult,
  FileAnalysis,
  DirectoryAnalysis,
  LLMConfig,
  AnalysisObject,
  ObjectResultMeta,
  TokenUsageStats,
} from '../../common/types'
import { AppError, ErrorCode } from '../../common/errors'
import { logger } from '../../common/logger'
import { getFileOutputPath, getDirOutputPath, mapLimit } from '../../common/utils'
import { OpenAIClient } from '../../infrastructure/llm/openai.client'
import { LLMUsageTracker } from '../../infrastructure/llm/llm.usage.tracker'
import { CodeSplitter } from '../../infrastructure/splitter/code.splitter'
import { FileHashCache } from '../../infrastructure/cache/file.hash.cache'
import { LLMAnalysisService } from '../../application/services/llm.analysis.service'
import { WorkerPoolService } from '../../infrastructure/worker-pool/worker-pool.service'
import os from 'os'

type DirNode = {
  absPath: string
  relPath: string
  depth: number
  childDirs: string[]
  childFiles: string[]
}

export class AnalysisService implements IAnalysisService {
  private llmAnalysisService: LLMAnalysisService

  private tracker: LLMUsageTracker

  constructor(
    private gitService: IGitService,
    private storageService: IStorageService,
    private blacklistService: IBlacklistService,
    private projectSlug: string,
    private currentCommit: string,
    private llmConfig: LLMConfig,
    private readonly onTokenUsageSnapshot?: (stats: TokenUsageStats) => void,
  ) {
    this.tracker = new LLMUsageTracker(this.onTokenUsageSnapshot)
    const llmClient = new OpenAIClient(llmConfig, this.tracker);
    const fileSplitter = new CodeSplitter(llmClient);
    const homeDir = os.homedir()
    const resolvedCacheDir = llmConfig.cache_dir.replace(/^~(?=\/|\\|$)/, homeDir)
    const cache = new FileHashCache({
      cacheDir: resolvedCacheDir,
      maxSizeMb: llmConfig.cache_max_size_mb,
    })
    this.llmAnalysisService = new LLMAnalysisService(llmClient, fileSplitter, cache, llmConfig);
  }

  getTokenUsage() {
    return this.tracker.getStats()
  }

  /**
   * 统计将参与解析的对象总数（文件+目录），用于进度条 total。
   * 与 fullAnalysis 使用相同的深度与黑名单规则。
   */
  async countObjects(projectRoot: string, depth: number = -1): Promise<number> {
    const rootStat = await fs.stat(projectRoot)
    if (rootStat.isFile()) return 1
    let count = 0

    const walk = async (dirPath: string, currentDepth: number): Promise<boolean> => {
      if (depth >= 1 && currentDepth > depth) {
        return false
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const valid = entries.filter(entry => {
        const fullPath = path.join(dirPath, entry.name)
        const relativePath = path.relative(projectRoot, fullPath)
        const key = entry.isDirectory() ? `${relativePath}/` : relativePath
        return !this.blacklistService.isIgnored(key)
      })

      let hasContent = false
      for (const entry of valid) {
        if (entry.isFile()) {
          count++
          hasContent = true
          continue
        }
        if (entry.isDirectory()) {
          const childHas = await walk(path.join(dirPath, entry.name), currentDepth + 1)
          if (childHas) {
            hasContent = true
          }
        }
      }

      if (hasContent) {
        count++
      }
      return hasContent
    }

    await walk(projectRoot, 1)
    return count
  }

  // ---------------------------------------------------------------------------
  // 私有工具方法
  // ---------------------------------------------------------------------------

  /**
   * Phase 1：遍历目录树，构建完整的任务图。
   * 全量和增量共享此扫描逻辑，黑名单和深度限制在此阶段统一应用。
   */
  private async scanProjectTree(
    projectRoot: string,
    depth: number | undefined,
    onScanProgress?: (scanned: number) => void,
  ) {
    const depthEnabled = depth !== undefined && depth >= 1
    const maxDepth = depthEnabled ? (depth as number) : Number.POSITIVE_INFINITY

    const dirNodes = new Map<string, DirNode>()
    const fileAbsByRel = new Map<string, string>()
    let scannedObjectCount = 0

    const rootRel = '.'
    dirNodes.set(rootRel, {
      absPath: projectRoot,
      relPath: rootRel,
      depth: 1,
      childDirs: [],
      childFiles: [],
    })

    const queue: Array<{ rel: string; abs: string; depth: number }> = [
      { rel: rootRel, abs: projectRoot, depth: 1 },
    ]

    const scanConcurrency = Math.max(1, Math.min(8, os.cpus()?.length || 4))

    const processDir = async (current: { rel: string; abs: string; depth: number }) => {
      const node = dirNodes.get(current.rel)
      if (!node) return
      if (current.depth > maxDepth) return

      const entries = await fs.readdir(current.abs, { withFileTypes: true })
      const validEntries = entries
        .filter(entry => {
          const fullPath = path.join(current.abs, entry.name)
          const relativePath = path.relative(projectRoot, fullPath)
          const key = entry.isDirectory() ? `${relativePath}/` : relativePath
          return !this.blacklistService.isIgnored(key)
        })
        .sort((a, b) => a.name.localeCompare(b.name))

      for (const entry of validEntries) {
        const fullPath = path.join(current.abs, entry.name)
        const relPath = path.relative(projectRoot, fullPath) || entry.name

        if (entry.isFile()) {
          node.childFiles.push(relPath)
          fileAbsByRel.set(relPath, fullPath)
          scannedObjectCount++
          if (scannedObjectCount % 10 === 0) onScanProgress?.(scannedObjectCount)
        } else if (entry.isDirectory()) {
          node.childDirs.push(relPath)
          const childDepth = current.depth + 1
          dirNodes.set(relPath, {
            absPath: fullPath,
            relPath: relPath,
            depth: childDepth,
            childDirs: [],
            childFiles: [],
          })
          queue.push({ rel: relPath, abs: fullPath, depth: childDepth })
        }
      }
    }

    const runScanQueue = async () => {
      const workers = Array.from({ length: scanConcurrency }, async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const current = queue.shift()
          if (!current) return
          await processDir(current)
        }
      })
      await Promise.all(workers)
    }

    await runScanQueue()

    // 目录剪枝：自底向上移除空目录
    const allScannedDirs = Array.from(dirNodes.values())
    const scannedDirsByDepthDesc = allScannedDirs
      .slice()
      .sort((a, b) => {
        if (b.depth !== a.depth) return b.depth - a.depth
        return a.relPath.localeCompare(b.relPath)
      })

    const keptDirs = new Set<string>()
    for (const d of scannedDirsByDepthDesc) {
      const node = dirNodes.get(d.relPath)
      if (!node) continue
      node.childDirs = node.childDirs.filter(child => keptDirs.has(child))
      const hasContent = node.childFiles.length > 0 || node.childDirs.length > 0
      if (hasContent) {
        keptDirs.add(d.relPath)
        scannedObjectCount++
        if (scannedObjectCount % 10 === 0) onScanProgress?.(scannedObjectCount)
      }
    }

    if (scannedObjectCount > 0 && scannedObjectCount % 10 !== 0) {
      onScanProgress?.(scannedObjectCount)
    }

    return { dirNodes, fileAbsByRel, keptDirs }
  }

  /**
   * 增量专用：扫描存储目录，找出"有解析结果但对应源文件/目录已不存在"的孤立条目并清理。
   */
  private async cleanOrphanedResults(
    storageRoot: string,
    projectRoot: string,
    currentFileRels: Map<string, string>,
    keptDirs: Set<string>,
    removedSourcePaths: string[],
  ) {
    logger.info('Scanning storage directory for orphaned result files...')

    // 构建当前源码树的预期结果路径集合
    const expectedResultPaths = new Set<string>()
    for (const relPath of currentFileRels.keys()) {
      expectedResultPaths.add(path.resolve(getFileOutputPath(storageRoot, relPath)))
    }
    for (const dirRel of keptDirs) {
      expectedResultPaths.add(path.resolve(getDirOutputPath(storageRoot, dirRel)))
    }

    const orphaned: string[] = []

    const walk = async (dirAbs: string) => {
      if (!(await fs.pathExists(dirAbs))) return
      const entries = await fs.readdir(dirAbs, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dirAbs, entry.name)
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.')) continue
          await walk(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          if (!expectedResultPaths.has(path.resolve(fullPath))) {
            orphaned.push(fullPath)
          }
        }
      }
    }

    await walk(storageRoot)

    if (orphaned.length > 0) {
      logger.info(`Found ${orphaned.length} orphaned result file(s). Cleaning up...`)
      for (const p of orphaned) {
        try {
          const content = await fs.readFile(p, 'utf-8')
          const match = content.match(/(?:^|\n)-\s*(?:Path|路径)\s*[：:]\s*(.+)\s*$/m)
          const sourcePath = match?.[1]?.trim()
          if (sourcePath) {
            removedSourcePaths.push(path.resolve(projectRoot, sourcePath))
          }
        } catch { /* 无法读取则仅删除 */ }
        await fs.remove(p)
      }

      // 自底向上清理因删除 .md 而变为空的存储子目录
      const resolvedStorageRoot = path.resolve(storageRoot)
      const removeEmptyDirs = async (dirAbs: string): Promise<boolean> => {
        if (!(await fs.pathExists(dirAbs))) return true
        const entries = await fs.readdir(dirAbs, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dirAbs, entry.name)
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await removeEmptyDirs(fullPath)
          }
        }
        // 重新读取：子目录可能刚被删除
        const remaining = await fs.readdir(dirAbs)
        if (remaining.length === 0 && path.resolve(dirAbs) !== resolvedStorageRoot) {
          await fs.remove(dirAbs)
          return true
        }
        return false
      }
      await removeEmptyDirs(storageRoot)
    } else {
      logger.info('No orphaned result files found')
    }
  }

  // ---------------------------------------------------------------------------
  // 统一解析入口
  // ---------------------------------------------------------------------------

  async analyze(params: AnalysisParams): Promise<AnalysisResult> {
    const startTime = Date.now()
    const errors: Array<{ path: string; message: string }> = []
    const completedFiles: string[] = []
    const completedDirs: string[] = []
    const indexEntries: Array<{ sourcePath: string; resultPath: string; type: 'file' | 'directory' }> = []
    const removedSourcePaths: string[] = []
    const storageRoot = this.storageService.getStoragePath(this.projectSlug)

    // --- 单文件特殊处理 ---
    const rootStat = await fs.stat(params.projectRoot)
    if (rootStat.isFile()) {
      try {
        const content = await fs.readFile(params.projectRoot, 'utf-8')
        const fileHash = createHash('sha256').update(content).digest('hex')
        const parseResult = await this.llmAnalysisService.analyzeFile(params.projectRoot, content, fileHash)

        const relativePath = path.basename(params.projectRoot)
        const fileResult: FileAnalysis = {
          ...parseResult,
          path: relativePath,
          commitHash: params.commitHash,
        }

        await this.storageService.saveFileAnalysis(this.projectSlug, relativePath, fileResult)
        completedFiles.push(relativePath)
        params.onTotalKnown?.(1)
        params.onObjectPlanned?.({ type: 'file', path: relativePath })
        params.onObjectCompleted?.({ type: 'file', path: relativePath }, { status: 'parsed' })

        const sourceAbsPath = path.resolve(params.projectRoot)
        const resultAbsPath = path.resolve(storageRoot, getFileOutputPath(storageRoot, relativePath))
        indexEntries.push({ sourcePath: sourceAbsPath, resultPath: resultAbsPath, type: 'file' })
      } catch (e: unknown) {
        const message = (e as Error).message
        errors.push({ path: params.projectRoot, message })
      }

      return {
        success: errors.length === 0,
        analyzedFilesCount: completedFiles.length,
        analyzedDirsCount: 0,
        duration: Date.now() - startTime,
        errors,
        projectSlug: this.projectSlug,
        summaryPath: path.join(storageRoot, 'index.md'),
        indexEntries,
        removedSourcePaths: [],
      }
    }

    // ===================================================================
    // Phase 1：统一遍历目录树
    // ===================================================================
    logger.debug('Phase 1: scanning directory tree...')
    const { dirNodes, fileAbsByRel, keptDirs } = await this.scanProjectTree(
      params.projectRoot,
      params.depth,
      params.onScanProgress,
    )
    logger.debug(`Scan completed: ${fileAbsByRel.size} file(s), ${keptDirs.size} non-empty directory(ies)`)

    // 清理被剪枝（空）目录的残留结果文件
    for (const d of dirNodes.values()) {
      if (!keptDirs.has(d.relPath) && d.relPath !== '.') {
        const out = getDirOutputPath(storageRoot, d.relPath)
        if (await fs.pathExists(out)) {
          await fs.remove(out)
        }
      }
    }

    // ===================================================================
    // Phase 2：应用文件过滤策略，构建文件任务队列
    // ===================================================================
    logger.debug(`Phase 2: applying file filter (mode=${params.mode})...`)
    const includedFiles = new Set<string>()
    const filterConcurrency = Math.max(1, Math.min(8, os.cpus()?.length || 4))
    await mapLimit(Array.from(fileAbsByRel.entries()), filterConcurrency, async ([relPath, absPath]) => {
      if (await params.fileFilter(relPath, absPath)) {
        includedFiles.add(relPath)
      }
    })
    logger.debug(`File filtering done: ${includedFiles.size}/${fileAbsByRel.size} file(s) queued`)

    // ===================================================================
    // Phase 2.5：增量模式 — 清理孤立的解析结果
    // ===================================================================
    if (params.mode === 'incremental') {
      await this.cleanOrphanedResults(storageRoot, params.projectRoot, fileAbsByRel, keptDirs, removedSourcePaths)
    }

    // ===================================================================
    // Phase 3：构建目录任务队列
    //   规则：
    //   - 至少有 1 个子项（文件或子目录）在任务队列中 → 目录进入队列
    //   - 目录自身的结果 md 缺失 → 目录进入队列
    //   - 自底向上传播：底层文件变更会驱动整条祖先链重新聚合
    // ===================================================================
    logger.debug('Phase 3: building directory task queue...')
    const includedDirs = new Set<string>()
    const allKeptDirsSorted = Array.from(dirNodes.values())
      .filter(d => keptDirs.has(d.relPath))
      .sort((a, b) => {
        if (b.depth !== a.depth) return b.depth - a.depth
        return a.relPath.localeCompare(b.relPath)
      })

    for (const dir of allKeptDirsSorted) {
      let shouldInclude =
        dir.childFiles.some(f => includedFiles.has(f)) ||
        dir.childDirs.some(d => includedDirs.has(d))

      if (!shouldInclude) {
        const dirMdPath = getDirOutputPath(storageRoot, dir.relPath)
        shouldInclude = !(await fs.pathExists(dirMdPath))
      }

      if (shouldInclude) {
        includedDirs.add(dir.relPath)
      }
    }
    logger.debug(`Directory filtering done: ${includedDirs.size}/${keptDirs.size} directory(ies) queued`)

    // ===================================================================
    // Phase 4：排序 + 通知总数
    // ===================================================================
    const plannedFiles = Array.from(includedFiles).sort((a, b) => a.localeCompare(b))
    const plannedDirs = allKeptDirsSorted
      .filter(d => includedDirs.has(d.relPath))
      .map(d => d.relPath)

    const totalObjects = plannedFiles.length + plannedDirs.length
    params.onTotalKnown?.(totalObjects)

    for (const f of plannedFiles) {
      params.onObjectPlanned?.({ type: 'file', path: f })
    }
    for (const d of plannedDirs) {
      params.onObjectPlanned?.({ type: 'directory', path: d })
    }

    if (totalObjects === 0) {
      logger.info('No objects to (re)analyze')
      return {
        success: true,
        analyzedFilesCount: 0,
        analyzedDirsCount: 0,
        duration: Date.now() - startTime,
        errors: [],
        projectSlug: this.projectSlug,
        summaryPath: path.join(storageRoot, 'index.md'),
        indexEntries: [],
        removedSourcePaths,
      }
    }

    // ===================================================================
    // Phase 5：统一执行管线 — 文件解析 + 目录聚合
    // ===================================================================
    const workerPool = new WorkerPoolService(this.llmConfig, params.concurrency)

    try {
      // --- 5a：文件解析 ---
      await mapLimit(plannedFiles, params.concurrency, async (relPath) => {
        const fileObj: AnalysisObject = { type: 'file', path: relPath }
        try {
          const absPath = fileAbsByRel.get(relPath)!
          const content = await fs.readFile(absPath, 'utf-8')
          const fileHash = createHash('sha256').update(content).digest('hex')

          params.onObjectStarted?.(fileObj)
          const workerRes: any = await workerPool.submitFileAnalysisTask(absPath, content, fileHash)
          const parseResult: FileAnalysis = workerRes?.analysis ?? workerRes
          if (workerRes?.usage) {
            this.tracker.addTotals(workerRes.usage)
          }

          const fileResult: FileAnalysis = {
            ...parseResult,
            path: relPath,
            commitHash: params.commitHash,
            fileHashWhenAnalyzed: fileHash,
          }

          await this.storageService.saveFileAnalysis(this.projectSlug, relPath, fileResult)
          completedFiles.push(relPath)
          params.onObjectCompleted?.(fileObj, { status: 'parsed' })

          const sourceAbsPath = path.resolve(params.projectRoot, relPath)
          const resultAbsPath = path.resolve(storageRoot, getFileOutputPath(storageRoot, relPath))
          indexEntries.push({ sourcePath: sourceAbsPath, resultPath: resultAbsPath, type: 'file' })
        } catch (e: any) {
          const message = (e as Error).message
          errors.push({ path: relPath, message })
          params.onObjectCompleted?.(fileObj, { status: 'failed', reason: message })
        }
      })

      // --- 5b：目录聚合（叶子优先，按深度分组） ---
      const dirsByDepth = new Map<number, string[]>()
      for (const dirRel of plannedDirs) {
        const node = dirNodes.get(dirRel)
        if (!node) continue
        const arr = dirsByDepth.get(node.depth) ?? []
        arr.push(dirRel)
        dirsByDepth.set(node.depth, arr)
      }

      const sortedDepths = Array.from(dirsByDepth.keys()).sort((a, b) => b - a)

      for (const depth of sortedDepths) {
        const batch = dirsByDepth.get(depth)!
        await mapLimit(batch, params.concurrency, async (dirRel) => {
          const dirObj: AnalysisObject = { type: 'directory', path: dirRel }
          const node = dirNodes.get(dirRel)
          if (!node) {
            params.onObjectCompleted?.(dirObj, { status: 'skipped', reason: 'dir node not found' })
            return
          }

          // 收集子项结果：优先从内存 Map 读取（刚解析的），回退到存储层（未变更的）
          const childResults: Array<FileAnalysis | DirectoryAnalysis> = []
          for (const f of node.childFiles) {
            const stored = await this.storageService.getFileAnalysis(this.projectSlug, f, 'summary')
            if (stored) childResults.push(stored)
          }
          for (const d of node.childDirs) {
            const stored = await this.storageService.getDirectoryAnalysis(this.projectSlug, d, 'summary')
            if (stored) childResults.push(stored)
          }

          const fileChildren = childResults.filter(c => c.type === 'file') as FileAnalysis[]
          const dirChildren = childResults.filter(c => c.type === 'directory') as DirectoryAnalysis[]

          if (fileChildren.length === 0 && dirChildren.length === 0) {
            const out = getDirOutputPath(storageRoot, dirRel)
            if (await fs.pathExists(out)) {
              await fs.remove(out)
            }
            params.onObjectCompleted?.(dirObj, { status: 'skipped', reason: 'empty directory' })
            return
          }

          const childrenDirsPayload = dirChildren.map(d => ({
            name: d.name,
            summary: d.summary,
            description: d.description,
          }))
          const childrenFilesPayload = fileChildren.map(f => ({
            name: f.name,
            summary: f.summary,
            description: f.description ?? f.summary,
          }))

          params.onObjectStarted?.(dirObj)

          let description = ''
          let summary = ''
          try {
            const llmRes: any = await workerPool.submitDirectoryAggregationTask(node.absPath, {
              childrenDirs: childrenDirsPayload,
              childrenFiles: childrenFilesPayload,
            })
            if (llmRes?.usage) {
              this.tracker.addTotals(llmRes.usage)
            }
            description = llmRes.description
            summary = llmRes.summary
          } catch (e: any) {
            const dirName = path.basename(dirRel)
            const fileCount = fileChildren.length
            const dirCount = dirChildren.length
            const fallback = `The "${dirName}" directory contains ${fileCount} file(s) and ${dirCount} subdirectory(ies) and helps organize related source code and modules.`
            description = fallback
            summary = fallback
          }

          const dirResult: DirectoryAnalysis = {
            type: 'directory',
            path: dirRel,
            name: path.basename(dirRel),
            description,
            summary,
            childrenDirsCount: dirChildren.length,
            childrenFilesCount: fileChildren.length,
            structure: childResults.map(child => ({
              name: child.name,
              type: child.type,
              description: child.summary,
            })),
            lastAnalyzedAt: new Date().toISOString(),
            commitHash: params.commitHash,
          }

          try {
            await this.storageService.saveDirectoryAnalysis(this.projectSlug, dirRel, dirResult)
            completedDirs.push(dirRel)
            const dirSourceAbsPath = path.resolve(params.projectRoot, dirRel)
            const dirResultAbsPath = path.resolve(storageRoot, getDirOutputPath(storageRoot, dirRel))
            indexEntries.push({ sourcePath: dirSourceAbsPath, resultPath: dirResultAbsPath, type: 'directory' })
            params.onObjectCompleted?.(dirObj, { status: 'parsed' })
          } catch (e: any) {
            const msg = (e as Error)?.message ?? String(e)
            errors.push({ path: dirRel, message: msg })
            params.onObjectCompleted?.(dirObj, { status: 'failed', reason: msg })
            return
          }
        })
      }
    } catch (e: any) {
      if (typeof (workerPool as any).terminate === 'function') {
        await (workerPool as any).terminate(true).catch(() => {})
      } else {
        workerPool.cancelAll()
      }
      throw e
    } finally {
      if (typeof (workerPool as any).terminate === 'function') {
        await (workerPool as any).terminate(true).catch(() => {})
      } else {
        workerPool.cancelAll()
      }
    }

    const duration = Date.now() - startTime
    const summaryPath = path.join(storageRoot, 'index.md')

    return {
      success: errors.length === 0,
      analyzedFilesCount: completedFiles.length,
      analyzedDirsCount: completedDirs.length,
      duration,
      errors,
      projectSlug: this.projectSlug,
      summaryPath,
      indexEntries,
      removedSourcePaths,
    }
  }

  // ---------------------------------------------------------------------------
  // 向后兼容包装
  // ---------------------------------------------------------------------------

  async fullAnalysis(params: FullAnalysisParams): Promise<AnalysisResult> {
    return this.analyze({
      projectRoot: params.projectRoot,
      depth: params.depth,
      concurrency: params.concurrency,
      mode: 'full',
      commitHash: this.currentCommit,
      fileFilter: async () => true,
      onObjectPlanned: params.onObjectPlanned,
      onObjectStarted: params.onObjectStarted,
      onObjectCompleted: params.onObjectCompleted,
      onScanProgress: params.onScanProgress,
    })
  }

  async incrementalAnalysis(params: IncrementalAnalysisParams): Promise<AnalysisResult> {
    const changedFilesSet = new Set(params.changedFiles || [])
    const storageRoot = this.storageService.getStoragePath(this.projectSlug)
    const fileFilter = async (relPath: string, _absPath: string): Promise<boolean> => {
      if (changedFilesSet.has(relPath)) return true
      const resultPath = getFileOutputPath(storageRoot, relPath)
      return !(await fs.pathExists(resultPath))
    }
    return this.analyze({
      projectRoot: params.projectRoot,
      concurrency: params.concurrency,
      mode: 'incremental',
      commitHash: params.targetCommit,
      fileFilter,
      onObjectPlanned: params.onObjectPlanned,
      onObjectStarted: params.onObjectStarted,
      onObjectCompleted: params.onObjectCompleted,
      onScanProgress: params.onScanProgress,
    })
  }

  async resumeAnalysis(params: ResumeAnalysisParams): Promise<AnalysisResult> {
    throw new AppError(ErrorCode.ANALYSIS_EXCEPTION, 'Resume/checkpoint feature is not implemented yet')
  }
}
