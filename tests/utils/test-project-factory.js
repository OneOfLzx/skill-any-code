"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestProjectFactory = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
/**
 * 创建测试项目工厂函数
 */
class TestProjectFactory {
    static tempDir = path.join(process.cwd(), 'tests/.temp-tests');
    /**
     * 初始化临时目录
     */
    static async init() {
        await fs.mkdir(this.tempDir, { recursive: true });
    }
    /**
     * 创建指定类型的测试项目
     */
    static async create(type, gitRepo = false) {
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
                await fs.rm(projectPath, { recursive: true, force: true });
            }
        };
    }
    /**
     * 创建小型测试项目（10个以内文件）
     */
    static async createSmallProject(projectPath) {
        // 创建src目录
        await fs.mkdir(path.join(projectPath, 'src'));
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
        await fs.mkdir(path.join(projectPath, 'src', 'utils'));
        await fs.writeFile(path.join(projectPath, 'src', 'utils', 'date.ts'), `
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
    `.trim());
        // 创建components/Button.tsx
        await fs.mkdir(path.join(projectPath, 'src', 'components'));
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
    static async createMediumProject(projectPath) {
        // 先创建小型项目基础
        let count = await this.createSmallProject(projectPath);
        // 新增更多文件
        const servicesDir = path.join(projectPath, 'src', 'services');
        await fs.mkdir(servicesDir);
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
    static async createLargeProject(projectPath) {
        let count = await this.createMediumProject(projectPath);
        // 新增1000个文件
        const modulesDir = path.join(projectPath, 'src', 'modules');
        await fs.mkdir(modulesDir);
        for (let i = 0; i < 1000; i++) {
            const modDir = path.join(modulesDir, `mod${i}`);
            await fs.mkdir(modDir);
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
    static async createExceptionProject(projectPath) {
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
    static async initGitRepo(projectPath) {
        await execAsync('git init', { cwd: projectPath });
        await execAsync('git config user.name "Test User"', { cwd: projectPath });
        await execAsync('git config user.email "test@example.com"', { cwd: projectPath });
        await execAsync('git add .', { cwd: projectPath });
        await execAsync('git commit -m "initial commit"', { cwd: projectPath });
    }
    /**
     * 清理所有临时测试项目
     */
    static async cleanupAll() {
        await fs.rm(this.tempDir, { recursive: true, force: true });
    }
}
exports.TestProjectFactory = TestProjectFactory;
// 全局初始化和清理
beforeAll(async () => {
    await TestProjectFactory.init();
});
afterAll(async () => {
    await TestProjectFactory.cleanupAll();
});
