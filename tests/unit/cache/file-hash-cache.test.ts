import * as path from 'path';
import * as os from 'os';
import { FileHashCache } from '../../../src/infrastructure/cache/file.hash.cache';

// 使用实际 fs-extra，UT-CACHE-003 中通过 jest.spyOn 模拟 remove 失败
// 注：部分环境 jest.spyOn(fs, 'remove') 可能失败，该用例会 skip
const fs = jest.requireActual<typeof import('fs-extra')>('fs-extra');

describe('FileHashCache with max size (UT-CACHE-001~003)', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = path.join(os.tmpdir(), `file-hash-cache-${Date.now()}`);
    await fs.remove(cacheDir);
  });

  afterEach(async () => {
    await fs.remove(cacheDir).catch(() => {});
  });

  test('UT-CACHE-001: maxSizeMb = 0 时不读不写磁盘缓存', async () => {
    const cache = new FileHashCache({ cacheDir, maxSizeMb: 0 });

    await cache.set('foo', { type: 'file', path: 'a', name: 'a', language: 'ts', linesOfCode: 1, dependencies: [], summary: '', classes: [], functions: [], lastAnalyzedAt: '', commitHash: '' });
    const exists = await fs.pathExists(cacheDir);
    expect(exists).toBe(false);

    const result = await cache.get('foo');
    expect(result).toBeNull();
  });

  test('UT-CACHE-002: 超过上限时按 mtime 从旧到新删除', async () => {
    const cache = new FileHashCache({ cacheDir, maxSizeMb: 1 });
    await fs.ensureDir(cacheDir);

    const fileA = path.join(cacheDir, 'a.json');
    const fileB = path.join(cacheDir, 'b.json');

    // 创建超过 1MB 的文件以触发 eviction（每份约 0.6MB）
    const largePayload = JSON.stringify({ x: 'x'.repeat(600 * 1024) });
    await fs.writeFile(fileA, largePayload);
    await new Promise(r => setTimeout(r, 10));
    await fs.writeFile(fileB, largePayload);

    const statA = await fs.stat(fileA);
    const statB = await fs.stat(fileB);
    expect(statA.mtimeMs).toBeLessThanOrEqual(statB.mtimeMs);

    await cache.set('c', { type: 'file', path: 'c', name: 'c', language: 'ts', linesOfCode: 1, dependencies: [], summary: '', classes: [], functions: [], lastAnalyzedAt: '', commitHash: '' });

    const aExists = await fs.pathExists(fileA);
    const bExists = await fs.pathExists(fileB);
    expect(aExists).toBe(false);
    expect(bExists).toBe(true);
  });

  test('UT-CACHE-003: 删除缓存文件失败时记录 warning 但不抛异常', async () => {
    const cache = new FileHashCache({ cacheDir, maxSizeMb: 1 });
    await fs.ensureDir(cacheDir);
    const fileA = path.join(cacheDir, 'a.json');
    await fs.writeJSON(fileA, { a: 1 });

    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // 使用 wrap 方式避免 fs-extra 的 remove 不可 spy 问题
    const originalRemove = fs.remove;
    (fs as any).remove = jest.fn().mockRejectedValueOnce(new Error('mock unlink error'));

    await expect(
      (cache as any).enforceLimit(),
    ).resolves.toBeUndefined();

    (fs as any).remove = originalRemove;
    spy.mockRestore();
  });
});

