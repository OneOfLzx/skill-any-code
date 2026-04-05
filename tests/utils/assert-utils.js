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
exports.AssertUtils = void 0;
const fs = __importStar(require("fs/promises"));
/**
 * 自定义断言工具类
 */
class AssertUtils {
    /**
     * 验证数据结构符合Zod Schema
     */
    static validateSchema(data, schema) {
        const result = schema.safeParse(data);
        expect(result.success).toBe(true);
        if (!result.success) {
            console.error('Schema validation errors:', result.error.issues);
        }
    }
    /**
     * 验证文件分析结果结构合法
     */
    static validFileAnalysis(analysis) {
        expect(analysis.type).toBe('file');
        expect(typeof analysis.path).toBe('string');
        expect(typeof analysis.name).toBe('string');
        expect(typeof analysis.language).toBe('string');
        expect(typeof analysis.linesOfCode).toBe('number');
        expect(Array.isArray(analysis.dependencies)).toBe(true);
        expect(typeof analysis.summary).toBe('string');
        expect(Array.isArray(analysis.classes)).toBe(true);
        expect(Array.isArray(analysis.functions)).toBe(true);
        expect(typeof analysis.classDiagram).toBe('string');
        expect(typeof analysis.sequenceDiagram).toBe('string');
    }
    /**
     * 验证目录分析结果结构合法
     */
    static validDirectoryAnalysis(analysis) {
        expect(analysis.type).toBe('directory');
        expect(typeof analysis.path).toBe('string');
        expect(typeof analysis.name).toBe('string');
        expect(typeof analysis.summary).toBe('string');
        expect(Array.isArray(analysis.structure)).toBe(true);
        expect(Array.isArray(analysis.dependencies)).toBe(true);
        expect(typeof analysis.moduleDiagram).toBe('string');
    }
    /**
     * 验证项目总结结果结构合法
     */
    static validProjectSummary(summary) {
        expect(typeof summary.projectName).toBe('string');
        expect(typeof summary.slug).toBe('string');
        expect(typeof summary.description).toBe('string');
        expect(Array.isArray(summary.techStack)).toBe(true);
        expect(typeof summary.codeSize).toBe('object');
        expect(typeof summary.architecture).toBe('object');
        expect(typeof summary.coreFlow).toBe('string');
        expect(typeof summary.architectureDiagram).toBe('string');
        expect(typeof summary.flowDiagram).toBe('string');
    }
    /**
     * 验证元数据结构合法
     */
    static validMetadata(metadata) {
        expect(typeof metadata.projectRoot).toBe('string');
        expect(typeof metadata.lastAnalyzedAt).toBe('string');
        expect(Array.isArray(metadata.gitCommits)).toBe(true);
        expect(typeof metadata.analysisVersion).toBe('string');
        expect(typeof metadata.analyzedFilesCount).toBe('number');
    }
    /**
     * 验证Markdown文件无语法错误（基础检查）
     */
    static async validMarkdownFile(filePath) {
        const content = await fs.readFile(filePath, 'utf-8');
        // 基础语法检查：标题层级正确，无未闭合的代码块
        const codeBlockMatches = content.match(/```/g);
        expect(codeBlockMatches?.length % 2).toBe(0); // 代码块标签成对出现
        // 检查标题层级：# 后必须有空格
        const invalidHeaders = content.match(/^#{1,6}[^ ]/gm);
        expect(invalidHeaders).toBeNull();
    }
    /**
     * 验证Mermaid图表语法合法（基础检查）
     */
    static validMermaidCode(mermaidCode) {
        // 必须包含Mermaid类型声明
        expect(mermaidCode).toMatch(/^(graph|sequenceDiagram|classDiagram|flowchart)/);
        // 基础语法检查：无明显语法错误
        expect(mermaidCode).not.toContain('Syntax error');
        expect(mermaidCode.length).toBeGreaterThan(10);
    }
    /**
     * 验证文件存在
     */
    static async fileExists(filePath) {
        try {
            await fs.access(filePath);
        }
        catch (e) {
            throw new Error(`File does not exist: ${filePath}`);
        }
    }
    /**
     * 验证目录存在
     */
    static async directoryExists(dirPath) {
        try {
            const stat = await fs.stat(dirPath);
            expect(stat.isDirectory()).toBe(true);
        }
        catch (e) {
            throw new Error(`Directory does not exist: ${dirPath}`);
        }
    }
    /**
     * 验证性能指标符合要求
     */
    static validatePerformance(metric) {
        if (metric.singleFileParseTime !== undefined) {
            expect(metric.singleFileParseTime).toBeLessThanOrEqual(2000); // <=2s
        }
        if (metric.thousandFileParseTime !== undefined) {
            expect(metric.thousandFileParseTime).toBeLessThanOrEqual(300000); // <=5分钟
        }
        if (metric.incrementalParseTime !== undefined) {
            expect(metric.incrementalParseTime).toBeLessThanOrEqual(3000); // <=3s
        }
        if (metric.cpuUsage !== undefined) {
            expect(metric.cpuUsage).toBeLessThanOrEqual(70); // <=70%
        }
        if (metric.memoryUsage !== undefined) {
            expect(metric.memoryUsage).toBeLessThanOrEqual(500 * 1024 * 1024); // <=500MB
        }
    }
}
exports.AssertUtils = AssertUtils;
