import inquirer from 'inquirer';
import pc from 'picocolors';
import type { TokenUsageStats } from './types';

interface CliRenderState {
  total: number;
  done: number;
  currentObjects: string[];
  tokens?: TokenUsageStats;
  totalKnown: boolean;
  scannedFiles?: number;
}

/**
 * CLI 多行区域渲染器：统一负责
 * - 进度行：「解析进度 |████...| 37% | 已处理: x/y 对象」
 * - 当前对象块：
 *   当前对象:
 *     [ foo ]
 *     [ bar ]
 * - Tokens 行：「Tokens: in=... out=... total=...」
 *
 * 通过 ANSI 光标控制码在同一块区域内重绘，避免产生多份重复的块。
 */
export class CliMultiSectionRenderer {
  private state: CliRenderState = {
    total: 0,
    done: 0,
    currentObjects: [],
    totalKnown: false,
  };

  // 最近一次渲染占用了多少行，用于回退光标和清空
  private renderedLines = 0;
  private readonly isInteractive: boolean;

  constructor() {
    this.isInteractive = !!process.stdout.isTTY && process.env.TERM !== 'dumb';
  }

  setTotal(total: number) {
    this.state.total = total;
    this.state.totalKnown = true;
    if (this.state.done > total) {
      this.state.done = total;
    }
    this.render();
  }

  updateProgress(done: number, total: number, currentPathsText?: string, maxLines?: number) {
    this.state.done = done;
    // 若 total 尚未通过 onTotalKnown 确认，则不接受外部传入的 total，避免占位魔法数字污染首帧。
    if (this.state.totalKnown) {
      this.state.total = total;
    }
    if (currentPathsText !== undefined) {
      let lines = currentPathsText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (typeof maxLines === 'number' && maxLines > 0 && lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
      }
      this.state.currentObjects = lines;
    }
    this.render();
  }

  updateTokens(tokens: TokenUsageStats) {
    this.state.tokens = { ...tokens };
    this.render();
  }

  /**
   * 扫描阶段：实时更新“已扫描将被解析的文件数”。
   * 该信息以单独一行展示，并在同一位置覆盖刷新。
   */
  updateScanProgress(scannedFiles: number) {
    this.state.scannedFiles = scannedFiles;
    this.render();
  }

  /**
   * 在进度区域下方追加一条日志。
   * 实现方式：先清空进度区域，将日志打印到 stdout，然后重新渲染进度区域。
   */
  logBelow(message: string) {
    if (this.isInteractive) {
      this.clearRenderedArea();
      process.stdout.write(message + '\n');
      this.render();
    } else {
      // 非交互终端下不做覆盖，仅顺序输出日志与最新快照，避免依赖 ANSI 光标控制。
      process.stdout.write(message + '\n');
      const lines = this.buildLines();
      for (const line of lines) {
        process.stdout.write(line + '\n');
      }
    }
  }

  private buildLines(): string[] {
    const { total, done, currentObjects, tokens, totalKnown, scannedFiles } = this.state;

    const safeTotal = totalKnown && total > 0 ? total : 1;
    const ratio = totalKnown ? Math.max(0, Math.min(1, done / safeTotal)) : 0;
    const percentage = totalKnown ? Math.floor(ratio * 100) : 0;

    const barWidth = 40;
    const completeCount = Math.round(barWidth * ratio);
    const incompleteCount = barWidth - completeCount;
    const bar =
      '█'.repeat(completeCount) +
      '░'.repeat(Math.max(0, incompleteCount));

    const lines: string[] = [];

    // 扫描阶段行：仅当有值时展示一行，实时覆盖刷新（对象=文件+目录）
    if (typeof scannedFiles === 'number') {
      lines.push(`Scanned objects to analyze: ${scannedFiles}`);
    }

    // 进度行（V2.4：将「已处理: x/y」拆为独立行，避免被“当前对象路径提取”误判为路径）
    const totalLabel = totalKnown ? String(total) : '?';
    lines.push(`${pc.blue('Progress')} |${pc.cyan(bar)}| ${percentage}%`);
    lines.push(`Processed: ${done}/${totalLabel}`);

    // 当前对象块
    // 需求：仅当存在 worker 正在处理的对象时才展示该块；无对象时整段不输出（不占用任何行）。
    if (currentObjects.length > 0) {
      lines.push('Current:');
      for (const obj of currentObjects) {
        lines.push(`  [ ${obj} ]`);
      }
    }

    // Tokens 行（即使 tokens 尚未产生也显示 0，避免首帧缺行导致 UI 跳变）
    const t = tokens ?? { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalCalls: 0 };
    lines.push(
      `Tokens: in=${t.totalPromptTokens} out=${t.totalCompletionTokens} total=${t.totalTokens}`,
    );

    return lines;
  }

  private clearRenderedArea() {
    if (!this.isInteractive || this.renderedLines <= 0) return;

    // 将光标移动到渲染块的起始行
    process.stdout.write(`\u001b[${this.renderedLines}F`);
    for (let i = 0; i < this.renderedLines; i += 1) {
      // 清除当前行并换行到下一行
      process.stdout.write('\u001b[2K\r\n');
    }
    // 回到块的起始位置
    process.stdout.write(`\u001b[${this.renderedLines}F`);
    this.renderedLines = 0;
  }

  private render() {
    const lines = this.buildLines();

    if (this.isInteractive) {
      // 将光标移到当前块顶部并清空旧内容
      if (this.renderedLines > 0) {
        process.stdout.write(`\u001b[${this.renderedLines}F`);
      }
      for (let i = 0; i < this.renderedLines; i += 1) {
        process.stdout.write('\u001b[2K\r\n');
      }
      if (this.renderedLines > 0) {
        process.stdout.write(`\u001b[${this.renderedLines}F`);
      }

      // 写入新内容
      for (const line of lines) {
        process.stdout.write('\u001b[2K'); // 清当前行
        process.stdout.write(line + '\n');
      }

      this.renderedLines = lines.length;
    } else {
      // 非交互终端：不做覆盖，仅输出一次最新快照，避免光标控制符干扰日志采集。
      for (const line of lines) {
        process.stdout.write(line + '\n');
      }
      this.renderedLines = 0;
    }
  }
}

export const cliRenderer = new CliMultiSectionRenderer();

export async function confirm(message: string, defaultAnswer: boolean = false): Promise<boolean> {
  const { answer } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'answer',
      message,
      default: defaultAnswer,
    },
  ]);
  return answer;
}

export async function select(message: string, choices: string[]): Promise<string> {
  const { selected } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selected',
      message,
      choices,
    },
  ]);
  return selected;
}

export async function input(message: string, defaultValue?: string): Promise<string> {
  const { value } = await inquirer.prompt([
    {
      type: 'input',
      name: 'value',
      message,
      default: defaultValue,
    },
  ]);
  return value;
}
