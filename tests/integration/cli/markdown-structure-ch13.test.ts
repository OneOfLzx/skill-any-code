/**
 * 测试文档第 13 章：Markdown 结果结构一致性测试（集成/系统）
 * 13.3 目录级 Markdown 功能描述测试：ST-DIR-MD-CONTENT-001
 * 13.4 文件/目录命名冲突测试：ST-PATH-CONFLICT-INDEX-001
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { startMockOpenAIServer } from '../../utils/mock-openai-server';
import { createTestConfigInDir } from '../../utils/test-config-helper';

const execAsync = promisify(exec);

function mkdtemp(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/** 功能描述最小长度（中文字符数） */
const MIN_DESCRIPTION_LENGTH = 30;

/** 匹配“仅统计句”：整段主要由“包含 N 个文件 / M 个子目录”构成则判为不合格 */
function isDescriptionStatOnly(description: string): boolean {
  const t = description.replace(/\s/g, ' ');
  return /^[^]*包含\s*\d+\s*个文件[^]*\d*\s*个子目录\s*$/.test(t) ||
    /^[^]*包含\s*\d+\s*个子目录[^]*\d*\s*个文件\s*$/.test(t);
}

describe('13.3 目录级 Markdown 功能描述 (ST-DIR-MD-CONTENT-001)', () => {
  let testDir: string;
  let tempHome: string;
  let mock: { baseUrl: string; close: () => Promise<void> };
  const repoRoot = path.join(__dirname, '../../..');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeAll(async () => {
    await execAsync('npm run build', { cwd: repoRoot });
  });

  beforeEach(async () => {
    testDir = mkdtemp('skill-any-code-dir-md');
    mock = await startMockOpenAIServer();
    tempHome = mkdtemp('sac-dir-md-home');
    await fs.ensureDir(tempHome);
    await createTestConfigInDir(tempHome, { llmBaseUrl: mock.baseUrl, llmApiKey: 'test', llmModel: 'mock' });
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterEach(async () => {
    if (mock) await mock.close();
    await fs.remove(testDir).catch(() => {});
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await fs.remove(tempHome).catch(() => {});
  });

  /**
   * ST-DIR-MD-CONTENT-001：目录 index.md 的 [功能描述] 必须为有实际信息量的自然语言描述，
   * 而不是单纯统计“有几个目录/文件”。
   * 前置：models/SenseVoiceSmall/example/index.py、helper.py，全量解析。
   */
  it('ST-DIR-MD-CONTENT-001: 目录功能描述内容质量，长度与关键词要求', async () => {
    const exampleDir = path.join(testDir, 'models', 'SenseVoiceSmall', 'example');
    await fs.ensureDir(exampleDir);
    await fs.writeFile(
      path.join(exampleDir, 'index.py'),
      '# SenseVoice 推理示例入口\nclass Demo: pass',
      'utf-8'
    );
    await fs.writeFile(
      path.join(exampleDir, 'helper.py'),
      '# 语音处理辅助\ndef load_model(): pass',
      'utf-8'
    );

    await execAsync(
      `node dist/cli.js --path "${testDir}" --mode full --no-skills --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome } }
    );

    const resultRoot = path.join(testDir, '.skill-any-code-result');
    const dirIndexPath = path.join(resultRoot, 'models/SenseVoiceSmall/example/index.md');
    expect(await fs.pathExists(dirIndexPath)).toBe(true);

    const content = await fs.readFile(dirIndexPath, 'utf-8');
    const funcDescMatch = content.match(/##\s*功能描述\s*\n([\s\S]*?)(?=\n##|$)/);
    const description = funcDescMatch ? funcDescMatch[1].trim() : '';

    const chineseLength = (description.match(/[\u4e00-\u9fa5]/g) || []).length;
    expect(chineseLength).toBeGreaterThanOrEqual(MIN_DESCRIPTION_LENGTH);

    const businessKeywords = ['SenseVoice', 'example', '语音', '推理', '示例', 'model', 'demo'];
    const hasKeyword = businessKeywords.some((k) => description.includes(k) || content.includes(k));
    expect(hasKeyword).toBe(true);

    expect(isDescriptionStatOnly(description)).toBe(false);
  }, 60000);
});

describe('13.4 文件/目录命名冲突 (ST-PATH-CONFLICT-INDEX-001)', () => {
  let testDir: string;
  let tempHome: string;
  let mock: { baseUrl: string; close: () => Promise<void> };
  const repoRoot = path.join(__dirname, '../../..');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeAll(async () => {
    await execAsync('npm run build', { cwd: repoRoot });
  });

  beforeEach(async () => {
    testDir = mkdtemp('skill-any-code-index-conflict');
    mock = await startMockOpenAIServer();
    tempHome = mkdtemp('sac-index-conflict-home');
    await fs.ensureDir(tempHome);
    await createTestConfigInDir(tempHome, { llmBaseUrl: mock.baseUrl, llmApiKey: 'test', llmModel: 'mock' });
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterEach(async () => {
    if (mock) await mock.close();
    await fs.remove(testDir).catch(() => {});
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await fs.remove(tempHome).catch(() => {});
  });

  /**
   * ST-PATH-CONFLICT-INDEX-001：当同级存在 index.xxx 源文件与同名目录时，
   * 文件结果与目录结果各有一个唯一的 Markdown 文件，互不覆盖。
   * 约定：目录结果 index.md，文件结果 index.py.md（文件结果名带原始后缀）。
   * 若当前实现尚未支持该命名策略，本用例会失败，需实现 getFileOutputPath 对 index.xxx 生成 index.xxx.md。
   */
  it('ST-PATH-CONFLICT-INDEX-001: index 文件与目录结果共存，互不覆盖', async () => {
    const coreDir = path.join(testDir, 'x', 'core');
    await fs.ensureDir(coreDir);
    await fs.ensureDir(path.join(coreDir, 'sub'));
    await fs.writeFile(path.join(coreDir, 'index.py'), '# core index\nclass Core: pass', 'utf-8');

    await execAsync(
      `node dist/cli.js --path "${testDir}" --mode full --no-skills --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome } }
    );

    const resultRoot = path.join(testDir, '.skill-any-code-result');
    const coreResultDir = path.join(resultRoot, 'x', 'core');

    const dirIndexPath = path.join(coreResultDir, 'index.md');
    const fileResultPath = path.join(coreResultDir, 'index.py.md');

    expect(await fs.pathExists(dirIndexPath)).toBe(true);
    expect(await fs.pathExists(fileResultPath)).toBe(true);

    // V2.6：不再生成 analysis-index.json，这里仅验证产物路径命名规则与存在性。
  }, 60000);
});
