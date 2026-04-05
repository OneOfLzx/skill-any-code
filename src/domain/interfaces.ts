import type {
  AnalysisResult,
  AnalysisParams,
  FullAnalysisParams,
  IncrementalAnalysisParams,
  ResumeAnalysisParams,
  FileAnalysis,
  DirectoryAnalysis,
  AnalysisCheckpoint,
  ModificationLog,
  LLMConfig,
  LLMCallOptions,
  LLMResponse,
  FileChunk,
  FileChunkAnalysis,
  TokenUsageStats,
} from '../common/types'

// ===== V2.3 黑名单服务接口 =====
export interface IBlacklistService {
  load(globalBlacklist: string[], projectRoot: string): Promise<void>
  isIgnored(relativePath: string): boolean
}

/** AI 工具 Provider 标识 */
export type SkillProvider = 'opencode' | 'cursor' | 'claude' | 'codex'

/** Skill 生成配置 */
export interface SkillGenerateOptions {
  projectRoot: string
  storageRoot: string
  providers: SkillProvider[]
}

/** Skill 生成器接口 */
export interface ISkillGenerator {
  generate(options: SkillGenerateOptions): Promise<string[]>
}

// 解析服务接口
export interface IAnalysisService {
  /** 统一解析入口：全量与增量共享管线，仅通过 fileFilter 区分 */
  analyze(params: AnalysisParams): Promise<AnalysisResult>
  /** @deprecated 向后兼容，内部转为 analyze 调用 */
  fullAnalysis(params: FullAnalysisParams): Promise<AnalysisResult>
  /** @deprecated 向后兼容，内部转为 analyze 调用 */
  incrementalAnalysis(params: IncrementalAnalysisParams): Promise<AnalysisResult>
  resumeAnalysis(params: ResumeAnalysisParams): Promise<AnalysisResult>
}

// 增量计算服务接口
export interface IIncrementalService {
  canDoIncremental(projectRoot: string): Promise<{
    available: boolean
    baseCommit?: string
    reason?: string
  }>
  getChangedFiles(projectRoot: string, baseCommit: string, targetCommit: string): Promise<string[]>
  findNearestCommonAncestor(projectRoot: string, commits: string[]): Promise<string | null>
  getAffectedDirectories(changedFiles: string[]): string[]
}

// 存储服务接口（V2.3 已移除 saveProjectSummary / getProjectSummary / saveModificationLog）
export interface IStorageService {
  saveFileAnalysis(projectSlug: string, filePath: string, data: FileAnalysis): Promise<void>
  saveDirectoryAnalysis(projectSlug: string, dirPath: string, data: DirectoryAnalysis): Promise<void>
  getFileAnalysis(projectSlug: string, filePath: string, type: 'summary' | 'full' | 'diagram'): Promise<FileAnalysis | null>
  getDirectoryAnalysis(projectSlug: string, dirPath: string, type: 'summary' | 'full' | 'diagram'): Promise<DirectoryAnalysis | null>
  getCheckpoint(projectSlug: string): Promise<AnalysisCheckpoint | null>
  saveCheckpoint(projectSlug: string, checkpoint: AnalysisCheckpoint): Promise<void>
  getStoragePath(projectSlug: string): string
}

// Git操作服务接口
export interface IGitService {
  isGitProject(projectRoot: string): Promise<boolean>
  getCurrentCommit(projectRoot: string): Promise<string>
  getCurrentBranch(projectRoot: string): Promise<string>
  getProjectSlug(projectRoot: string): Promise<string>
  getUncommittedChanges(projectRoot: string): Promise<string[]>
  diffCommits(projectRoot: string, commit1: string, commit2: string): Promise<string[]>
  /** 文件级 git commit id（最近一次修改该文件的提交），需求 10.3.2 / 13.8 */
  getFileLastCommit(projectRoot: string, filePath: string): Promise<string | null>
  /** 文件是否处于 dirty 状态（存在未提交修改），需求 10.3.2 / 13.8 */
  isFileDirty(projectRoot: string, filePath: string): Promise<boolean>
}

// Worker调度服务接口
export interface IWorkerPoolService {
  submitFileAnalysisTask(
    filePath: string,
    fileContent: string,
    fileHash: string,
    language?: string
  ): Promise<{ analysis: FileAnalysis; usage: TokenUsageStats }>
  submitDirectoryAggregationTask(
    dirPath: string,
    payload: {
      childrenDirs: Array<{ name: string; summary: string; description?: string }>
      childrenFiles: Array<{ name: string; summary: string; description?: string }>
    }
  ): Promise<{ description: string; summary: string; usage: TokenUsageStats }>
  submitValidationTask(parentResult: DirectoryAnalysis, childResult: FileAnalysis | DirectoryAnalysis): Promise<{
    valid: boolean
    corrections?: Partial<FileAnalysis | DirectoryAnalysis>
    log?: ModificationLog
  }>
  setConcurrency(concurrency: number): void
  waitAll(): Promise<void>
  cancelAll(): void
  terminate(force?: boolean): Promise<void>
}

// LLM服务客户端接口
export interface ILLMClient {
  /**
   * 连接可用性校验（V2.5）
   * - 在进入任何解析流程前调用；
   * - 配置不完整或服务不可用时抛出带有明确 ErrorCode 的 AppError。
   */
  testConnection(config: LLMConfig): Promise<void>;

  /**
   * 调用LLM服务执行请求
   * @param prompt 提示词
   * @param options 调用选项
   */
  call(prompt: string, options?: LLMCallOptions): Promise<LLMResponse>;

  /**
   * 批量调用LLM服务
   * @param prompts 提示词列表
   * @param options 调用选项
   */
  batchCall(prompts: string[], options?: LLMCallOptions): Promise<LLMResponse[]>;
}

// 文件分片处理器接口
export interface IFileSplitter {
  /**
   * 按语义边界拆分大文件
   * @param fileContent 文件内容
   * @param maxChunkSize 单分片最大长度
   */
  split(fileContent: string, maxChunkSize: number): Promise<FileChunk[]>;

  /**
   * 合并多个分片的解析结果
   * @param chunks 分片解析结果列表
   * @param filePath 文件路径
   */
  merge(chunks: FileChunkAnalysis[], filePath: string): Promise<FileAnalysis>;
}

// 解析结果缓存接口
export interface IAnalysisCache {
  /**
   * 获取缓存的解析结果
   * @param fileHash 文件内容哈希
   */
  get(fileHash: string): Promise<FileAnalysis | null>;

  /**
   * 保存解析结果到缓存
   * @param fileHash 文件内容哈希
   * @param result 解析结果
   */
  set(fileHash: string, result: FileAnalysis): Promise<void>;

  /**
   * 清除缓存
   * @param fileHash 可选，指定文件哈希清除，不传则清除全部
   */
  clear(fileHash?: string): Promise<void>;
}

// 代码解析器接口
export interface ICodeParser {
  supportedExtensions: string[]
  parse(fileContent: string, filePath: string): Promise<Omit<FileAnalysis, 'path' | 'type'>>
}

// 解析器注册中心接口
export interface IParserRegistry {
  registerParser(parser: ICodeParser): void
  getParser(extension: string): ICodeParser | null
  getSupportedExtensions(): string[]
}
