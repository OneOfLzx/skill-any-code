// 元数据结构
export interface AnalysisMetadata {
  projectRoot: string
  lastAnalyzedAt: string
  gitCommits: Array<{
    hash: string
    branch: string
    analyzedAt: string
  }>
  /**
   * 非 Git 项目增量：文件快照（用于两次运行间的变更检测）。
   * 仅记录 stat 级信息，避免全量读取文件内容。
   *
   * key 为相对 projectRoot 的文件路径（保持与运行时 path.relative 一致，可能含 \ 或 /）。
   */
  fileSnapshot?: Record<string, { mtimeMs: number; size: number }>
  analysisVersion: string
  analyzedFilesCount: number
  schemaVersion: string
}

// 文件分析结果
export interface FileAnalysis {
  type: 'file'
  path: string
  name: string
  language: string
  linesOfCode: number
  dependencies: string[]
  /**
   * 解析时文件内容哈希，用于增量与缓存决策，对应设计文档 10.3.2 / 13.2.1
   */
  fileHashWhenAnalyzed?: string
  /** 文件功能描述（200字以内），由 LLM 第二步调用生成 */
  description?: string
  /**
   * Symbols：类/全局变量/全局函数/结构体简介等松散 Markdown 输出（由第一步调用生成）。
   * 对应最终落盘 Markdown 中的 `## Symbols` 章节。
   */
  symbols?: string
  summary: string
  classes: Array<{
    name: string
    extends?: string
    implements?: string[]
    methods: Array<{
      name: string
      signature: string
      description: string
      visibility: 'public' | 'private' | 'protected'
    }>
    properties: Array<{
      name: string
      type: string
      description: string
      visibility: 'public' | 'private' | 'protected'
    }>
  }>
  functions: Array<{
    name: string
    signature: string
    description: string
  }>
  lastAnalyzedAt: string
  commitHash: string
}

// 目录分析结果
export interface DirectoryAnalysis {
  type: 'directory'
  path: string
  name: string
  /** 目录功能描述（200 字以内） */
  description: string
  /** 目录概述（100 字以内） */
  summary: string
  /** 直接子目录数量 */
  childrenDirsCount: number
  /** 直接子文件数量（仅解析范围内的文本代码文件） */
  childrenFilesCount: number
  structure: Array<{
    name: string
    type: 'file' | 'directory'
    description: string
  }>
  lastAnalyzedAt: string
  commitHash: string
}

// 项目整体总结
export interface ProjectSummary {
  projectName: string
  slug: string
  description: string
  techStack: string[]
  codeSize: {
    files: number
    lines: number
    languages: Record<string, number>
  }
  architecture: {
    layers: string[]
    modules: Array<{ name: string; description: string }>
    dependencies: Array<{ from: string; to: string }>
  }
  coreFlow: string
  architectureDiagram: string
  flowDiagram: string
  generatedAt: string
  commitHash: string
}

// 修正日志
export interface ModificationLog {
  id: string
  timestamp: string
  path: string
  type: 'inconsistency' | 'omission' | 'error'
  originalContent: string
  correctedContent: string
  reason: string
}

// 解析断点
export interface AnalysisCheckpoint {
  projectRoot: string
  commitHash: string
  mode: 'full' | 'incremental'
  completedFiles: string[]
  completedDirs: string[]
  pendingTasks: Array<{ type: 'file' | 'directory'; path: string }>
  createdAt: string
}

// ===== V2.3 索引相关类型 =====
export interface IndexEntry {
  resultPath: string
  type: 'file' | 'directory'
}

export interface AnalysisIndex {
  version: string
  projectRoot: string
  storageRoot: string
  generatedAt: string
  entries: Record<string, IndexEntry>
}

// ===== V2.3 resolve-config.json =====
export interface ResolveConfig {
  indexFilePath: string
}

export interface AnalysisObject {
  type: 'file' | 'directory'
  path: string
}

export interface ObjectResultMeta {
  status: 'parsed' | 'cached' | 'filtered' | 'skipped' | 'failed'
  reason?: string
}

// 进度回调：每完成一个对象（文件/目录）时调用（兼容旧接口）
export type ProgressCallback = (done: number, total: number, current?: { path: string }) => void

// 分析服务参数
export interface FullAnalysisParams {
  projectRoot: string
  depth?: number
  concurrency: number
  /** 可选：每完成一个文件/目录时回调，用于进度条等 */
  onProgress?: ProgressCallback
  /** V2.4：对象级生命周期回调 */
  onObjectPlanned?: (obj: AnalysisObject) => void
  onObjectStarted?: (obj: AnalysisObject) => void
  onObjectCompleted?: (obj: AnalysisObject, meta: ObjectResultMeta) => void
  /** V2.6：扫描阶段进度回调，统计“将被解析的对象数（文件+目录）”，用于 CLI 单行实时展示 */
  onScanProgress?: (scannedFiles: number) => void
}

export interface IncrementalAnalysisParams {
  projectRoot: string
  baseCommit: string
  targetCommit: string
  changedFiles: string[]
  /**
   * V2.6：增量自修复 - 需要重新聚合的目录列表（例如目录结果缺失但文件未变更）
   */
  changedDirs?: string[]
  concurrency: number
  /** V2.4：对象级生命周期回调 */
  onObjectPlanned?: (obj: AnalysisObject) => void
  onObjectStarted?: (obj: AnalysisObject) => void
  onObjectCompleted?: (obj: AnalysisObject, meta: ObjectResultMeta) => void
  /** 扫描阶段进度回调，用于 CLI 单行实时展示增量待处理对象数（文件+目录） */
  onScanProgress?: (scannedObjects: number) => void
}

export interface ResumeAnalysisParams {
  projectRoot: string
  checkpoint: AnalysisCheckpoint
}

/**
 * 统一解析参数：全量与增量共享同一条管线，仅通过 fileFilter 区分过滤策略。
 */
export interface AnalysisParams {
  projectRoot: string
  depth?: number
  concurrency: number
  mode: 'full' | 'incremental'
  commitHash: string
  /** 文件过滤器：返回 true 表示该文件需要（重新）解析 */
  fileFilter: (relPath: string, absPath: string) => Promise<boolean>
  /** 过滤完成后通知总对象数（用于 CLI 启动进度条） */
  onTotalKnown?: (total: number) => void
  onObjectPlanned?: (obj: AnalysisObject) => void
  onObjectStarted?: (obj: AnalysisObject) => void
  onObjectCompleted?: (obj: AnalysisObject, meta: ObjectResultMeta) => void
  onScanProgress?: (scannedFiles: number) => void
}

// 分析结果
export interface AnalysisResult {
  success: boolean
  analyzedFilesCount: number
  analyzedDirsCount: number
  duration: number
  errors: Array<{ path: string; message: string }>
  projectSlug: string
  summaryPath: string
  /** V2.3：解析过程中收集的索引条目 */
  indexEntries: Array<{ sourcePath: string; resultPath: string; type: 'file' | 'directory' }>
  /** V2.3：增量解析中已删除的源码路径 */
  removedSourcePaths: string[]
}

// 命令参数类型
export interface AnalyzeProjectCommandParams {
  path?: string
  mode?: 'full' | 'incremental' | 'auto'
  depth?: number
  concurrency?: number
  /** 项目扫描时单文件大小上限（bytes）；超过后跳过解析 */
  maxFileSizeBytes?: number
  llmConfig?: LLMConfig
  /** V2.3：Skill 部署的 Provider 列表 */
  skillsProviders?: string[]
  /** V2.3：是否跳过 Skill 生成 */
  noSkills?: boolean
  /** V2.3：结果输出目录 */
  outputDir?: string
  /** 总对象数已知时回调（用于 CLI 启动进度条） */
  onTotalKnown?: (total: number) => void
  /** 进度更新回调（done, total, current） */
  onProgress?: ProgressCallback
  /** Token 使用快照回调：每次 LLM 调用后触发，用于 CLI UI 实时展示 Tokens 行 */
  onTokenUsageSnapshot?: (stats: TokenUsageStats) => void
  /** V2.6：扫描阶段进度回调，用于 CLI 单行显示“已扫描将被解析的对象数（文件+目录）” */
  onScanProgress?: (scannedFiles: number) => void
}

// 命令返回结果
export interface AnalyzeProjectCommandResult {
  success: boolean
  code: number
  message: string
  data?: {
    projectName: string
    mode: 'full' | 'incremental'
    analyzedFilesCount: number
    duration: number
    summaryPath: string
    tokenUsage?: TokenUsageStats
  }
  errors?: Array<{
    path: string
    message: string
  }>
}

// LLM调用选项
export interface LLMCallOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  retries?: number;
}

// LLM响应结果
export interface LLMResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  responseTime: number;
}

export interface TokenUsageStats {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalCalls: number
}

// 文件分片
export interface FileChunk {
  id: number;
  content: string;
  startLine: number;
  endLine: number;
  context?: string;
}

// 分片解析结果
export interface FileChunkAnalysis {
  chunkId: number;
  classes: Array<{
    name: string;
    extends?: string;
    implements?: string[];
    methods: Array<{
      name: string;
      signature: string;
      description: string;
      visibility: 'public' | 'private' | 'protected';
    }>;
    properties: Array<{
      name: string;
      type: string;
      description: string;
      visibility: 'public' | 'private' | 'protected';
    }>;
  }>;
  functions: Array<{
    name: string;
    signature: string;
    description: string;
  }>;
}

// LLM配置
export interface LLMConfig {
  model: string;
  api_key: string;
  base_url?: string;
  temperature: number;
  max_tokens: number;
  timeout: number;
  proxy?: string;
  max_retries: number;
  retry_delay: number;
  context_window_size: number;
  cache_enabled: boolean;
  cache_dir: string;
  // V2.5：缓存容量上限（MB），0 表示禁用磁盘缓存
  cache_max_size_mb: number;
}

// 扩展CLI配置（与 Config 对齐，供类型引用）
export interface CliConfig {
  global: {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    outputFormat: 'text' | 'json' | 'markdown';
    autoConfirm: boolean;
    outputDir: string;
  };
  llm: LLMConfig;
  commands: {
    analyze: {
      defaultDepth: number;
      defaultConcurrency: number;
    };
    skills: {
      defaultProviders: string[];
    };
  };
}
