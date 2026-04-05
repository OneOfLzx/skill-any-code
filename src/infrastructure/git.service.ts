import simpleGit, { SimpleGit } from 'simple-git'
import * as fs from 'fs-extra'
import { IGitService } from '../domain/interfaces'
import { AppError, ErrorCode } from '../common/errors'

export class GitService implements IGitService {
  private git?: SimpleGit
  private projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  private getGit(): SimpleGit {
    if (!this.git) {
      this.git = simpleGit(this.projectRoot)
    }
    return this.git
  }

  async isGitProject(): Promise<boolean> {
    try {
      // 先判断目录是否存在
      if (!(await fs.pathExists(this.projectRoot))) {
        return false
      }
      return await this.getGit().checkIsRepo()
    } catch {
      return false
    }
  }

  async getCurrentCommit(): Promise<string> {
    // 重试3次，避免Windows下git命令偶发失败
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.getGit().revparse(['HEAD'])
      } catch (e) {
        if (i === maxRetries - 1) {
          throw new AppError(ErrorCode.GIT_OPERATION_FAILED, 'Failed to get current commit', e)
        }
        await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
      }
    }
    throw new AppError(ErrorCode.GIT_OPERATION_FAILED, 'Failed to get current commit')
  }

  async getCurrentBranch(): Promise<string> {
    try {
      return await this.getGit().revparse(['--abbrev-ref', 'HEAD'])
    } catch (e) {
      throw new AppError(ErrorCode.GIT_OPERATION_FAILED, 'Failed to get current branch', e)
    }
  }

  async getProjectSlug(): Promise<string> {
    try {
      // 尝试从remote url获取slug
      const remoteUrl = (await this.getGit().remote(['get-url', 'origin'])) as string
      const match = remoteUrl?.match(/[:/]([^/]+\/[^/.]+)(\.git)?$/)
      if (match) {
        return match[1]
      }
    } catch (e) {
      // 没有remote的情况，使用目录名作为slug
      const path = require('path')
      const crypto = require('crypto')
      const dirName = path.basename(this.projectRoot)
      const hash = crypto.createHash('md5').update(this.projectRoot).digest('hex').slice(0, 8)
      return `${dirName}-${hash}`
    }
    // 无法解析remote的情况，同样使用目录名加hash
    const path = require('path')
    const crypto = require('crypto')
    const dirName = path.basename(this.projectRoot)
    const hash = crypto.createHash('md5').update(this.projectRoot).digest('hex').slice(0, 8)
    return `${dirName}-${hash}`
  }

  async getUncommittedChanges(): Promise<string[]> {
    try {
      const status = await this.getGit().status()
      return status.files.map(f => f.path)
    } catch (e) {
      throw new AppError(ErrorCode.GIT_OPERATION_FAILED, 'Failed to get uncommitted changes', e)
    }
  }

  async diffCommits(commit1: string, commit2: string): Promise<string[]> {
    try {
      const diff = await this.getGit().diff([`${commit1}..${commit2}`, '--name-only'])
      return diff.split('\n').filter(Boolean)
    } catch (e) {
      throw new AppError(ErrorCode.GIT_OPERATION_FAILED, 'Failed to diff commits', e)
    }
  }

  async getFileLastCommit(projectRoot: string, filePath: string): Promise<string | null> {
    try {
      const git = this.getGit()
      const relPath = filePath
      const log = await git.raw(['log', '-n', '1', '--pretty=format:%H', '--', relPath])
      const trimmed = (log || '').trim()
      return trimmed || null
    } catch {
      return null
    }
  }

  async isFileDirty(projectRoot: string, filePath: string): Promise<boolean> {
    try {
      const git = this.getGit()
      const status = await git.status()
      return status.files.some(f => f.path === filePath)
    } catch {
      // git 不可用时视为非 dirty，交由上层按非 git 场景处理
      return false
    }
  }
}