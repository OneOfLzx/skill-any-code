import { IFileSplitter } from '../../domain/interfaces';
import { FileChunk, FileChunkAnalysis, FileAnalysis } from '../../common/types';
import { AppError, ErrorCode } from '../../common/errors';
import { ILLMClient } from '../../domain/interfaces';
import {
  MERGE_STRUCTURE_PROMPT,
  FILE_DESCRIPTION_PROMPT,
  FILE_SUMMARY_PROMPT,
  PARSE_RETRY_HINT
} from '../llm/prompt.template';
import Mustache from 'mustache';
import path from 'path';

/** 从 LLM 返回中解析单字段：支持 {"key": "value"} 或纯字符串 */
function parseSingleField(content: string, field: 'description' | 'summary'): string {
  const trimmed = content.trim();
  try {
    const o = JSON.parse(trimmed);
    if (o && typeof o[field] === 'string') return o[field];
  } catch {
    // 非 JSON 则整体视为该字段内容
  }
  return trimmed || '';
}

export class CodeSplitter implements IFileSplitter {
  private llmClient: ILLMClient;

  constructor(llmClient: ILLMClient) {
    this.llmClient = llmClient;
  }

  async split(fileContent: string, maxChunkSize: number): Promise<FileChunk[]> {
    try {
      // 按 Unicode code points 切片，避免 surrogate pair 被截断导致乱码。
      const codePoints = Array.from(fileContent)
      const chunks: FileChunk[] = []

      if (maxChunkSize <= 0) {
        // 防御：maxChunkSize 非法时直接返回一个“全部内容”chunk。
        chunks.push({
          id: 0,
          content: fileContent,
          startLine: -1,
          endLine: -1,
          context: '',
        })
        return chunks
      }

      for (let start = 0; start < codePoints.length; start += maxChunkSize) {
        const end = Math.min(start + maxChunkSize, codePoints.length)
        const chunkContent = codePoints.slice(start, end).join('')

        chunks.push({
          id: chunks.length,
          content: chunkContent,
          // 当前新流水线不依赖 line/context，保留字段占位即可。
          startLine: -1,
          endLine: -1,
          context: '',
        })
      }

      return chunks
    } catch (error: any) {
      throw new AppError(ErrorCode.FILE_SPLIT_FAILED, `Failed to split file: ${error.message}`, error);
    }
  }

  /**
   * 合并阶段逻辑仍保留（兼容旧流程），但新的 Symbols/Description/Summary 流水线会在 LLM 层直接完成合并。
   */
  async merge(chunks: FileChunkAnalysis[], filePath: string): Promise<FileAnalysis> {
    const opts = { temperature: 0.1 };

    // 第一步：合并分片结果为统一结构
    const structure = await this.callWithParseRetry(
      Mustache.render(MERGE_STRUCTURE_PROMPT, {
        filePath,
        chunkResults: JSON.stringify(chunks, null, 2)
      }),
      opts,
      (content) => {
        const o = JSON.parse(content);
        return {
          name: o.name ?? path.basename(filePath),
          classes: Array.isArray(o.classes) ? o.classes : [],
          functions: Array.isArray(o.functions) ? o.functions : []
        };
      }
    );

    const structureJson = JSON.stringify(structure, null, 2);

    // 第二步：生成功能描述
    const description = await this.callWithParseRetry(
      Mustache.render(FILE_DESCRIPTION_PROMPT, { structureJson }),
      opts,
      (content) => parseSingleField(content, 'description')
    );

    // 第三步：生成概述
    const summary = await this.callWithParseRetry(
      Mustache.render(FILE_SUMMARY_PROMPT, { structureJson, description }),
      opts,
      (content) => parseSingleField(content, 'summary')
    );

    // 基础信息由程序侧负责，此处仅返回语义部分，路径等由调用方补充
    const name = path.basename(filePath);

    return {
      type: 'file',
      path: filePath,
      name,
      language: '',
      linesOfCode: 0,
      dependencies: [],
      description,
      summary,
      classes: structure.classes,
      functions: structure.functions,
      lastAnalyzedAt: new Date().toISOString(),
      commitHash: ''
    };
  }

  /** 单次调用：解析失败则仅重试该次一次（需求 10.9.2）。 */
  private async callWithParseRetry<T>(
    prompt: string,
    options: { temperature?: number },
    parseFn: (content: string) => T
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.llmClient.call(attempt === 1 ? prompt + PARSE_RETRY_HINT : prompt, {
          ...options,
          retries: 0
        });
        return parseFn(response.content);
      } catch (e) {
        lastError = e;
      }
    }
    throw new AppError(
      ErrorCode.CHUNK_MERGE_FAILED,
      `Failed to parse merge response after retry: ${(lastError as Error)?.message}`,
      lastError
    );
  }

  // extractContext 已在新流水线不再需要；保留占位以免对旧接口造成破坏（无实际使用）。
}
