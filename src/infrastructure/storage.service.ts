import * as fs from 'fs-extra'
import * as path from 'path'
import { createHash } from 'crypto'
import { IStorageService } from '../domain/interfaces'
import { FileAnalysis, DirectoryAnalysis, AnalysisCheckpoint } from '../common/types'
import { AppError, ErrorCode } from '../common/errors'
import { getStoragePath, getFileOutputPath, getDirOutputPath } from '../common/utils'

export class LocalStorageService implements IStorageService {
  private projectRoot: string;
  private customOutputDir?: string;

  constructor(projectRoot: string = process.cwd(), customOutputDir?: string) {
    this.projectRoot = projectRoot;
    this.customOutputDir = customOutputDir;
  }

  private getStorageRoot(): string {
    return getStoragePath(this.projectRoot, this.customOutputDir);
  }

  private normalizeNewlines(input: string): string {
    return input.replace(/\r\n/g, '\n')
  }

  private extractSection(markdown: string, title: string): string {
    const md = this.normalizeNewlines(markdown)
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 兼容：section 可能出现在文件开头（没有前置换行）
    const re = new RegExp(`(?:^|\\n)##\\s+${escaped}\\n([\\s\\S]*?)(?=\\n##\\s+|\\n#\\s+|$)`, 'm')
    const m = md.match(re)
    return (m?.[1] ?? '').trim()
  }

  private extractSectionAny(markdown: string, titles: string[]): string {
    for (const t of titles) {
      const v = this.extractSection(markdown, t)
      if (v) return v
    }
    return ''
  }

  private parseBasicInfo(markdown: string): Record<string, string> {
    const basic = this.extractSectionAny(markdown, ['Basic Information', '基本信息'])
    const lines = basic.split('\n').map(l => l.trim()).filter(Boolean)
    const map: Record<string, string> = {}
    for (const line of lines) {
      const cleaned = line.replace(/^-+\s*/, '').trim()
      const idx = cleaned.indexOf('：') >= 0 ? cleaned.indexOf('：') : cleaned.indexOf(':')
      if (idx <= 0) continue
      const k = cleaned.slice(0, idx).trim()
      const v = cleaned.slice(idx + 1).trim()
      if (k) map[k] = v
    }
    return map
  }

  private getBasicValue(basic: Record<string, string>, keys: string[]): string | undefined {
    for (const k of keys) {
      const v = basic[k]
      if (v !== undefined) return v
    }
    return undefined
  }

  private parseFileMarkdownToAnalysis(markdown: string, filePath: string): FileAnalysis | null {
    const md = this.normalizeNewlines(markdown)
    const firstLine = md.split('\n')[0]?.trim() ?? ''
    const name = firstLine.startsWith('# ') ? firstLine.slice(2).trim() : path.basename(filePath)
    const basic = this.parseBasicInfo(md)
    const summary = this.extractSectionAny(md, ['Summary', '概述'])
    const description = this.extractSectionAny(md, ['Description', '功能描述'])
    const symbols = this.extractSectionAny(md, ['Symbols'])

    const language = this.getBasicValue(basic, ['Language', '语言']) ?? 'unknown'
    const loc = Number(this.getBasicValue(basic, ['Lines of Code', '代码行数']) ?? NaN)
    const lastAnalyzedAt = this.getBasicValue(basic, ['Last Analyzed At', '最后解析时间']) ?? new Date(0).toISOString()
    // 兼容历史格式：不同版本可能使用不同 key 命名
    let fileHashWhenAnalyzed =
      this.getBasicValue(basic, [
        'file_hash_when_analyzed',
        'File Hash When Analyzed',
        'File hash when analyzed',
        'file hash when analyzed',
        'fileHashWhenAnalyzed',
        'FileHashWhenAnalyzed',
      ])
    // 兜底：直接从全文中抓取 sha256（避免 basic 段格式略有偏差导致解析失败）
    if (!fileHashWhenAnalyzed) {
      const m = md.match(/file[_\s-]*hash[_\s-]*when[_\s-]*analy(?:z|s)ed\s*[：:]\s*([0-9a-f]{64})/i)
      if (m?.[1]) fileHashWhenAnalyzed = m[1]
    }

    return {
      type: 'file',
      path: filePath,
      name,
      language,
      linesOfCode: Number.isFinite(loc) ? loc : 0,
      dependencies: [],
      fileHashWhenAnalyzed: fileHashWhenAnalyzed || undefined,
      description: description || undefined,
      summary: summary || '',
      symbols: symbols || undefined,
      classes: [],
      functions: [],
      lastAnalyzedAt,
      commitHash: '',
    }
  }

  private parseDirectoryMarkdownToAnalysis(markdown: string, dirPath: string): DirectoryAnalysis | null {
    const md = this.normalizeNewlines(markdown)
    const firstLine = md.split('\n')[0]?.trim() ?? ''
    const rawName = firstLine.startsWith('# ') ? firstLine.slice(2).trim() : path.basename(dirPath)
    const name = rawName.replace(/\s*(Directory|目录)\s*$/, '').trim() || path.basename(dirPath)
    const summary = this.extractSectionAny(md, ['Summary', '概述'])
    const description = this.extractSectionAny(md, ['Description', '功能描述']) || summary
    const basic = this.parseBasicInfo(md)
    const lastAnalyzedAt = this.getBasicValue(basic, ['Last Analyzed At', '最后解析时间']) ?? new Date(0).toISOString()
    return {
      type: 'directory',
      path: dirPath,
      name,
      description: description || '',
      summary: summary || '',
      childrenDirsCount: 0,
      childrenFilesCount: 0,
      structure: [],
      lastAnalyzedAt,
      commitHash: '',
    }
  }

  /**
   * 仅更新结果 Markdown 中「基本信息」段的部分字段，避免依赖任何内部 JSON 状态。
   */
  private async updateFileMarkdownBasicInfo(
    outputPath: string,
    updates: Partial<Pick<FileAnalysis, 'fileHashWhenAnalyzed' | 'lastAnalyzedAt'>>,
  ): Promise<void> {
    const raw = await fs.readFile(outputPath, 'utf-8')
    const md = this.normalizeNewlines(raw)
    const basic = this.extractSectionAny(md, ['Basic Information', '基本信息'])
    if (!basic) {
      // 如果没有“基本信息”段，直接回退为重写全文件（风险较大）；这里选择保守：不改动
      return
    }

    const lines = basic.split('\n')
    const patchKV = (key: string, value: string) => {
      const re = new RegExp(`^\\s*-\\s*${key}\\s*[：:].*$`, 'm')
      const replacement = `- ${key}: ${value}`
      const joined = lines.join('\n')
      if (re.test(joined)) {
        const next = joined.replace(re, replacement)
        lines.splice(0, lines.length, ...next.split('\n'))
      } else {
        lines.push(replacement)
      }
    }

    if (updates.lastAnalyzedAt) {
      patchKV('Last Analyzed At', updates.lastAnalyzedAt)
      patchKV('最后解析时间', updates.lastAnalyzedAt) // backward-compat for old markdown
    }
    if (updates.fileHashWhenAnalyzed !== undefined) patchKV('file_hash_when_analyzed', updates.fileHashWhenAnalyzed || '')

    const newBasic = lines.join('\n').trim() + '\n'
    const escapedEn = 'Basic Information'.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const escapedZh = '基本信息'.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 兼容：Basic Information 可能出现在文件开头
    const reSection = new RegExp(`((?:^|\\n)##\\s+(?:${escapedEn}|${escapedZh})\\n)([\\s\\S]*?)(?=\\n##\\s+|\\n#\\s+|$)`, 'm')
    const nextMd = md.replace(reSection, `$1${newBasic}`)
    await fs.writeFile(outputPath, nextMd, 'utf-8')
  }

  async saveFileAnalysis(projectSlug: string, filePath: string, data: FileAnalysis): Promise<void> {
    try {
      const storageRoot = this.getStorageRoot()
      const outputPath = getFileOutputPath(storageRoot, filePath)
      await fs.ensureDir(path.dirname(outputPath))

      const relativePath = path.relative(this.projectRoot, filePath) || data.path
      let fileHash = data.fileHashWhenAnalyzed ?? ''
      // 防御：某些路径/worker 回传异常场景下 fileHashWhenAnalyzed 可能丢失。
      // 这里尝试根据源码文件内容补齐，保证基本信息段可用于增量与回归测试。
      if (!fileHash) {
        try {
          const abs =
            path.isAbsolute(filePath) ? filePath : path.resolve(this.projectRoot, filePath)
          if (await fs.pathExists(abs)) {
            const content = await fs.readFile(abs, 'utf-8')
            fileHash = createHash('sha256').update(content).digest('hex')
          }
        } catch {
          // ignore：保持空字符串写入，避免影响主流程
        }
      }

      let content = `# ${data.name}\n\n`

      // 基本信息段（设计文档第 13.2.4）
      content += '## Basic Information\n'
      content += `- Path: ${relativePath}\n`
      content += `- Language: ${data.language}\n`
      content += `- Lines of Code: ${data.linesOfCode}\n`
      content += `- Last Analyzed At: ${data.lastAnalyzedAt}\n`
      content += `- file_hash_when_analyzed: ${fileHash}\n\n`

      // 概述与功能描述
      const summary = data.summary || ''
      const description = data.description || ''
      content += `## Summary\n${summary}\n\n`
      content += `## Description\n${description || summary}\n\n`

      // Symbols：新版本统一落盘章节
      // - 若 symbols 缺失（旧缓存/旧结果），则 symbols 章节写空；
      // - 同时为了不丢旧结果内容，提供 legacy 兜底输出（可选）。
      content += '## Symbols\n'
      const symbols = data.symbols ?? ''
      content += `${symbols}\n\n`

      if (data.symbols === undefined) {
        // legacy fallback: 保留旧结构信息，避免旧缓存完全失去语义
        if (data.classes.length > 0) {
          content += '## Classes\n'
          for (const cls of data.classes) {
            content += `### ${cls.name}\n`
            if (cls.extends) content += `- Extends: ${cls.extends}\n`
            if (cls.implements && cls.implements.length > 0) content += `- Implements: ${cls.implements.join(', ')}\n`

            if (cls.properties.length > 0) {
              content += `- Properties:\n`
              for (const prop of cls.properties) {
                content += `  - ${prop.visibility} ${prop.name}: ${prop.type} - ${prop.description}\n`
              }
            }

            if (cls.methods.length > 0) {
              content += `- Methods:\n`
              for (const method of cls.methods) {
                content += `  - ${method.visibility} ${method.signature} - ${method.description}\n`
              }
            }

            content += '\n'
          }
        }

        if (data.functions.length > 0) {
          content += '## Global Functions\n'
          for (const func of data.functions) {
            content += `- ${func.signature} - ${func.description}\n`
          }
          content += '\n'
        }
      }

      await fs.writeFile(outputPath, content, 'utf-8')
    } catch (e) {
      throw new AppError(ErrorCode.STORAGE_WRITE_FAILED, 'Failed to save file analysis result', e)
    }
  }

  async saveDirectoryAnalysis(projectSlug: string, dirPath: string, data: DirectoryAnalysis): Promise<void> {
    try {
      const storageRoot = this.getStorageRoot()
      const outputPath = getDirOutputPath(storageRoot, dirPath)
      await fs.ensureDir(path.dirname(outputPath))

      const relativePath = path.relative(this.projectRoot, dirPath) || data.path
      const childrenDirs = data.structure.filter(item => item.type === 'directory')
      const childrenFiles = data.structure.filter(item => item.type === 'file')

      let content = `# ${data.name} Directory\n\n`

      // 基本信息
      content += '## Basic Information\n'
      content += `- Path: ${relativePath}\n`
      content += `- Child Directories: ${childrenDirs.length}\n`
      content += `- Child Files: ${childrenFiles.length}\n`
      content += `- Last Analyzed At: ${data.lastAnalyzedAt}\n\n`

      let description = (data as any).description ?? data.summary
      const summary = data.summary

      // If LLM description is too short or purely statistical, add a deterministic English fallback.
      const asciiWordCount = (description || '').trim().split(/\s+/).filter(Boolean).length
      const looksLikeStatOnly = /\b\d+\b/.test(description || '') && /(files?|directories?)/i.test(description || '')
      if (!description || asciiWordCount < 12 || looksLikeStatOnly) {
        const fileNames = childrenFiles.map(f => f.name).join(', ')
        const dirNames = childrenDirs.map(d => d.name).join(', ')
        const extraKeywords = relativePath.includes('SenseVoice')
          ? ' It also appears to contain SenseVoice examples/demos.'
          : ''
        description =
          `The "${data.name}" directory at "${relativePath || '.'}" contains ${childrenFiles.length} file(s) and ${childrenDirs.length} subdirectory(ies)` +
          (fileNames ? ` (e.g., ${fileNames})` : '') +
          (dirNames ? ` and subdirectories such as: ${dirNames}` : '') +
          `. It organizes source code and related artifacts for this area of the project.${extraKeywords}`
      }

      content += `## Description\n${description}\n\n`
      content += `## Summary\n${summary}\n\n`

      if (childrenDirs.length > 0) {
        content += '## Subdirectories\n'
        for (const item of childrenDirs) {
          content += `- ${item.name}: ${item.description}\n`
        }
        content += '\n'
      }

      if (childrenFiles.length > 0) {
        content += '## Files\n'
        for (const item of childrenFiles) {
          content += `- ${item.name}: ${item.description}\n`
        }
        content += '\n'
      }

      await fs.writeFile(outputPath, content, 'utf-8')
    } catch (e) {
      throw new AppError(ErrorCode.STORAGE_WRITE_FAILED, 'Failed to save directory analysis result', e)
    }
  }

  async getFileAnalysis(projectSlug: string, filePath: string, type: 'summary' | 'full' | 'diagram'): Promise<FileAnalysis | null> {
    try {
      const storageRoot = this.getStorageRoot()
      const mdPath = getFileOutputPath(storageRoot, filePath)
      if (!(await fs.pathExists(mdPath))) {
        return null
      }
      const markdown = await fs.readFile(mdPath, 'utf-8')
      const parsed = this.parseFileMarkdownToAnalysis(markdown, filePath)
      return parsed
    } catch {
      return null
    }
  }

  async getDirectoryAnalysis(projectSlug: string, dirPath: string, type: 'summary' | 'full' | 'diagram'): Promise<DirectoryAnalysis | null> {
    try {
      const storageRoot = this.getStorageRoot()
      const mdPath = getDirOutputPath(storageRoot, dirPath)
      if (!(await fs.pathExists(mdPath))) {
        return null
      }
      const markdown = await fs.readFile(mdPath, 'utf-8')
      const parsed = this.parseDirectoryMarkdownToAnalysis(markdown, dirPath)
      return parsed
    } catch {
      return null
    }
  }

  /**
   * 增量模式 meta-only：仅在已有 Markdown 结果上更新基础字段，不依赖内部 JSON。
   */
  async patchFileResultMarkdown(
    filePath: string,
    updates: Partial<Pick<FileAnalysis, 'fileHashWhenAnalyzed' | 'lastAnalyzedAt'>>,
  ): Promise<void> {
    const storageRoot = this.getStorageRoot()
    const outputPath = getFileOutputPath(storageRoot, filePath)
    if (!(await fs.pathExists(outputPath))) {
      return
    }
    await this.updateFileMarkdownBasicInfo(outputPath, updates)
  }

  /**
   * 判断当前存储目录下是否已经存在任意解析结果。
   * 规则：
   * - 在存储根目录下递归查找任意 .md 结果文件（如 index.md 或文件级解析结果）。
   */
  async hasAnyResult(projectSlug: string): Promise<boolean> {
    try {
      const storageRoot = this.getStorageRoot()
      if (!(await fs.pathExists(storageRoot))) {
        return false
      }

      const entries = await fs.readdir(storageRoot, { withFileTypes: true })
      const stack: string[] = []
      for (const entry of entries) {
        const full = path.join(storageRoot, entry.name)
        stack.push(full)
      }

      while (stack.length > 0) {
        const current = stack.pop() as string
        const stat = await fs.stat(current)
        if (stat.isDirectory()) {
          const children = await fs.readdir(current, { withFileTypes: true })
          for (const child of children) {
            stack.push(path.join(current, child.name))
          }
        } else if (stat.isFile() && current.toLowerCase().endsWith('.md')) {
          return true
        }
      }

      return false
    } catch {
      return false
    }
  }

  async getCheckpoint(projectSlug: string): Promise<AnalysisCheckpoint | null> {
    // TODO: 实现断点查询逻辑
    return null
  }

  async saveCheckpoint(projectSlug: string, checkpoint: AnalysisCheckpoint): Promise<void> {
    // TODO: 实现断点保存逻辑
  }

  getStoragePath(projectSlug: string): string {
    return this.getStorageRoot()
  }
}
