export enum ErrorCode {
  SUCCESS = 200,
  PARAM_VALIDATION_FAILED = 4000,
  PROJECT_PATH_NOT_EXIST = 4001,
  NO_PARSER_AVAILABLE = 4002,
  INCREMENTAL_NOT_AVAILABLE = 4003,
  ANALYSIS_NOT_EXIST = 4004,
  CONFIG_NOT_INITIALIZED = 4005,
  ANALYSIS_EXCEPTION = 5000,
  GIT_OPERATION_FAILED = 5001,
  STORAGE_WRITE_FAILED = 5002,
  WORKER_SCHEDULE_FAILED = 5003,
  LLM_CALL_FAILED = 5010,
  LLM_RESPONSE_PARSE_FAILED = 5011,
  LLM_RATE_LIMITED = 5012,
  LLM_TIMEOUT = 5013,
  LLM_INVALID_CONFIG = 5014,
  FILE_TOO_LARGE = 5020,
  FILE_SPLIT_FAILED = 5021,
  CHUNK_MERGE_FAILED = 5022,
}

export class AppError extends Error {
  code: ErrorCode
  details?: any

  constructor(code: ErrorCode, message: string, details?: any) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
    Object.setPrototypeOf(this, AppError.prototype)
  }
}
