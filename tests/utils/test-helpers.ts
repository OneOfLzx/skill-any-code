import { z, ZodIssue } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { stat } from 'fs/promises';
import { 
  AnalyzeProjectCommandParams, 
  AnalyzeProjectCommandResult
} from '../../src/common/types';
import { AnalyzeProjectCommandSchema, ProjectCodeQuerySkillSchema, type ProjectCodeQuerySkillParams } from '../../src/adapters/command.schemas';

// V2.3 query 已废弃，Skill  mock 返回类型仅用于 command 等历史测试
export interface ProjectCodeQuerySkillResult {
  success: boolean;
  code: number;
  message: string;
  data?: unknown;
  errors?: Array<{ path: string; message: string }>;
}

// 加载测试用LLM配置
beforeAll(async () => {
  try {
    const apiKeyPath = path.join(process.cwd(), 'tests', 'priv_data', 'api_key.txt');
    const content = await fs.readFile(apiKeyPath, 'utf-8');
    const llmConfig: Record<string, string> = {};
    
    content.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;
      
      const colonIndex = trimmedLine.indexOf(':');
      if (colonIndex === -1) return;
      
      const key = trimmedLine.slice(0, colonIndex).trim().replace(/^"|"$/g, '');
      const value = trimmedLine.slice(colonIndex + 1).trim().replace(/^"|"$/g, '');
      
      llmConfig[key] = value;
    });
    
    if (llmConfig.baseURL) process.env.SKILL_ANY_CODE_LLM_BASE_URL = llmConfig.baseURL;
    if (llmConfig.apiKey) process.env.SKILL_ANY_CODE_LLM_API_KEY = llmConfig.apiKey;
    if (llmConfig.model) process.env.SKILL_ANY_CODE_LLM_MODEL = llmConfig.model;
   } catch (error) {
     console.warn('Failed to load LLM config from priv_data, tests may fail:', error);
   }
 });

/**
 * 调用命令接口（Mock实现，用于单元测试）
 */
export async function invokeCommand(
  command: string,
  params: AnalyzeProjectCommandParams
): Promise<AnalyzeProjectCommandResult> {
  if (command === '/analyze-project') {
    // 参数校验
    const validation = AnalyzeProjectCommandSchema.safeParse(params);
    if (!validation.success) {
      return {
        success: false,
        code: 4000,
        message: '参数校验失败',
        errors: validation.error.issues.map((issue: ZodIssue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      };
    }

    // 模拟路径不存在场景
    if (params.path === '/not/exist/path/123456') {
      return {
        success: false,
        code: 4001,
        message: '项目路径不存在'
      };
    }

    // 模拟成功场景
    let analyzedFilesCount = 6;
    let message = '解析成功';
    let success = true;
    
    // 不同测试场景返回不同的文件数
    if (params.path?.includes('exception')) {
      // ST-FULL-006: 敏感文件测试
      analyzedFilesCount = 8;
    } else if (params.path?.includes('medium')) {
      // 中型项目
      analyzedFilesCount = 50;
    } else {
      // 默认小型项目
      analyzedFilesCount = 6;
    }
    
    // 旧版本存在 --force/未提交变更阻断；现版本不再阻断解析，这里始终返回成功路径。
    
    // ST-INC-001: 增量解析返回更少的文件数
    if (params.mode === 'incremental') {
      analyzedFilesCount = 2;
    }

    return {
      success,
      code: success ? 200 : 4000,
      message,
        data: {
          projectName: 'test-project',
          mode: (params.mode || 'auto') === 'auto' ? 'full' : params.mode as 'full' | 'incremental',
          analyzedFilesCount,
          duration: params.mode === 'incremental' ? 400 : 1000,
          summaryPath: '/test/path/PROJECT_SUMMARY.md'
        }
    };
  }
  throw new Error(`Unknown command: ${command}`);
}

/**
 * 调用Skill接口（Mock实现，用于单元测试）
 */
export async function invokeSkill(
  skillName: string,
  params: ProjectCodeQuerySkillParams
): Promise<ProjectCodeQuerySkillResult> {
  if (skillName === 'project-skill-any-code') {
    // 参数校验
    const validation = ProjectCodeQuerySkillSchema.safeParse(params);
    if (!validation.success) {
      return {
        success: false,
        code: 4000,
        message: '参数校验失败',
        errors: validation.error.issues.map((issue: ZodIssue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      };
    }

    // 模拟路径不存在场景
    if (params.path === 'not/exist/path.ts') {
      return {
        success: false,
        code: 4004,
        message: '解析结果不存在'
      };
    }

    // 模拟成功场景
    if (params.type === 'summary') {
      // 判断是否是目录查询
      let isDirectory = false;
      try {
        const stats = await stat(params.path);
        isDirectory = stats.isDirectory();
      } catch (e) {
        // 路径不存在时用字符串判断兜底
        isDirectory = !params.path.includes('.') || params.path.endsWith('/');
      }
      return {
        success: true,
        code: 200,
        message: '查询成功',
        data: {
          path: params.path,
          type: isDirectory ? 'directory' : 'file',
          summary: '这是一个测试文件，包含加法函数和Calculator计算器类'
        }
      };
    }

    if (params.type === 'full') {
      // 明确处理目录查询场景
      let isDirectory = false;
      try {
        const stats = await stat(params.path);
        isDirectory = stats.isDirectory();
      } catch (e) {
        // 路径不存在时用字符串判断兜底
        isDirectory = params.path === 'src' || !params.path.includes('.') || params.path.endsWith('/');
      }
      return {
        success: true,
        code: 200,
        message: '查询成功',
        data: {
          path: params.path,
          type: isDirectory ? 'directory' : 'file',
          fullAnalysis: isDirectory ? {
            type: 'directory',
            path: params.path,
            name: 'src',
            summary: '源代码目录',
            structure: [
              { name: 'index.ts', type: 'file', description: '入口文件' },
              { name: 'utils', type: 'directory', description: '工具函数目录' }
            ],
            dependencies: [],
            moduleDiagram: '',
            lastAnalyzedAt: new Date().toISOString(),
            commitHash: 'test-commit-123'
          } : {
            type: 'file',
            path: params.path,
            name: 'index.ts',
            language: 'typescript',
            linesOfCode: 50,
            dependencies: [],
            summary: '测试文件，包含Calculator类和add函数',
            classes: [
              {
                name: 'Calculator',
                methods: [
                  { name: 'add', signature: 'add(num: number): void', description: '添加数字到结果', visibility: 'public' },
                  { name: 'getResult', signature: 'getResult(): number', description: '获取计算结果', visibility: 'public' }
                ],
                properties: [
                  { name: 'value', type: 'number', description: '存储计算结果', visibility: 'private' }
                ]
              }
            ],
            functions: [
              { name: 'add', signature: 'add(a: number, b: number): number', description: '两个数字相加' }
            ],
            classDiagram: 'classDiagram\nclass Calculator {\n  - number value\n  + add(num: number) void\n  + getResult() number\n}',
            sequenceDiagram: 'sequenceDiagram\nparticipant User\nparticipant Calculator\nUser->>Calculator: add(5)\nCalculator->>Calculator: value +=5\nUser->>Calculator: getResult()\nCalculator-->>User: 5',
            lastAnalyzedAt: new Date().toISOString(),
            commitHash: 'test-commit-123'
          }
        }
      };
    }

    if (params.type === 'diagram') {
      return {
        success: true,
        code: 200,
        message: '查询成功',
        data: {
          path: params.path,
          type: 'file',
          diagrams: [
            { type: 'class', content: 'classDiagram\nclass Calculator {\n  - number value\n  + add(num: number) void\n  + getResult() number\n}' },
            { type: 'sequence', content: 'sequenceDiagram\nparticipant User\nparticipant Calculator\nUser->>Calculator: add(5)\nCalculator->>Calculator: value +=5\nUser->>Calculator: getResult()\nCalculator-->>User: 5' }
          ]
        }
      };
    }
  }
  throw new Error(`Unknown skill: ${skillName}`);
}
