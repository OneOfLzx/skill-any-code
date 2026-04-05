import * as crypto from 'crypto'
import * as path from 'path'
import { DEFAULT_OUTPUT_DIR } from './constants'

/**
 * 计算稳定的文本内容哈希（用于增量解析）。
 *
 * 注意：不同平台/工具链可能导致换行符为 LF/CRLF，从而让“内容未变更”的文件哈希不一致。
 * 这里统一将 CRLF 归一为 LF，并移除 UTF-8 BOM，以获得跨平台稳定的哈希。
 */
export function hashTextContent(content: string): string {
  const normalized = content
    // remove UTF-8 BOM
    .replace(/^\uFEFF/, '')
    // normalize newlines
    .replace(/\r\n/g, '\n')
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

/**
 * 规范化路径：统一使用正斜杠、移除尾部斜杠
 * 用于索引文件中的路径标准化和 resolve 查询时的路径匹配
 */
export function normalizePath(inputPath: string): string {
  let normalized = inputPath.replace(/\\/g, '/')
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

export function generateProjectSlug(projectRoot: string, isGit: boolean, gitSlug?: string): string {
  if (isGit && gitSlug) {
    return gitSlug.replace('/', '-')
  }
  const dirName = path.basename(projectRoot)
  const pathHash = crypto.createHash('md5').update(projectRoot).digest('hex').slice(0, 8)
  return `${dirName}-${pathHash}`
}

export function getStoragePath(projectRoot: string, customOutputDir?: string): string {
  const outputDir = customOutputDir || DEFAULT_OUTPUT_DIR
  // 如果是相对路径，相对于项目根目录
  if (!path.isAbsolute(outputDir)) {
    return path.resolve(projectRoot, outputDir)
  }
  return outputDir
}

export function getFileOutputPath(storageRoot: string, filePath: string): string {
  const parsed = path.parse(filePath)
  // 文件解析结果 Markdown：使用“完整文件名（含扩展名）+ .md”
  // 例如：src/app.ts -> src/app.ts.md
  return path.join(storageRoot, parsed.dir, `${parsed.base}.md`)
}

export function getDirOutputPath(storageRoot: string, dirPath: string): string {
  return path.join(storageRoot, dirPath, 'index.md')
}

/**
 * 受控并发执行：同时最多 limit 个 fn 在运行，所有 items 执行完毕后 resolve。
 */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const concurrency = Math.max(1, Number(limit) || 1)
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = nextIndex++
      if (idx >= items.length) return
      await fn(items[idx])
    }
  })
  await Promise.all(runners)
}

export function getLanguageFromExtension(ext: string): string {
  const map: Record<string, string> = {
    '.js': 'javascript',
    '.ts': 'typescript',
    '.jsx': 'javascript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.cpp': 'cpp',
    '.c': 'c',
    '.cs': 'csharp',
    '.php': 'php',
    '.rb': 'ruby',
    '.rs': 'rust'
  }
  return map[ext.toLowerCase()] || 'unknown'
}
