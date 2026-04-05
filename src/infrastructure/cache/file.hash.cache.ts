import { IAnalysisCache } from '../../domain/interfaces';
import { FileAnalysis } from '../../common/types';
import * as fs from 'fs-extra';
import * as path from 'path';
import { createHash } from 'crypto';
import { logger } from '../../common/logger';

interface FileHashCacheOptions {
  cacheDir: string;
  maxSizeMb: number; // 0 表示禁用（V2.5）
}

export class FileHashCache implements IAnalysisCache {
  private cacheDir: string;
  private maxSizeMb: number;

  constructor(options: FileHashCacheOptions) {
    this.cacheDir = options.cacheDir;
    this.maxSizeMb = options.maxSizeMb;
  }

  private async getDirSize(): Promise<number> {
    try {
      const files = await fs.readdir(this.cacheDir);
      let total = 0;
      for (const f of files) {
        const full = path.join(this.cacheDir, f);
        const stat = await fs.stat(full);
        if (stat.isFile()) {
          total += stat.size;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  private async enforceLimit(): Promise<void> {
    if (this.maxSizeMb <= 0) {
      return;
    }

    await fs.ensureDir(this.cacheDir);

    const maxBytes = this.maxSizeMb * 1024 * 1024;
    let total = await this.getDirSize();
    if (total <= maxBytes) return;

    const entries = await fs.readdir(this.cacheDir);
    const fileStats: { filePath: string; mtimeMs: number; size: number }[] = [];

    for (const name of entries) {
      const filePath = path.join(this.cacheDir, name);
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        fileStats.push({ filePath, mtimeMs: stat.mtimeMs, size: stat.size });
      }
    }

    fileStats.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const f of fileStats) {
      if (total <= maxBytes) break;
      try {
        await fs.remove(f.filePath);
        total -= f.size;
      } catch (e) {
        logger.warn(`Failed to delete cache file: ${f.filePath}`, e);
      }
    }
  }

  async get(fileHash: string): Promise<FileAnalysis | null> {
    if (this.maxSizeMb === 0) {
      return null;
    }
    const cachePath = path.join(this.cacheDir, `${fileHash}.json`);
    try {
      if (await fs.pathExists(cachePath)) {
        const data = await fs.readJSON(cachePath);
        return data as FileAnalysis;
      }
      return null;
    } catch {
      return null;
    }
  }

  async set(fileHash: string, result: FileAnalysis): Promise<void> {
    if (this.maxSizeMb === 0) {
      return;
    }

    try {
      await fs.ensureDir(this.cacheDir);
      await this.enforceLimit();

      const cachePath = path.join(this.cacheDir, `${fileHash}.json`);
      await fs.writeJSON(cachePath, result, { spaces: 2 });
    } catch (error) {
      // 缓存写入失败不影响主流程
      logger.warn('Failed to write cache:', error);
    }
  }

  async clear(fileHash?: string): Promise<void> {
    if (fileHash) {
      const cachePath = path.join(this.cacheDir, `${fileHash}.json`);
      await fs.remove(cachePath);
    } else {
      await fs.emptyDir(this.cacheDir);
    }
  }

  static calculateFileHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
