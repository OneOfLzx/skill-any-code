import pc from 'picocolors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

type LogSink = (line: string, isError?: boolean) => void;

class Logger {
  private level: LogLevel = 'info';

  // 可选的外部日志接收器（例如 CLI 多行渲染器），用于实现“日志固定在进度块下方”。
  private sink?: LogSink;

  setLevel(level: LogLevel) {
    this.level = level;
  }

  setSink(sink?: LogSink) {
    this.sink = sink;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private write(line: string, isError: boolean) {
    if (this.sink) {
      this.sink(line, isError);
      return;
    }
    if (isError) {
      // stderr 不做颜色降级，交给调用方控制；这里保留 ANSI 颜色。
      // eslint-disable-next-line no-console
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }

  debug(message: string, ...args: any[]) {
    if (!this.shouldLog('debug')) return;
    const line = pc.gray(`[DEBUG] ${message}${args.length ? ' ' + args.join(' ') : ''}`);
    this.write(line, false);
  }

  info(message: string, ...args: any[]) {
    if (!this.shouldLog('info')) return;
    const line = pc.blue(`[INFO] ${message}${args.length ? ' ' + args.join(' ') : ''}`);
    this.write(line, false);
  }

  success(message: string, ...args: any[]) {
    if (!this.shouldLog('info')) return;
    const line = pc.green(`[SUCCESS] ${message}${args.length ? ' ' + args.join(' ') : ''}`);
    this.write(line, false);
  }

  warn(message: string, ...args: any[]) {
    if (!this.shouldLog('warn')) return;
    const line = pc.yellow(`[WARN] ${message}${args.length ? ' ' + args.join(' ') : ''}`);
    this.write(line, false);
  }

  error(message: string, error?: Error, ...args: any[]) {
    if (!this.shouldLog('error')) return;
    const base = pc.red(`[ERROR] ${message}${args.length ? ' ' + args.join(' ') : ''}`);
    this.write(base, true);
    if (error && this.level === 'debug') {
      const stackLine = pc.red(error.stack || String(error));
      this.write(stackLine, true);
    }
  }
}

export const logger = new Logger();
