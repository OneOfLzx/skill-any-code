/**
 * 创建最小化测试项目（用于 V2.2/V2.3 索引、resolve、Skill 等测试）
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface CreateTestProjectOptions {
  files?: string[];
  directories?: string[];
  /** 可选：在项目根写入 .skill-any-code-ignore 内容 */
  skillAnyCodeIgnore?: string;
  /** 可选：在项目根写入 .gitignore 内容 */
  gitignore?: string;
}

const DEFAULT_FILE_CONTENT = '// minimal content for test';

/**
 * 在指定目录下创建测试项目：创建目录结构并写入占位文件
 */
export async function createTestProject(
  projectDir: string,
  options: CreateTestProjectOptions = {}
): Promise<void> {
  const { files = [], directories = [], skillAnyCodeIgnore, gitignore } = options;
  await fs.ensureDir(projectDir);

  for (const dir of directories) {
    await fs.ensureDir(path.join(projectDir, dir));
  }

  for (const file of files) {
    const fullPath = path.join(projectDir, file);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, DEFAULT_FILE_CONTENT, 'utf-8');
  }

  if (skillAnyCodeIgnore !== undefined) {
    await fs.writeFile(path.join(projectDir, '.skill-any-code-ignore'), skillAnyCodeIgnore, 'utf-8');
  }

  if (gitignore !== undefined) {
    await fs.writeFile(path.join(projectDir, '.gitignore'), gitignore, 'utf-8');
  }
}

/**
 * 创建临时目录并返回路径，便于 afterEach 清理
 */
export function mkdtemp(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}
