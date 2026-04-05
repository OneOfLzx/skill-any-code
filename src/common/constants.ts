export const ANALYSIS_VERSION = '1.0.0'
export const SCHEMA_VERSION = '1.0'
export const MAX_GIT_COMMITS_HISTORY = 50
export const DEFAULT_CONCURRENCY = require('os').cpus().length * 2
// 所有文本代码文件都支持，无后缀限制，由LLM自动识别语言
export const SUPPORTED_EXTENSIONS = ['*']
// V2.3：默认黑名单已迁移至 config.ts 的 DEFAULT_BLACKLIST
export const DEFAULT_OUTPUT_DIR = './.skill-any-code-result'
