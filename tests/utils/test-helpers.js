"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invokeCommand = invokeCommand;
exports.invokeSkill = invokeSkill;
const schema_1 = require("../../src/commands/analyze-project/schema");
const skill_1 = require("../../src/skills/project-skill-any-code/skill");
const ProjectCodeQuerySkillSchema = skill_1.ProjectCodeQuerySkill.schema;
/**
 * 调用命令接口（Mock实现，用于单元测试）
 */
async function invokeCommand(command, params) {
    if (command === '/analyze-project') {
        // 参数校验
        const validation = schema_1.AnalyzeProjectCommandSchema.safeParse(params);
        if (!validation.success) {
            return {
                success: false,
                code: 4000,
                message: '参数校验失败',
                errors: validation.error.issues.map(issue => ({
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
        return {
            success: true,
            code: 200,
            message: '解析成功',
            data: {
                projectName: 'test-project',
                mode: params.mode === 'auto' ? 'full' : params.mode,
                analyzedFilesCount: 6,
                duration: 1000,
                summaryPath: '/test/path/PROJECT_SUMMARY.md'
            }
        };
    }
    throw new Error(`Unknown command: ${command}`);
}
/**
 * 调用Skill接口（Mock实现，用于单元测试）
 */
async function invokeSkill(skillName, params) {
    if (skillName === 'project-skill-any-code') {
        // 参数校验
        const validation = ProjectCodeQuerySkillSchema.safeParse(params);
        if (!validation.success) {
            return {
                success: false,
                code: 4000,
                message: '参数校验失败',
                errors: validation.error.issues.map(issue => ({
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
            return {
                success: true,
                code: 200,
                message: '查询成功',
                data: {
                    path: params.path,
                    type: 'file',
                    summary: '这是一个测试文件，包含加法函数和计算器类'
                }
            };
        }
        if (params.type === 'full') {
            return {
                success: true,
                code: 200,
                message: '查询成功',
                data: {
                    path: params.path,
                    type: 'file',
                    fullAnalysis: {
                        basicInfo: {
                            name: 'index.ts',
                            language: 'typescript',
                            linesOfCode: 50,
                            dependencies: []
                        },
                        classes: [
                            {
                                name: 'Calculator',
                                methods: [
                                    { name: 'add', signature: 'add(num: number): void', description: '添加数字到结果' },
                                    { name: 'getResult', signature: 'getResult(): number', description: '获取计算结果' }
                                ],
                                properties: [
                                    { name: 'value', type: 'number', description: '存储计算结果' }
                                ]
                            }
                        ],
                        functions: [
                            { name: 'add', signature: 'add(a: number, b: number): number', description: '两个数字相加' }
                        ],
                        classDiagram: 'classDiagram\nclass Calculator {\n  - number value\n  + add(num: number) void\n  + getResult() number\n}',
                        sequenceDiagram: 'sequenceDiagram\nparticipant User\nparticipant Calculator\nUser->>Calculator: add(5)\nCalculator->>Calculator: value +=5\nUser->>Calculator: getResult()\nCalculator-->>User: 5'
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
