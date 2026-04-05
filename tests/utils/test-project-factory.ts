import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type TestProjectType = 'small' | 'medium' | 'large' | 'exception' | 'empty';

export interface TestProject {
  path: string;
  slug: string;
  fileCount: number;
  gitRepo: boolean;
  cleanup: () => Promise<void>;
}

/**
 * 创建测试项目工厂函数
 */
export class TestProjectFactory {
  private static tempDir = path.join(os.tmpdir(), 'skill-any-code-tests');

  /**
   * 初始化临时目录
   */
  static async init() {
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  /**
   * 创建指定类型的测试项目
   */
  static async create(type: TestProjectType, gitRepo: boolean = false): Promise<TestProject> {
    const projectId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const projectPath = path.join(this.tempDir, projectId);
    await fs.mkdir(projectPath, { recursive: true });

    let fileCount = 0;

    switch (type) {
      case 'empty':
        fileCount = 0;
        break;
      case 'small':
        fileCount = await this.createSmallProject(projectPath);
        break;
      case 'medium':
        fileCount = await this.createMediumProject(projectPath);
        break;
      case 'large':
        fileCount = await this.createLargeProject(projectPath);
        break;
      case 'exception':
        fileCount = await this.createExceptionProject(projectPath);
        break;
    }

    if (gitRepo) {
      await this.initGitRepo(projectPath);
    }

    const slug = gitRepo 
      ? `test-owner-${projectId}` 
      : `${projectId}-${Buffer.from(projectPath).toString('base64').slice(0, 8)}`;

    return {
      path: projectPath,
      slug,
      fileCount,
      gitRepo,
      cleanup: async () => {
        // Windows系统下重试删除，避免EBUSY/ENOTEMPTY错误
        const maxRetries = 10;
        for (let i = 0; i < maxRetries; i++) {
          try {
            await fs.rm(projectPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
            return;
          } catch (e: any) {
            if (i === maxRetries - 1) {
              console.warn(`Failed to delete temp directory ${projectPath} after ${maxRetries} retries:`, e.message);
              // 最后一次失败不抛出错误，避免测试失败，临时目录会在全局清理时尝试删除
              return;
            }
            // 延迟重试，指数退避
            await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, i)));
          }
        }
      }
    };
  }

  /**
   * 创建小型测试项目（10个以内文件）
   */
  private static async createSmallProject(projectPath: string): Promise<number> {
    // 创建src目录
    await fs.mkdir(path.join(projectPath, 'src'), { recursive: true });
    
    // 创建index.ts
    await fs.writeFile(path.join(projectPath, 'src', 'index.ts'), `
export function add(a: number, b: number): number {
  return a + b;
}

export class Calculator {
  private value: number = 0;

  add(num: number): void {
    this.value += num;
  }

  getResult(): number {
    return this.value;
  }
}
    `.trim());

    // 创建utils/date.ts
    await fs.mkdir(path.join(projectPath, 'src', 'utils'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'src', 'utils', 'date.ts'), `
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
    `.trim());

    // 创建components/Button.tsx
    await fs.mkdir(path.join(projectPath, 'src', 'components'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'src', 'components', 'Button.tsx'), `
import React from 'react';

interface ButtonProps {
  text: string;
  onClick: () => void;
}

export const Button: React.FC<ButtonProps> = ({ text, onClick }) => {
  return <button onClick={onClick}>{text}</button>;
};
    `.trim());

    // 创建Python测试文件
    await fs.writeFile(path.join(projectPath, 'src', 'demo.py'), `
def hello(name: str) -> str:
    return f"Hello, {name}!"

class User:
    def __init__(self, id: int, name: str):
        self.id = id
        self.name = name
    
    def get_name(self) -> str:
        return self.name
    `.trim());

    // 创建.gitignore
    await fs.writeFile(path.join(projectPath, '.gitignore'), `
node_modules
.env
dist
    `.trim());

    // 创建package.json
    await fs.writeFile(path.join(projectPath, 'package.json'), `
{
  "name": "test-project",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.0.0"
  }
}
    `.trim());

    return 6;
  }

  /**
   * 创建中型测试项目
   */
  private static async createMediumProject(projectPath: string): Promise<number> {
    // 先创建小型项目基础
    let count = await this.createSmallProject(projectPath);

    // 新增更多文件
    const servicesDir = path.join(projectPath, 'src', 'services');
    await fs.mkdir(servicesDir, { recursive: true });

    for (let i = 0; i < 20; i++) {
      await fs.writeFile(path.join(servicesDir, `service${i}.ts`), `
export class Service${i} {
  execute(): string {
    return 'service${i} executed';
  }
}
      `.trim());
      count++;
    }

    return count;
  }

  /**
   * 创建大型测试项目
   */
  private static async createLargeProject(projectPath: string): Promise<number> {
    let count = await this.createMediumProject(projectPath);

    // 新增1000个文件
    const modulesDir = path.join(projectPath, 'src', 'modules');
    await fs.mkdir(modulesDir, { recursive: true });

    for (let i = 0; i < 1000; i++) {
      const modDir = path.join(modulesDir, `mod${i}`);
      await fs.mkdir(modDir, { recursive: true });
      await fs.writeFile(path.join(modDir, 'index.ts'), `
export const mod${i} = {
  name: 'mod${i}',
  version: '1.0.0'
};
      `.trim());
      count++;
    }

    return count;
  }

  /**
   * 创建异常测试项目
   */
  private static async createExceptionProject(projectPath: string): Promise<number> {
    let count = await this.createSmallProject(projectPath);

    // 语法错误文件
    await fs.writeFile(path.join(projectPath, 'src', 'syntax-error.ts'), `
function broken() {
  return a + b // 缺少闭合括号
    `.trim());
    count++;

    // 超大文件（10MB）
    const largeContent = '// ' + 'x'.repeat(10 * 1024 * 1024 - 3);
    await fs.writeFile(path.join(projectPath, 'src', 'large-file.ts'), largeContent);
    count++;

    // 敏感文件
    await fs.writeFile(path.join(projectPath, '.env'), `
DB_PASSWORD=secret123
API_KEY=abcdef123456
    `.trim());
    count++;

    await fs.writeFile(path.join(projectPath, 'credentials.json'), `
{
  "username": "admin",
  "password": "admin123"
}
    `.trim());
    count++;

    return count;
  }

  /**
   * 初始化Git仓库
   */
  private static async initGitRepo(projectPath: string): Promise<void> {
    await execAsync('git init', { cwd: projectPath });
    await execAsync('git config user.name "Test User"', { cwd: projectPath });
    await execAsync('git config user.email "test@example.com"', { cwd: projectPath });
    await execAsync('git add .', { cwd: projectPath });
    await execAsync('git commit -m "initial commit"', { cwd: projectPath });
    // 等待git操作完成，Windows下文件系统同步需要时间
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * 清理所有临时测试项目
   */
  static async cleanupAll(): Promise<void> {
    // Windows系统下重试删除，避免EBUSY错误
    const maxRetries = 10;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await fs.rm(this.tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        return;
      } catch (e: any) {
        if (i === maxRetries - 1) {
          console.warn(`Failed to delete global temp directory ${this.tempDir} after ${maxRetries} retries:`, e.message);
          return;
        }
        // 延迟重试，指数退避
        await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, i)));
      }
    }
  }
}

// 全局初始化和清理
beforeAll(async () => {
  await TestProjectFactory.init();
});

afterAll(async () => {
  // 注意：Jest 默认并行运行测试文件。若在此处全局清理，会导致其它测试文件中仍在使用的
  // 临时项目目录被提前删除，从而产生 ENOENT / "not in a git directory" 等偶发失败。
  // 各用例应通过返回的 project.cleanup() 自行清理；需要全局清理时可在 CI 收尾阶段执行。
});
