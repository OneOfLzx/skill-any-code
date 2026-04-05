import simpleGit, { SimpleGit } from 'simple-git'
import { IGitService } from '../../domain/interfaces'
import { AppError, ErrorCode } from '../../common/errors'
import * as path from 'path'

export class GitService implements IGitService {
  private gitInstances: Map<string, SimpleGit> = new Map()

  private getGitInstance(projectRoot: string): SimpleGit {
    if (!this.gitInstances.has(projectRoot)) {
      this.gitInstances.set(projectRoot, simpleGit(projectRoot))
    }
    return this.gitInstances.get(projectRoot)!
  }

  async isGitProject(projectRoot: string): Promise<boolean> {
    try {
      const git = this.getGitInstance(projectRoot)
      await git.revparse(['--is-inside-work-tree'])
      return true
    } catch (e) {
      return false
    }
  }

  async getCurrentCommit(projectRoot: string): Promise<string> {
    try {
      const git = this.getGitInstance(projectRoot)
      const commitHash = await git.revparse(['HEAD'])
      return commitHash.trim()
    } catch (e) {
      throw new AppError(ErrorCode.GIT_OPERATION_FAILED, 'Failed to get current commit', (e as Error).message)
    }
  }

  async getCurrentBranch(projectRoot: string): Promise<string> {
    try {
      const git = this.getGitInstance(projectRoot)
      const branch = await git.revparse(['--abbrev-ref', 'HEAD'])
      return branch.trim()
    } catch (e) {
      throw new AppError(ErrorCode.GIT_OPERATION_FAILED, 'Failed to get current branch', (e as Error).message)
    }
  }

  async getProjectSlug(projectRoot: string): Promise<string> {
    try {
      const git = this.getGitInstance(projectRoot)
      const remoteUrl = await git.remote(['get-url', 'origin'])
      const url = (remoteUrl || '').trim()
      
      // 处理SSH和HTTPS格式的URL
      let slug: string
      if (url.startsWith('git@')) {
        slug = url.split(':')[1].replace('.git', '')
      } else if (url.startsWith('http')) {
        const parts = new URL(url).pathname.split('/')
        slug = `${parts[1]}/${parts[2].replace('.git', '')}`
      } else {
        // 如果没有远程仓库，使用目录名作为slug
        slug = path.basename(projectRoot)
      }
      
      return slug.toLowerCase().replace(/[^a-z0-9-_/]/g, '-')
    } catch (e) {
      // 如果获取远程URL失败，使用目录名作为slug
      return path.basename(projectRoot).toLowerCase().replace(/[^a-z0-9-_]/g, '-')
    }
  }

  async getUncommittedChanges(projectRoot: string): Promise<string[]> {
    try {
      const git = this.getGitInstance(projectRoot)
      const status = await git.status()
      return [...status.modified, ...status.created, ...status.deleted, ...status.renamed.map(r => r.to)]
    } catch (e) {
      throw new AppError(ErrorCode.GIT_OPERATION_FAILED, 'Failed to get uncommitted changes', (e as Error).message)
    }
  }

  async diffCommits(projectRoot: string, commit1: string, commit2: string): Promise<string[]> {
    try {
      const git = this.getGitInstance(projectRoot)
      const diff = await git.diff(['--name-only', commit1, commit2])
      return diff.trim().split('\n').filter(line => line.length > 0)
    } catch (e) {
      throw new AppError(ErrorCode.GIT_OPERATION_FAILED, 'Failed to diff commits', (e as Error).message)
    }
  }

  async getFileLastCommit(projectRoot: string, filePath: string): Promise<string | null> {
    try {
      const git = this.getGitInstance(projectRoot)
      const result = await git.raw(['log', '-n', '1', '--pretty=format:%H', '--', filePath])
      const hash = result.trim()
      return hash || null
    } catch {
      // 对于未纳入 Git 管理或无提交记录的文件，返回 null
      return null
    }
  }

  async isFileDirty(projectRoot: string, filePath: string): Promise<boolean> {
    try {
      const git = this.getGitInstance(projectRoot)
      const status = await git.status()
      const normalizedPath = filePath.replace(/\\/g, '/')

      if (status.modified.includes(normalizedPath)) return true
      if (status.created.includes(normalizedPath)) return true
      if (status.deleted.includes(normalizedPath)) return true
      if (status.renamed.some(r => r.to === normalizedPath || r.from === normalizedPath)) return true

      return false
    } catch {
      // Git 不可用时视为非 dirty，交由上层逻辑处理
      return false
    }
  }
}