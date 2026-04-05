/**
 * V2.3 集中式索引文件（analysis-index.json）单元测试
 * 对应测试文档 10.4.1：UT-V23-INDEX-001 ~ UT-V23-INDEX-010
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { IndexService } from '../../../src/infrastructure/index.service';
import { createTestProject, mkdtemp } from '../../utils/create-test-project';

const indexService = new IndexService();

describe('索引文件生成与解析 (V23-INDEX)', () => {
  // V2.6 起不再生成 analysis-index.json，保留历史用例但默认跳过
  // eslint-disable-next-line jest/no-disabled-tests
  describe.skip('V2.6: index 已废弃', () => {
  let testProjectDir: string;
  let resultDir: string;

  beforeEach(async () => {
    testProjectDir = mkdtemp('skill-any-code-index');
    resultDir = path.join(testProjectDir, '.skill-any-code-result');
    await fs.ensureDir(resultDir);
  });

  afterEach(async () => {
    await fs.remove(testProjectDir).catch(() => {});
  });

  it('UT-V23-INDEX-001/002: 全量解析后应生成合法索引且结构完整', async () => {
    await createTestProject(testProjectDir, {
      files: ['src/index.ts', 'src/utils/helper.ts', 'src/services/auth.ts'],
      directories: ['src', 'src/utils', 'src/services'],
    });

    const projectRoot = path.resolve(testProjectDir);
    const storageRoot = path.resolve(resultDir);
    const fileEntries = [
      { sourcePath: path.join(projectRoot, 'src/index.ts'), resultPath: path.join(storageRoot, 'src/index.ts.md') },
      { sourcePath: path.join(projectRoot, 'src/utils/helper.ts'), resultPath: path.join(storageRoot, 'src/utils/helper.ts.md') },
      { sourcePath: path.join(projectRoot, 'src/services/auth.ts'), resultPath: path.join(storageRoot, 'src/services/auth.ts.md') },
    ];
    const dirEntries = [
      { sourcePath: path.join(projectRoot, 'src'), resultPath: path.join(storageRoot, 'src/index.md') },
      { sourcePath: path.join(projectRoot, 'src/utils'), resultPath: path.join(storageRoot, 'src/utils/index.md') },
      { sourcePath: path.join(projectRoot, 'src/services'), resultPath: path.join(storageRoot, 'src/services/index.md') },
    ];

    await indexService.buildIndex(projectRoot, storageRoot, fileEntries, dirEntries);

    const indexPath = path.join(resultDir, 'analysis-index.json');
    expect(await fs.pathExists(indexPath)).toBe(true);

    const indexData = await fs.readJson(indexPath);
    expect(indexData).toHaveProperty('version');
    expect(indexData).toHaveProperty('projectRoot');
    expect(indexData).toHaveProperty('storageRoot');
    expect(indexData).toHaveProperty('generatedAt');
    expect(indexData).toHaveProperty('entries');
    expect(typeof indexData.entries).toBe('object');

    const entryCount = Object.keys(indexData.entries).length;
    expect(entryCount).toBe(fileEntries.length + dirEntries.length);

    for (const [sourcePath, entry] of Object.entries(indexData.entries)) {
      const e = entry as { resultPath: string; type: string };
      expect(e).toHaveProperty('resultPath');
      expect(e).toHaveProperty('type');
      expect(['file', 'directory']).toContain(e.type);
      expect(sourcePath).not.toContain('\\');
      expect(e.resultPath).not.toContain('\\');
    }
  });

  it('UT-V23-INDEX-003: 所有路径为绝对路径且使用正斜杠', async () => {
    const projectRoot = path.resolve(testProjectDir);
    const storageRoot = path.resolve(resultDir);
    await indexService.buildIndex(projectRoot, storageRoot, [
      { sourcePath: path.join(projectRoot, 'src/a.ts'), resultPath: path.join(storageRoot, 'src/a.ts.md') },
    ], []);

    const indexData = await indexService.readIndex(storageRoot);
    expect(indexData).not.toBeNull();
    expect(indexData!.projectRoot).not.toContain('\\');
    expect(indexData!.storageRoot).not.toContain('\\');
    if (indexData!.projectRoot.length > 1) {
      expect(indexData!.projectRoot.endsWith('/')).toBe(false);
    }
    for (const [k, v] of Object.entries(indexData!.entries)) {
      expect(k).not.toContain('\\');
      expect((v as { resultPath: string }).resultPath).not.toContain('\\');
    }
  });

  it('UT-V23-INDEX-002: generatedAt 为合法 ISO 8601', async () => {
    const projectRoot = path.resolve(testProjectDir);
    const storageRoot = path.resolve(resultDir);
    await indexService.buildIndex(projectRoot, storageRoot, [], []);

    const indexData = await indexService.readIndex(storageRoot);
    expect(indexData).not.toBeNull();
    expect(new Date(indexData!.generatedAt).toISOString()).toBe(indexData!.generatedAt);
  });

  it('UT-V23-RESOLVE: resolve 应返回已索引文件的 resultPath', async () => {
    const projectRoot = path.resolve(testProjectDir);
    const storageRoot = path.resolve(resultDir);
    const srcPath = path.join(projectRoot, 'src/index.ts');
    const resultPath = path.join(storageRoot, 'src/index.ts.md');
    await fs.ensureDir(path.dirname(resultPath));
    await fs.writeFile(resultPath, '# index', 'utf-8');
    await indexService.buildIndex(projectRoot, storageRoot, [
      { sourcePath: srcPath, resultPath },
    ], []);

    const normalizedSrc = srcPath.replace(/\\/g, '/');
    const resolved = await indexService.resolve(storageRoot, srcPath);
    expect(resolved).not.toBeNull();
    expect(resolved).toBe(resultPath.replace(/\\/g, '/'));

    const resolvedBackslash = await indexService.resolve(storageRoot, srcPath.replace(/\//g, '\\'));
    expect(resolvedBackslash).toBe(resolved);
  });

  it('UT-V23-RESOLVE-003: 查询不存在的路径应返回 null（调用方输出 N/A）', async () => {
    const projectRoot = path.resolve(testProjectDir);
    const storageRoot = path.resolve(resultDir);
    await indexService.buildIndex(projectRoot, storageRoot, [], []);

    const resolved = await indexService.resolve(storageRoot, path.join(projectRoot, 'src/nonexistent.ts'));
    expect(resolved).toBeNull();
  });

  it('UT-V23-INDEX-004/006: 增量 updateIndex 更新条目', async () => {
    const projectRoot = path.resolve(testProjectDir);
    const storageRoot = path.resolve(resultDir);
    await indexService.buildIndex(projectRoot, storageRoot, [
      { sourcePath: path.join(projectRoot, 'src/a.ts'), resultPath: path.join(storageRoot, 'src/a.ts.md') },
    ], []);

    await indexService.updateIndex(storageRoot, [
      { sourcePath: path.join(projectRoot, 'src/b.ts'), resultPath: path.join(storageRoot, 'src/b.ts.md'), type: 'file' },
    ], []);

    const indexData = await indexService.readIndex(storageRoot);
    expect(indexData).not.toBeNull();
    const keys = Object.keys(indexData!.entries);
    expect(keys.some(k => k.endsWith('b.ts'))).toBe(true);
  });

  it('UT-V23-INDEX-005: 增量 updateIndex 移除已删除文件条目', async () => {
    const projectRoot = path.resolve(testProjectDir);
    const storageRoot = path.resolve(resultDir);
    const aPath = path.join(projectRoot, 'src/a.ts');
    await indexService.buildIndex(projectRoot, storageRoot, [
      { sourcePath: aPath, resultPath: path.join(storageRoot, 'src/a.ts.md') },
    ], []);

    await indexService.updateIndex(storageRoot, [], [aPath]);

    const indexData = await indexService.readIndex(storageRoot);
    expect(indexData).not.toBeNull();
    const normalizedA = aPath.replace(/\\/g, '/');
    expect(indexData!.entries[normalizedA]).toBeUndefined();
  });

  it('UT-V23-INDEX-004: 索引不存在时 readIndex 返回 null', async () => {
    const read = await indexService.readIndex(resultDir);
    expect(read).toBeNull();
  });
  });
});
