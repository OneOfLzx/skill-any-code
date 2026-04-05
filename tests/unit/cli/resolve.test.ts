/**
 * V2.3 CLI resolve 子命令单元测试（基于 IndexService 的查询逻辑与路径规范化）
 * 对应测试文档 10.4.2：UT-V23-RESOLVE-001 ~ UT-V23-RESOLVE-010
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { IndexService } from '../../../src/infrastructure/index.service';
import { getStoragePath } from '../../../src/common/utils';
import { mkdtemp } from '../../utils/create-test-project';

const indexService = new IndexService();

// V2.6 起 CLI resolve 不再依赖 IndexService/analysis-index.json，保留历史用例但默认跳过
// eslint-disable-next-line jest/no-disabled-tests
describe.skip('CLI resolve 子命令逻辑 (V23-RESOLVE)', () => {
  let testProjectDir: string;
  let storageRoot: string;

  beforeEach(async () => {
    testProjectDir = mkdtemp('skill-any-code-resolve');
    storageRoot = getStoragePath(testProjectDir, './.skill-any-code-result');
    await fs.ensureDir(storageRoot);
  });

  afterEach(async () => {
    await fs.remove(testProjectDir).catch(() => {});
  });

  it('UT-V23-RESOLVE-001: 查询已解析文件应返回对应 Markdown 绝对路径', async () => {
    const srcFile = path.join(testProjectDir, 'src', 'index.ts');
    const resultMd = path.join(storageRoot, 'src', 'index.md');
    await fs.ensureDir(path.dirname(resultMd));
    await fs.writeFile(resultMd, '# index', 'utf-8');

    await indexService.buildIndex(
      testProjectDir,
      storageRoot,
      [{ sourcePath: srcFile, resultPath: resultMd }],
      []
    );

    const resolved = await indexService.resolve(storageRoot, srcFile);
    expect(resolved).not.toBeNull();
    expect(resolved).toMatch(/\.md$/);
    expect(await fs.pathExists(resolved!.replace(/\//g, path.sep))).toBe(true);
  });

  it('UT-V23-RESOLVE-002: 查询已解析目录应返回 index.md 路径', async () => {
    const srcDir = path.join(testProjectDir, 'src', 'services');
    const resultMd = path.join(storageRoot, 'src', 'services', 'index.md');
    await fs.ensureDir(path.dirname(resultMd));
    await fs.writeFile(resultMd, '# services', 'utf-8');

    await indexService.buildIndex(testProjectDir, storageRoot, [], [
      { sourcePath: srcDir, resultPath: resultMd },
    ]);

    const resolved = await indexService.resolve(storageRoot, srcDir);
    expect(resolved).not.toBeNull();
    expect(resolved).toMatch(/index\.md$/);
  });

  it('UT-V23-RESOLVE-003: 查询不存在的路径应返回 null（CLI 输出 N/A）', async () => {
    await indexService.buildIndex(testProjectDir, storageRoot, [], []);

    const resolved = await indexService.resolve(
      storageRoot,
      path.join(testProjectDir, 'src', 'nonexistent.ts')
    );
    expect(resolved).toBeNull();
  });

  it('UT-V23-RESOLVE-005: 反斜杠输入应规范化为正斜杠并匹配', async () => {
    const srcFile = path.join(testProjectDir, 'src', 'index.ts');
    const resultMd = path.join(storageRoot, 'src', 'index.md');
    await fs.ensureDir(path.dirname(resultMd));
    await fs.writeFile(resultMd, '# index', 'utf-8');
    await indexService.buildIndex(testProjectDir, storageRoot, [
      { sourcePath: srcFile, resultPath: resultMd },
    ], []);

    const withBackslash = srcFile.split(path.sep).join(path.sep === '/' ? '\\' : path.sep);
    const resolved = await indexService.resolve(storageRoot, withBackslash);
    expect(resolved).not.toBeNull();
    expect(resolved).toMatch(/\.md$/);
  });

  it('UT-V23-RESOLVE-006: 尾部斜杠应被移除并匹配', async () => {
    const srcDir = path.join(testProjectDir, 'src');
    const resultMd = path.join(storageRoot, 'src', 'index.md');
    await fs.ensureDir(path.dirname(resultMd));
    await fs.writeFile(resultMd, '# src', 'utf-8');
    await indexService.buildIndex(testProjectDir, storageRoot, [], [
      { sourcePath: srcDir, resultPath: resultMd },
    ]);

    const withTrailingSlash = srcDir + path.sep;
    const resolved = await indexService.resolve(storageRoot, withTrailingSlash);
    expect(resolved).not.toBeNull();
  });

  it('UT-V23-INDEX-004: 索引不存在时 resolve 返回 null', async () => {
    const resolved = await indexService.resolve(storageRoot, path.join(testProjectDir, 'any.ts'));
    expect(resolved).toBeNull();
  });
});
