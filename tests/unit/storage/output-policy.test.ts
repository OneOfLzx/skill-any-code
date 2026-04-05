import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { LocalStorageService } from '../../../src/infrastructure/storage.service';
import { listAllFilesRecursively } from '../../utils/result-dir-whitelist';
import type { FileAnalysis, DirectoryAnalysis } from '../../../src/common/types';
import { getStoragePath } from '../../../src/common/utils';

function findJsonFiles(files: string[]): string[] {
  return files.filter((p) => (p.split('/').pop() || p).toLowerCase().endsWith('.json'));
}

describe('Unit: Storage 输出策略（结果目录不应出现 JSON）', () => {
  test('UT-STORAGE-OUTPUT-001: saveFileAnalysis/saveDirectoryAnalysis 不应输出任何 json（仅 md）', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sac-ut-storage-output-'));
    const outputDir = '.skill-any-code-result';

    try {
      const storage = new LocalStorageService(projectRoot, outputDir);

      const srcDir = path.join(projectRoot, 'src');
      await fs.ensureDir(srcDir);

      const fileAbsPath = path.join(srcDir, 'a.ts');
      const fileRelPath = path.relative(projectRoot, fileAbsPath).replace(/\\/g, '/');
      await fs.writeFile(fileAbsPath, 'export const a = 1;\n', 'utf-8');

      const fileAnalysis: FileAnalysis = {
        type: 'file',
        name: 'a.ts',
        path: fileRelPath,
        language: 'TypeScript',
        linesOfCode: 1,
        dependencies: [],
        summary: 'mock summary',
        description: 'mock description',
        classes: [],
        functions: [],
        lastAnalyzedAt: new Date().toISOString(),
        commitHash: 'N/A',
      };

      await storage.saveFileAnalysis('test-slug', fileRelPath, fileAnalysis);

      const dirAnalysis: DirectoryAnalysis = {
        type: 'directory',
        name: 'src',
        path: 'src',
        description: 'mock dir description',
        summary: 'mock dir summary',
        childrenDirsCount: 0,
        childrenFilesCount: 1,
        lastAnalyzedAt: new Date().toISOString(),
        commitHash: 'N/A',
        structure: [
          { type: 'file', name: 'a.ts', description: 'a' },
        ],
      };

      await storage.saveDirectoryAnalysis('test-slug', 'src', dirAnalysis);

      const storageRoot = getStoragePath(projectRoot, outputDir);
      const resultFiles = await listAllFilesRecursively(storageRoot);
      const jsons = findJsonFiles(resultFiles);
      expect(jsons).toEqual([]);
      // 至少有 md 产物
      expect(resultFiles.some((p) => p.toLowerCase().endsWith('.md'))).toBe(true);
    } finally {
      await fs.remove(projectRoot).catch(() => {});
    }
  });
});

