import { AnalysisAppService } from './analysis.app.service'
import { GitService } from '../infrastructure/git.service'
import { LocalStorageService } from '../infrastructure/storage.service'
import { AnalysisService } from '../domain/services/analysis.service'
import { IncrementalService } from '../domain/services/incremental.service'
import type { LLMConfig, TokenUsageStats } from '../common/types'

export interface AppServices {
  analysisAppService: AnalysisAppService
  analysisService: AnalysisService
  incrementalService: IncrementalService
  gitService: GitService
  storageService: LocalStorageService
}

export function createAppServices(
  projectRoot?: string,
  llmConfig?: LLMConfig,
  onTokenUsageSnapshot?: (stats: TokenUsageStats) => void,
): AppServices {
  const root = projectRoot || process.cwd()
  const gitService = new GitService(root)
  const storageService = new LocalStorageService(root)
  const incrementalService = new IncrementalService(gitService, storageService)

  const analysisAppService = new AnalysisAppService()

  return {
    analysisAppService,
    analysisService: {} as AnalysisService,
    incrementalService,
    gitService,
    storageService,
  }
}
