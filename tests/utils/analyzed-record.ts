import path from 'path';
import fs from 'fs-extra';

export type AnalyzedFileRecord = {
  fileHashWhenAnalyzed?: string;
};

function resolveAnalyzedMarkdownPath(
  projectPath: string,
  outputDirName: string,
  relFilePath: string,
): string {
  const parsed = path.parse(relFilePath);
  const mdFileName = `${parsed.base}.md`;
  return path.join(projectPath, outputDirName, path.dirname(relFilePath), mdFileName);
}

function extractBasicInfoValue(markdown: string, key: string): string | undefined {
  const md = markdown.replace(/\r\n/g, '\n');
  const sectionMatch = md.match(/\n##\s+基本信息\n([\s\S]*?)(?=\n##\s+|\n#\s+|$)/m);
  const tryExtract = (block: string): string | undefined => {
    const re = new RegExp(`^\\s*-\\s*${key}\\s*[：:]\\s*(.*?)\\s*$`, 'm');
    const m = block.match(re);
    return m?.[1]?.trim();
  };

  if (sectionMatch) {
    const basic = sectionMatch[1];
    const v = tryExtract(basic);
    if (v) return v;
  }

  // 兼容：有些历史产物可能不含“基本信息”段或段落格式被改写，做一次全局兜底提取
  const globalRe = new RegExp(`${key}\\s*[：:]\\s*([a-fA-F0-9]{16,})`, 'm');
  const gm = md.match(globalRe);
  return gm?.[1]?.trim();
}

export async function readAnalyzedFileRecord(
  projectPath: string,
  relFilePath: string,
): Promise<AnalyzedFileRecord> {
  const mdPath = resolveAnalyzedMarkdownPath(projectPath, '.skill-any-code-result', relFilePath);
  if (!(await fs.pathExists(mdPath))) {
    throw new Error(`Analyzed record Markdown not found for ${relFilePath}. Tried: ${mdPath}`);
  }
  const content = await fs.readFile(mdPath, 'utf-8');
  const fileHashWhenAnalyzed = extractBasicInfoValue(content, 'file_hash_when_analyzed');
  return { fileHashWhenAnalyzed };
}

export async function readFileHashWhenAnalyzedOrThrow(
  projectPath: string,
  relFilePath: string,
): Promise<string> {
  const rec = await readAnalyzedFileRecord(projectPath, relFilePath);
  const hash = rec.fileHashWhenAnalyzed;
  if (!hash) {
    throw new Error(`Expected fileHashWhenAnalyzed in analyzed record for ${relFilePath}`);
  }
  return hash;
}

