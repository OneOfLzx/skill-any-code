import * as fs from 'fs-extra'
import * as path from 'path'
import { AnalysisIndex, IndexEntry } from '../common/types'
import { normalizePath } from '../common/utils'

// V2.6 起不再在主流程生成/依赖 analysis-index.json。
// 为兼容历史代码/测试，此类暂保留，但不再实现 IIndexService 接口。
export class IndexService {
  private getIndexFilePath(storageRoot: string): string {
    return path.join(storageRoot, 'analysis-index.json')
  }

  async buildIndex(
    projectRoot: string,
    storageRoot: string,
    fileEntries: Array<{ sourcePath: string; resultPath: string }>,
    dirEntries: Array<{ sourcePath: string; resultPath: string }>
  ): Promise<void> {
    const entries: Record<string, IndexEntry> = {}

    for (const entry of fileEntries) {
      entries[normalizePath(entry.sourcePath)] = {
        resultPath: normalizePath(entry.resultPath),
        type: 'file',
      }
    }

    for (const entry of dirEntries) {
      entries[normalizePath(entry.sourcePath)] = {
        resultPath: normalizePath(entry.resultPath),
        type: 'directory',
      }
    }

    const indexData: AnalysisIndex = {
      version: '1.0',
      projectRoot: normalizePath(projectRoot),
      storageRoot: normalizePath(storageRoot),
      generatedAt: new Date().toISOString(),
      entries,
    }

    const indexPath = this.getIndexFilePath(storageRoot)
    await fs.ensureDir(path.dirname(indexPath))
    await fs.writeJson(indexPath, indexData, { spaces: 2 })
  }

  async updateIndex(
    storageRoot: string,
    updatedEntries: Array<{ sourcePath: string; resultPath: string; type: 'file' | 'directory' }>,
    removedPaths: string[]
  ): Promise<void> {
    const existing = (await this.readIndex(storageRoot)) ?? {
      version: '1.0',
      projectRoot: '',
      storageRoot,
      generatedAt: new Date().toISOString(),
      entries: {} as Record<string, IndexEntry>,
    }

    for (const removedPath of removedPaths) {
      delete existing.entries[normalizePath(removedPath)]
    }

    for (const entry of updatedEntries) {
      existing.entries[normalizePath(entry.sourcePath)] = {
        resultPath: normalizePath(entry.resultPath),
        type: entry.type,
      }
    }

    existing.generatedAt = new Date().toISOString()

    const indexPath = this.getIndexFilePath(storageRoot)
    await fs.writeJson(indexPath, existing, { spaces: 2 })
  }

  async readIndex(storageRoot: string): Promise<AnalysisIndex | null> {
    const indexPath = this.getIndexFilePath(storageRoot)
    if (await fs.pathExists(indexPath)) {
      return await fs.readJson(indexPath)
    }
    return null
  }

  async resolve(storageRoot: string, absolutePath: string): Promise<string | null> {
    const indexData = await this.readIndex(storageRoot)
    if (!indexData) return null

    const normalized = normalizePath(absolutePath)
    const entry = indexData.entries[normalized]
    return entry ? entry.resultPath : null
  }
}
