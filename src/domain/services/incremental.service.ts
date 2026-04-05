import { IIncrementalService, IGitService, IStorageService } from '../interfaces'

export class IncrementalService implements IIncrementalService {
  constructor(
    private gitService: IGitService,
    private storageService: IStorageService
  ) {}

  async canDoIncremental(projectRoot: string): Promise<{ available: boolean; baseCommit?: string; reason?: string }> {
    const isGit = await this.gitService.isGitProject(projectRoot)
    if (!isGit) return { available: false, reason: 'Not a git project' }

    // V2.6：不再生成/读取 .analysis_metadata.json，因此无法基于历史记录计算可用的 baseCommit。
    // 主流程会回退到逐文件 commitId/hash 判定，无需依赖此服务。
    return { available: false, reason: 'Metadata disabled (V2.6): fallback to per-file incremental detection' }
  }

  async getChangedFiles(projectRoot: string, baseCommit: string, targetCommit: string): Promise<string[]> {
    return this.gitService.diffCommits(projectRoot, baseCommit, targetCommit)
  }

  async findNearestCommonAncestor(projectRoot: string, commits: string[]): Promise<string | null> {
    try {
      const { simpleGit } = await import('simple-git')
      const git = simpleGit(projectRoot)
      const commonAncestor = await git.raw(['merge-base', '--octopus', ...commits])
      return commonAncestor.trim() || null
    } catch (e) {
      return null
    }
  }

  getAffectedDirectories(changedFiles: string[]): string[] {
    const directories = new Set<string>()
    
    changedFiles.forEach(file => {
      const parts = file.split('/')
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/')
        if (dir) {
          directories.add(dir)
        }
      }
    })

    directories.add('')

    return Array.from(directories)
  }
}
