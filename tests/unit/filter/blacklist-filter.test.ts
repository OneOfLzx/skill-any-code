/**
 * V2.3 黑名单过滤规则重构单元测试
 * 对应测试文档 10.4.5：UT-V23-BL-001 ~ UT-V23-BL-016
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { BlacklistService } from '../../../src/infrastructure/blacklist.service';

describe('黑名单过滤 (V23-BL)', () => {
  let testProjectDir: string;

  beforeEach(async () => {
    testProjectDir = path.join(os.tmpdir(), `blacklist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.ensureDir(testProjectDir);
  });

  afterEach(async () => {
    await fs.remove(testProjectDir).catch(() => {});
  });

  it('UT-V23-BL-001: 全局黑名单过滤生效', async () => {
    const service = new BlacklistService();
    await service.load(['*.md', '*.yml'], testProjectDir);

    expect(service.isIgnored('README.md')).toBe(true);
    expect(service.isIgnored('config.yml')).toBe(true);
    expect(service.isIgnored('src/index.ts')).toBe(false);
  });

  it('UT-V23-BL-002: 项目级 .skill-any-code-ignore 过滤生效', async () => {
    await fs.writeFile(path.join(testProjectDir, '.skill-any-code-ignore'), 'jest.config.*\n', 'utf-8');
    const service = new BlacklistService();
    await service.load([], testProjectDir);

    expect(service.isIgnored('jest.config.ts')).toBe(true);
    expect(service.isIgnored('src/app.ts')).toBe(false);
  });

  it('UT-V23-BL-003: .gitignore 作为第三层过滤', async () => {
    await fs.writeFile(path.join(testProjectDir, '.gitignore'), 'node_modules/\ndist/\n', 'utf-8');
    const service = new BlacklistService();
    await service.load([], testProjectDir);

    expect(service.isIgnored('node_modules/foo')).toBe(true);
    expect(service.isIgnored('dist/bundle.js')).toBe(true);
    expect(service.isIgnored('src/index.ts')).toBe(false);
  });

  it('UT-V23-BL-004: 项目级否定模式覆盖全局规则', async () => {
    await fs.writeFile(path.join(testProjectDir, '.skill-any-code-ignore'), '!tsconfig.json\n', 'utf-8');
    const service = new BlacklistService();
    await service.load(['*.json'], testProjectDir);

    expect(service.isIgnored('package.json')).toBe(true);
    expect(service.isIgnored('tsconfig.json')).toBe(false);
    expect(service.isIgnored('src/data.json')).toBe(true);
  });

  it('UT-V23-BL-007: .skill-any-code-ignore 不存在时正常运行', async () => {
    const service = new BlacklistService();
    await service.load(['*.log'], testProjectDir);
    expect(service.isIgnored('app.log')).toBe(true);
  });

  it('UT-V23-BL-008: .gitignore 不存在时正常运行', async () => {
    const service = new BlacklistService();
    await service.load(['*.tmp'], testProjectDir);
    expect(service.isIgnored('file.tmp')).toBe(true);
  });

  it('UT-V23-BL-014: 空黑名单时仅二进制等其它判定生效', async () => {
    const service = new BlacklistService();
    await service.load([], testProjectDir);
    expect(service.isIgnored('src/index.ts')).toBe(false);
    expect(service.isIgnored('README.md')).toBe(false);
  });

  it('UT-V23-BL-015: 注释行和空行被忽略', async () => {
    await fs.writeFile(
      path.join(testProjectDir, '.skill-any-code-ignore'),
      '# this is a comment\n\n*.tmp\n',
      'utf-8'
    );
    const service = new BlacklistService();
    await service.load([], testProjectDir);
    expect(service.isIgnored('file.tmp')).toBe(true);
    expect(service.isIgnored('file.ts')).toBe(false);
  });

  it('UT-V23-BL-WINPATH-001: Windows 分隔符路径仍能被黑名单过滤', async () => {
    const service = new BlacklistService();
    await service.load(['.skill-any-code-result/'], testProjectDir);

    expect(service.isIgnored('.skill-any-code-result\\index.md')).toBe(true);
    expect(service.isIgnored('src\\index.ts')).toBe(false);
  });

  /**
   * 测试文档 14.3 根因：path.relative 在部分 Windows 场景下可能返回 "./" 或 ".\" 前缀，
   * 归一化后 ignore 库会拒绝并抛错。本用例验证路径归一化后仍能正确匹配。
   */
  it('UT-V23-BL-PREFIX-001: ./ 或 / 前缀路径归一化后仍被黑名单过滤', async () => {
    const service = new BlacklistService();
    await service.load(['.skill-any-code-result/'], testProjectDir);

    expect(service.isIgnored('./.skill-any-code-result/')).toBe(true);
    expect(service.isIgnored('./.skill-any-code-result/index.md')).toBe(true);
    expect(service.isIgnored('/.skill-any-code-result/index.md')).toBe(true);
    expect(service.isIgnored('.\\.skill-any-code-result\\index.md')).toBe(true);
    expect(service.isIgnored('./src/index.ts')).toBe(false);
  });

  /**
   * 测试文档 14 根因分析延伸：.gitignore 否定规则会覆盖全局黑名单。
   * 若用户项目 .gitignore 含 !*.md 等，可能使 .skill-any-code-result 内文件被解析。
   */
  it('UT-V23-BL-NEGATE-001: .gitignore 否定规则不应覆盖 .skill-any-code-result 黑名单', async () => {
    await fs.writeFile(
      path.join(testProjectDir, '.gitignore'),
      '.skill-any-code-result/\n!*.md\n',
      'utf-8'
    );
    const service = new BlacklistService();
    await service.load(['.skill-any-code-result/'], testProjectDir);

    // .skill-any-code-result 由全局黑名单与 .gitignore 共同忽略，否定规则 !*.md 不应解禁其下的 .md
    expect(service.isIgnored('.skill-any-code-result/index.md')).toBe(true);
    expect(service.isIgnored('.skill-any-code-result/sub/readme.md')).toBe(true);
  });

  it('UT-BLACKLIST-IMG-002: .skill-any-code-ignore 中的 ! 规则可解封部分图片', async () => {
    await fs.writeFile(
      path.join(testProjectDir, '.skill-any-code-ignore'),
      '!assets/logo.png\n',
      'utf-8'
    );

    const service = new BlacklistService();
    await service.load(['*.png', '*.jpg'], testProjectDir);

    expect(service.isIgnored('assets/logo.png')).toBe(false);
    expect(service.isIgnored('assets/other.png')).toBe(true);
    expect(service.isIgnored('docs/readme.jpg')).toBe(true);
  });
});
