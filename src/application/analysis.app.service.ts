import {
  AnalyzeProjectCommandParams,
  AnalyzeProjectCommandResult,
  LLMConfig,
  AnalysisObject,
  ObjectResultMeta,
} from '../common/types'
import { GitService } from '../infrastructure/git.service'
import { LocalStorageService } from '../infrastructure/storage.service'
import { BlacklistService } from '../infrastructure/blacklist.service'
import { SkillGenerator } from '../infrastructure/skill/skill.generator'
import { AnalysisService } from '../domain/services/analysis.service'
import { generateProjectSlug, getStoragePath, getFileOutputPath, hashTextContent } from '../common/utils'
import { AppError, ErrorCode } from '../common/errors'
import { DEFAULT_CONCURRENCY } from '../common/constants'
import { logger } from '../common/logger'
import type { SkillProvider } from '../domain/interfaces'
import type { Config } from '../common/config'
import * as path from 'path'
import * as fs from 'fs-extra'
import { OpenAIClient } from '../infrastructure/llm/openai.client'

export class AnalysisAppService {
  private totalObjects = 0
  private completedObjects = 0
  private activeObjects: Set<string> = new Set()
  private progressEnabled = false
  private onProgress?: AnalyzeProjectCommandParams['onProgress']
  private concurrency = DEFAULT_CONCURRENCY
  private lastRenderedCurrentKey: string | null = null

  async runAnalysis(params: AnalyzeProjectCommandParams & { outputDir?: string }): Promise<AnalyzeProjectCommandResult> {
    const projectRoot = params.path || process.cwd()
    logger.info(`Analysis started. Project root: ${projectRoot}`)
    this.progressEnabled = typeof params.onProgress === 'function'
    this.onProgress = params.onProgress
    this.concurrency = params.concurrency || DEFAULT_CONCURRENCY
    this.totalObjects = 0
    this.completedObjects = 0
    this.activeObjects = new Set()
    this.lastRenderedCurrentKey = null
    const outputDir = params.outputDir
    const gitService = new GitService(projectRoot)
    const storageService = new LocalStorageService(projectRoot, outputDir)

    // 检测是否为Git项目
    const isGit = await gitService.isGitProject()
    let projectSlug: string
    let currentCommit = ''
    let currentBranch = ''
    logger.debug(`Project path: ${projectRoot}, isGit: ${isGit}`)

    if (isGit) {
      currentCommit = await gitService.getCurrentCommit()
      currentBranch = await gitService.getCurrentBranch()
      const gitSlug = await gitService.getProjectSlug()
      projectSlug = generateProjectSlug(projectRoot, true, gitSlug)
      logger.debug(`Git info: branch=${currentBranch}, commit=${currentCommit}, slug=${gitSlug}`)
    } else {
      projectSlug = generateProjectSlug(projectRoot, false)
    }

    // 检测解析模式
    let mode: 'full' | 'incremental' = params.mode === 'full' ? 'full' : 'incremental'
    if (params.mode === 'auto') {
      const hasAnyResult = await storageService.hasAnyResult(projectSlug)
      mode = hasAnyResult ? 'incremental' : 'full'
      logger.debug(
        `Auto mode detection: hasAnyResult=${hasAnyResult}, selected=${mode}`,
      )
    }
    logger.info(`Analysis mode: ${mode}`)

    let runConfig: Config
    try {
      const { configManager } = await import('../common/config')
      runConfig = configManager.getConfig()
    } catch {
      const { configManager } = await import('../common/config')
      runConfig = await configManager.load()
    }
    const blacklistService = new BlacklistService()
    await blacklistService.load(runConfig.analyze.blacklist, projectRoot)
    const maxFileSizeBytes =
      typeof params.maxFileSizeBytes === 'number' && Number.isFinite(params.maxFileSizeBytes) && params.maxFileSizeBytes > 0
        ? params.maxFileSizeBytes
        : runConfig.analyze.max_file_size_bytes
    const llmConfig = params.llmConfig as LLMConfig
    const storageRoot = getStoragePath(projectRoot, outputDir)

    if (!params.noSkills) {
      try {
        const skillGenerator = new SkillGenerator()
        const providers = (params.skillsProviders ?? runConfig.skills.default_providers) as SkillProvider[]
        await skillGenerator.generate({ projectRoot, storageRoot, providers })
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        logger.warn(`Skill generation failed: ${msg}`)
      }
    }

    const analysisService = new AnalysisService(
      gitService,
      storageService,
      blacklistService,
      projectSlug,
      currentCommit,
      llmConfig,
      params.onTokenUsageSnapshot,
    )

    const startTime = Date.now()

    // ===================================================================
    // 构建文件过滤器（全量 vs 增量唯一的差异点）
    // ===================================================================
    let fileFilter: (relPath: string, absPath: string) => Promise<boolean>
    let commitHash: string = currentCommit

    // 增量过滤诊断（长期保留）：低噪声、可快速定位
    const filterStats = {
      checked: 0,
      skippedTooLarge: 0,
      queuedMissingResult: 0,
      queuedMissingHash: 0,
      queuedReadError: 0,
      queuedHashDiff: 0,
      skippedUnchanged: 0,
      examples: {
        tooLarge: [] as Array<{ relPath: string; absPath: string; size: number; limit: number }>,
        missingResult: [] as Array<{ relPath: string; mdPath: string }>,
        missingHash: [] as Array<{ relPath: string; mdPath: string }>,
        readError: [] as Array<{ relPath: string; absPath: string; error: string }>,
        hashDiff: [] as Array<{ relPath: string; mdPath: string; oldHash: string; newHash: string }>,
      },
    }
    const pushExample = <T,>(arr: T[], item: T) => {
      // 固定最多保留 10 条样例，避免刷屏
      if (arr.length < 10) arr.push(item)
    }
    const isTooLarge = async (relPath: string, absPath: string): Promise<boolean> => {
      try {
        const stat = await fs.stat(absPath)
        if (stat.size > maxFileSizeBytes) {
          filterStats.skippedTooLarge++
          pushExample(filterStats.examples.tooLarge, {
            relPath,
            absPath,
            size: stat.size,
            limit: maxFileSizeBytes,
          })
          return true
        }
        return false
      } catch (e: unknown) {
        filterStats.queuedReadError++
        const msg = e instanceof Error ? e.message : String(e)
        pushExample(filterStats.examples.readError, { relPath, absPath, error: msg })
        // 无法读取 stat 时保守继续解析，避免误过滤
        return false
      }
    }

    if (mode === 'full') {
      // 全量：所有文件均需解析
      fileFilter = async (relPath: string, absPath: string) => {
        filterStats.checked++
        if (await isTooLarge(relPath, absPath)) return false
        return true
      }
    } else {
      logger.debug(
        `[incremental-filter] enabled | projectRoot=${projectRoot} | storageRoot=${storageRoot} | slug=${projectSlug}`,
      )
      // 增量：统一使用文件内容 hash（sha256）判定是否变化，不区分是否 Git 项目。
      fileFilter = async (relPath: string, absPath: string): Promise<boolean> => {
        filterStats.checked++
        if (await isTooLarge(relPath, absPath)) return false
        const mdPath = getFileOutputPath(storageRoot, relPath)

        // 检查已有结果是否存在
        const existing = await storageService.getFileAnalysis(projectSlug, relPath, 'summary')
        if (!existing) {
          filterStats.queuedMissingResult++
          pushExample(filterStats.examples.missingResult, { relPath, mdPath })
          return true // 结果缺失 → 需要解析
        }
        // 若历史结果缺少 hash 或无法读取当前文件，则保守重跑，避免漏解析
        if (!existing.fileHashWhenAnalyzed) {
          filterStats.queuedMissingHash++
          pushExample(filterStats.examples.missingHash, { relPath, mdPath })
          return true
        }
        try {
          const content = await fs.readFile(absPath, 'utf-8')
          const currentHash = hashTextContent(content)
          if (existing.fileHashWhenAnalyzed !== currentHash) {
            filterStats.queuedHashDiff++
            pushExample(filterStats.examples.hashDiff, {
              relPath,
              mdPath,
              oldHash: existing.fileHashWhenAnalyzed,
              newHash: currentHash,
            })
            return true
          }

          filterStats.skippedUnchanged++
          return false
        } catch (e: unknown) {
          filterStats.queuedReadError++
          const msg = e instanceof Error ? e.message : String(e)
          pushExample(filterStats.examples.readError, { relPath, absPath, error: msg })
          return true
        }
      }
    }

    // ===================================================================
    // 调用统一解析管线
    // ===================================================================
    logger.debug(`Analysis params: depth=${params.depth}, concurrency=${params.concurrency || DEFAULT_CONCURRENCY}`)
    const analysisResult = await analysisService.analyze({
      projectRoot,
      depth: params.depth,
      concurrency: params.concurrency || DEFAULT_CONCURRENCY,
      mode,
      commitHash,
      fileFilter,
      onTotalKnown: (total) => {
        this.totalObjects = total
        params.onTotalKnown?.(total)
      },
      onObjectPlanned: obj => this.handleObjectPlanned(obj),
      onObjectStarted: obj => this.handleObjectStarted(obj),
      onObjectCompleted: (obj, meta) => this.handleObjectCompleted(obj, meta, params),
      onScanProgress: params.onScanProgress,
    })

    const duration = Date.now() - startTime
    const summaryPath = analysisResult.summaryPath
    const tokenUsage = analysisService.getTokenUsage()

    logger.debug(
      `[file-filter] sizeLimitBytes=${maxFileSizeBytes} | checked=${filterStats.checked} | skippedTooLarge=${filterStats.skippedTooLarge}`,
    )
    if (filterStats.examples.tooLarge.length > 0) {
      logger.debug(
        `[file-filter] examples: tooLarge (showing ${filterStats.examples.tooLarge.length})`,
      )
      for (const it of filterStats.examples.tooLarge) {
        logger.debug(`[file-filter]   ${JSON.stringify(it)}`)
      }
    }

    if (mode === 'incremental') {
      logger.debug(
        [
          '[incremental-filter] summary',
          `checked=${filterStats.checked}`,
          `skippedTooLarge=${filterStats.skippedTooLarge}`,
          `queuedMissingResult=${filterStats.queuedMissingResult}`,
          `queuedMissingHash=${filterStats.queuedMissingHash}`,
          `queuedReadError=${filterStats.queuedReadError}`,
          `queuedHashDiff=${filterStats.queuedHashDiff}`,
          `skippedUnchanged=${filterStats.skippedUnchanged}`,
        ].join(' | '),
      )

      const dump = (title: string, items: unknown[]) => {
        if (items.length === 0) return
        logger.debug(`[incremental-filter] examples: ${title} (showing ${items.length})`)
        for (const it of items) {
          logger.debug(`[incremental-filter]   ${JSON.stringify(it)}`)
        }
      }
      dump('missingResult', filterStats.examples.missingResult)
      dump('missingHash', filterStats.examples.missingHash)
      dump('readError', filterStats.examples.readError)
      dump('hashDiff', filterStats.examples.hashDiff)
    }

    return {
      success: analysisResult.success,
      code: analysisResult.success ? ErrorCode.SUCCESS : ErrorCode.ANALYSIS_EXCEPTION,
      message: analysisResult.success ? 'Analysis completed' : `Analysis completed with ${analysisResult.errors.length} error(s)`,
      data: {
        projectName: projectSlug,
        mode,
        analyzedFilesCount: analysisResult.analyzedFilesCount,
        duration,
        summaryPath,
        tokenUsage,
      },
      errors: analysisResult.errors.length > 0 ? analysisResult.errors : undefined
    }
  }

  private handleObjectPlanned(_obj: AnalysisObject): void {
    // totalObjects 由 analyze 内部的 onTotalKnown 回调设置
  }

  private handleObjectStarted(obj: AnalysisObject): void {
    if (!this.progressEnabled) return
    const normalized = this.normalizeObjectPath(obj)
    this.activeObjects.add(normalized)
    this.emitProgressSnapshot(new Set(this.activeObjects), normalized)
  }

  private handleObjectCompleted(
    obj: AnalysisObject,
    _meta: ObjectResultMeta,
    params: AnalyzeProjectCommandParams,
  ): void {
    this.completedObjects++
    if (!this.progressEnabled) {
      return
    }

    const normalized = this.normalizeObjectPath(obj)
    this.activeObjects.delete(normalized)
    this.concurrency = params.concurrency || DEFAULT_CONCURRENCY
    this.emitProgressSnapshot(new Set(this.activeObjects), normalized)
  }

  private normalizeObjectPath(obj: AnalysisObject): string {
    const p = obj.path.replace(/\\/g, '/')
    if (obj.type === 'directory') {
      if (p === '.') return './'
      return p.endsWith('/') ? p : `${p}/`
    }
    return p
  }

  private emitProgressSnapshot(snapshot: Set<string>, fallbackNormalized: string): void {
    if (!this.onProgress) return

    const activePaths = Array.from(snapshot)
      .map(p => p.replace(/\\/g, '/'))
      .sort()

    const topN = activePaths.slice(0, this.concurrency)
    const displayLines = topN
    const key = displayLines.join('\n')
    if (key === this.lastRenderedCurrentKey) {
      return
    }
    this.lastRenderedCurrentKey = key

    this.onProgress(this.completedObjects, this.totalObjects, {
      path: key,
    })
  }
}
