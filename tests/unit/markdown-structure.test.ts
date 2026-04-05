/**
 * 测试文档第 13 章：Markdown 结果结构一致性测试
 * 13.2 文件级 Markdown 结构测试
 * UT-FILE-MD-STRUCT-001：文件章节白名单
 * UT-FILE-MD-STRUCT-002：类定义章节唯一性
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { LocalStorageService } from '../../src/infrastructure/storage.service';
import type { FileAnalysis } from '../../src/common/types';

function mkdtemp(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/** 当前实现约定的文件级 Markdown 二级标题白名单（与 storage.service 生成一致） */
const FILE_HEADING_WHITELIST = new Set([
  'Basic Information',
  'Summary',
  'Description',
  'Classes',
  'Global Functions',
]);

/** 从 Markdown 中提取所有二级标题（## 标题） */
function extractH2Headings(md: string): string[] {
  const re = /^##\s+(.+)$/gm;
  const headings: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    headings.push(m[1].trim());
  }
  return headings;
}

/** 统计某标题在 Markdown 中出现的次数 */
function countHeading(md: string, heading: string): number {
  const re = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, 'gm');
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) count++;
  return count;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 提取 [类定义] 章节到下一个 ## 标题之间的内容，统计 ### 类名 条目数 */
function countClassEntriesInMarkdown(md: string): number {
  const re = /^###\s+\S+/gm;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) count++;
  return count;
}

describe('13.2 文件级 Markdown 结构 (UT-FILE-MD-STRUCT)', () => {
  let testDir: string;
  let storage: LocalStorageService;

  beforeEach(() => {
    testDir = mkdtemp('md-struct');
    storage = new LocalStorageService(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir).catch(() => {});
  });

  /**
   * UT-FILE-MD-STRUCT-001：文件级 Markdown 的一级（章节）标题只允许出现在预定义白名单中。
   * 当前实现使用 ## 作为章节标题，提取后与白名单比较。
   */
  it('UT-FILE-MD-STRUCT-001: 文件章节白名单，不允许出现未定义章节', async () => {
    const filePath = 'src/foo.ts';
    const data: FileAnalysis = {
      type: 'file',
      path: filePath,
      name: 'foo.ts',
      language: 'TypeScript',
      linesOfCode: 10,
      dependencies: [],
      summary: 'summary',
      classes: [],
      functions: [],
      lastAnalyzedAt: new Date().toISOString(),
      commitHash: 'abc',
    };

    await storage.saveFileAnalysis('test-slug', filePath, data);

    const storageRoot = path.join(testDir, '.skill-any-code-result');
    const outputPath = path.join(storageRoot, 'src', 'foo.ts.md');
    expect(await fs.pathExists(outputPath)).toBe(true);

    const content = await fs.readFile(outputPath, 'utf-8');
    const actualHeadings = extractH2Headings(content);
    const allowedHeadings = FILE_HEADING_WHITELIST;
    const unexpectedHeadings = actualHeadings.filter((h) => !allowedHeadings.has(h));

    expect(unexpectedHeadings).toEqual([]);
    expect(actualHeadings.every((h) => allowedHeadings.has(h))).toBe(true);
  });

  /**
   * UT-FILE-MD-STRUCT-002：单个文件内 [类定义] 章节只能出现一次，类条目数量与 JSON classes.length 一致。
   */
  it('UT-FILE-MD-STRUCT-002: 类定义章节唯一性，且类条目数与 JSON 一致', async () => {
    const filePath = 'src/bar.ts';
    const classes = [
      {
        name: 'A',
        extends: undefined,
        implements: [],
        methods: [{ name: 'm', signature: 'm()', description: 'd', visibility: 'public' as const }],
        properties: [],
      },
      {
        name: 'B',
        extends: 'A',
        implements: [],
        methods: [],
        properties: [{ name: 'p', type: 'string', description: 'p', visibility: 'public' as const }],
      },
    ];
    const data: FileAnalysis = {
      type: 'file',
      path: filePath,
      name: 'bar.ts',
      language: 'TypeScript',
      linesOfCode: 20,
      dependencies: [],
      summary: 'summary',
      classes,
      functions: [],
      lastAnalyzedAt: new Date().toISOString(),
      commitHash: 'abc',
    };

    await storage.saveFileAnalysis('test-slug', filePath, data);

    const storageRoot = path.join(testDir, '.skill-any-code-result');
    const outputPath = path.join(storageRoot, 'src', 'bar.ts.md');
    const content = await fs.readFile(outputPath, 'utf-8');

    const classDefCount = countHeading(content, 'Classes');
    expect(classDefCount).toBe(1);

    const markdownClassesCount = countClassEntriesInMarkdown(content);
    expect(markdownClassesCount).toBe(data.classes.length);
  });
});
