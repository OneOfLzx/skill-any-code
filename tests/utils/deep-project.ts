import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export type CreateDeepProjectOptions = {
  depth: number;
  branching: number;
  filesPerDir: number;
  /**
   * 额外写入的文件扩展名，默认 .ts
   * 用于让解析目标更“真实”，但避免引入黑名单/复杂语言差异。
   */
  ext?: string;
};

export type DeepProjectStats = {
  dirCount: number;
  fileCount: number;
  allDirs: string[];
  allFiles: string[];
};

export function mkdtempProjectDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/**
 * 构造“深层 + 多分支”的临时项目目录结构。
 * 目标：在 5~10 层深度内生成 20~80 个文件，避免过慢。
 */
export async function createDeepProject(
  rootDir: string,
  options: CreateDeepProjectOptions,
): Promise<DeepProjectStats> {
  const { depth, branching, filesPerDir, ext = '.ts' } = options;
  if (depth < 1) throw new Error(`depth must be >= 1, got ${depth}`);
  if (branching < 1) throw new Error(`branching must be >= 1, got ${branching}`);
  if (filesPerDir < 0) throw new Error(`filesPerDir must be >= 0, got ${filesPerDir}`);

  await fs.ensureDir(rootDir);

  const allDirs: string[] = [];
  const allFiles: string[] = [];

  const writeFilesInDir = async (dir: string, level: number, branchPath: number[]) => {
    for (let i = 0; i < filesPerDir; i++) {
      const relName = `f_l${level}_b${branchPath.join('')}_i${i}${ext}`;
      const abs = path.join(dir, relName);
      await fs.writeFile(
        abs,
        [
          `export const level = ${level};`,
          `export const branch = "${branchPath.join('.') || 'root'}";`,
          `export const idx = ${i};`,
          `export function ping() { return "${level}-${i}"; }`,
          '',
        ].join(os.EOL),
        'utf-8',
      );
      allFiles.push(abs);
    }
  };

  const build = async (parent: string, level: number, branchPath: number[]) => {
    allDirs.push(parent);
    await writeFilesInDir(parent, level, branchPath);
    if (level >= depth) return;

    for (let b = 0; b < branching; b++) {
      const childRel = `d${level}_${b}`;
      const childAbs = path.join(parent, childRel);
      await fs.ensureDir(childAbs);
      await build(childAbs, level + 1, [...branchPath, b]);
    }
  };

  await build(rootDir, 1, []);

  return {
    dirCount: allDirs.length,
    fileCount: allFiles.length,
    allDirs,
    allFiles,
  };
}

