import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * 递归列出目录下所有文件，返回相对路径（使用 POSIX 分隔符）。
 */
export async function listAllFilesRecursively(rootDir: string): Promise<string[]> {
  const result: string[] = [];

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
        result.push(rel);
      }
    }
  }

  const exists = await fs.pathExists(rootDir);
  if (!exists) {
    return [];
  }

  await walk(rootDir);
  return result;
}

/**
 * 结果目录白名单契约断言：
 * - 普通文件后缀必须为 .md
 * - 不允许任何 JSON（V2.6 起不再生成 .analysis_metadata.json / analysis-index.json）
 *
 * 若存在违规文件，将抛出错误并输出前若干个违规路径，驱动后续实现修复。
 */
export function assertOnlyAllowedResultFiles(files: string[]): void {
  const violations: string[] = [];

  for (const rel of files) {
    const base = rel.split('/').pop() || rel;

    if (base.endsWith('.json')) {
      violations.push(rel);
      continue;
    }

    if (!base.endsWith('.md')) {
      violations.push(rel);
    }
  }

  if (violations.length > 0) {
    const previewCount = Math.min(violations.length, 20);
    const preview = violations.slice(0, previewCount).join('\n  - ');
    throw new Error(
      `结果目录存在不符合白名单契约的文件（共 ${violations.length} 个，前 ${previewCount} 个如下）：\n  - ${preview}`,
    );
  }
}

