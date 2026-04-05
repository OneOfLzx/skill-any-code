#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import fs from 'fs-extra';
import path from 'path';
import { version } from '../package.json';
import { AnalysisAppService } from './application/analysis.app.service';
import { configManager } from './common/config';
import { logger } from './common/logger';
import { cliRenderer } from './common/ui';
import type { TokenUsageStats } from './common/types';
import { AppError, ErrorCode } from './common/errors';
import { LocalStorageService } from './infrastructure/storage.service';
import { GitService } from './infrastructure/git.service';
import { generateProjectSlug } from './common/utils';
import { DEFAULT_CONCURRENCY } from './common/constants';

const program = new Command();

// 主命令配置
program
  .name('skill-any-code')
  .alias('sac')
  .description('Skill Any Code: a CLI for large codebase understanding and analysis')
  .version(version, '-v, --version', 'Show version number')
  .helpOption('-h, --help', 'Show help information')
  .option('--log-level <level>', 'Log level: debug/info/warn/error')
  .option('--path <path>', 'Project root path to analyze', process.cwd())
  .option('-m, --mode <mode>', 'Analysis mode: full/incremental/auto', 'auto')
  .option('-d, --depth <number>', 'Max directory depth (-1 = unlimited)', '-1')
  .option('-C, --concurrency <number>', 'Max concurrent workers (default: CPU*2, capped by analyze.max_concurrency)')
  .option('--max-file-size-bytes <number>', 'Max size per file in bytes; larger files are skipped in project scan')
  .option('--output-dir <path>', 'Custom output directory for results')
  .option('--skills-providers <list>', 'Comma-separated AI tool providers (opencode/cursor/claude/codex)')
  .option('--no-skills', 'Skip skill generation')
  // LLM相关参数
  .option('--llm-base-url <url>', 'LLM API base URL')
  .option('--llm-api-key <key>', 'LLM API key')
  .option('--llm-model <model>', 'LLM model name')
  .option('--llm-temperature <number>', 'LLM temperature (0-2)', parseFloat)
  .option('--llm-max-tokens <number>', 'LLM max output tokens', parseInt)
  .option('--llm-timeout <ms>', 'LLM request timeout (ms)', parseInt)
  .option('--llm-max-retries <number>', 'LLM max retries', parseInt)
  .option('--llm-retry-delay <ms>', 'LLM retry delay (ms)', parseInt)
  .option('--llm-context-window-size <number>', 'LLM context window size', parseInt)
  .option('--no-llm-cache', 'Disable LLM result cache')
  .option('--llm-cache-dir <path>', 'LLM cache directory')
  .option('--clear-cache', 'Clear existing LLM cache before analyzing');

// init 子命令：显式初始化配置文件（V2.5）
program
  .command('init')
  .description('Initialize or reset the config file')
  .action(async () => {
    try {
      const resolvedPath = '~/.config/skill-any-code/config.yaml';
      const fsPath = resolvedPath.replace('~', process.env.HOME || process.env.USERPROFILE || '');
      const exists = await fs.pathExists(fsPath);

      await configManager.init();
      logger.success(exists ? `Config file reset: ${fsPath}` : `Config file created: ${fsPath}`);
      process.exit(0);
    } catch (error) {
      logger.error('Failed to initialize config', error as Error);
      process.exit(1);
    }
  });

// 默认解析（不带子命令时直接执行）
program.action(async () => {
    const os = require('os');
    try {
      // 加载配置（V2.5：配置未初始化时直接失败，提示先执行 init）
      let config;
      try {
        config = await configManager.load();
      } catch (e: any) {
        if (e instanceof AppError && e.code === ErrorCode.CONFIG_NOT_INITIALIZED) {
          process.stderr.write(
            `Config is not initialized. Run "skill-any-code init" to create: ~/.config/skill-any-code/config.yaml\n`,
          );
          process.exit(1);
          return;
        }
        throw e;
      }
      const cliLogLevel = program.opts().logLevel as any;
      if (cliLogLevel) {
        logger.setLevel(cliLogLevel);
      }

      // 合并LLM命令行参数
      const options = program.opts();
      if (options.llmBaseUrl) config.llm.base_url = options.llmBaseUrl;
      if (options.llmApiKey) config.llm.api_key = options.llmApiKey;
      if (options.llmModel) config.llm.model = options.llmModel;
      if (options.llmTemperature !== undefined) config.llm.temperature = options.llmTemperature;
      if (options.llmMaxTokens !== undefined) config.llm.max_tokens = options.llmMaxTokens;
      if (options.llmTimeout !== undefined) config.llm.timeout = options.llmTimeout;
      if (options.llmMaxRetries !== undefined) config.llm.max_retries = options.llmMaxRetries;
      if (options.llmRetryDelay !== undefined) config.llm.retry_delay = options.llmRetryDelay;
      if (options.llmContextWindowSize !== undefined) config.llm.context_window_size = options.llmContextWindowSize;
      if (options.llmCache !== undefined) config.llm.cache_enabled = options.llmCache;
      if (options.llmCacheDir) config.llm.cache_dir = options.llmCacheDir;

      // 处理清空缓存选项
      if (options.clearCache) {
        const { FileHashCache } = await import('./infrastructure/cache/file.hash.cache');
        const homeDir = os.homedir();
        const cache = new FileHashCache({
          cacheDir: config.llm.cache_dir.replace(/^~(?=\/|\\|$)/, homeDir),
          maxSizeMb: config.llm.cache_max_size_mb,
        });
        await cache.clear();
        logger.info('LLM cache cleared');
      }

      // 默认并发：CPU*2，但不超过配置中的 analyze.max_concurrency
      const cpuBasedConcurrency = DEFAULT_CONCURRENCY;
      const configuredMax = Number(config.analyze.max_concurrency ?? DEFAULT_CONCURRENCY);
      const defaultConcurrency =
        configuredMax > 0 ? Math.min(cpuBasedConcurrency, configuredMax) : cpuBasedConcurrency;

      const analysisParams = {
        path: options.path,
        mode: options.mode as any,
        depth: Number(options.depth),
        concurrency: options.concurrency !== undefined ? Number(options.concurrency) : defaultConcurrency,
        maxFileSizeBytes: options.maxFileSizeBytes !== undefined ? Number(options.maxFileSizeBytes) : undefined,
        outputDir: options.outputDir || config.global.output_dir,
        llmConfig: config.llm,
        skillsProviders: options.skillsProviders
          ? options.skillsProviders.split(',').map((s: string) => s.trim().toLowerCase())
          : undefined,
        noSkills: options.skills === false,
      };

      // 启动前做“同形态”连通性校验：使用与真实解析一致的 user 消息调用，
      // 避免旧版 system-only health-check 带来的假阴性。
      const { OpenAIClient } = await import('./infrastructure/llm/openai.client');
      const llmClient = new OpenAIClient(config.llm);
      logger.info(
        `LLM client initialized. Validating connectivity with a real-shape request (url=${config.llm.base_url}, model=${config.llm.model})`,
      );
      try {
        await llmClient.call('Return OK only.', {
          model: config.llm.model,
          temperature: 0,
          maxTokens: Math.max(8, Math.min(32, config.llm.max_tokens || 32)),
          retries: 0,
        });
      } catch (e: any) {
        const detail = e?.message || String(e);
        process.stderr.write(`LLM connectivity/config validation failed: ${detail}\n`);
        process.exit(1);
      }

      const analysisService = new AnalysisAppService();

      // 在 analyze 生命周期内，将所有 logger 输出通过 CLI 渲染器固定到进度块下方，
      // 避免产生额外的进度/对象/Tokens 区域块。
      logger.setSink((line) => {
        cliRenderer.logBelow(line);
      });

      const paramsWithProgress = {
        ...analysisParams,
        onTotalKnown: (total: number) => {
          cliRenderer.setTotal(total);
        },
        onProgress: (done: number, total: number, current?: { path: string }) => {
          cliRenderer.updateProgress(done, total, current?.path, analysisParams.concurrency);
        },
        onTokenUsageSnapshot: (stats: TokenUsageStats) => {
          cliRenderer.updateTokens(stats);
        },
        onScanProgress: (scannedFiles: number) => {
          cliRenderer.updateScanProgress(scannedFiles);
        },
      };

      let result;
      // 执行解析（V2.4+：不再在 CLI 中做交互式错误处理，所有 LLM 错误由应用层统一抛出）
      result = await analysisService.runAnalysis(paramsWithProgress);
      
      if (result.success) {
        const files = result.data?.analyzedFilesCount || 0;
        const dirs = (result as any).data?.analyzedDirsCount || 0;
        const objects = files + dirs;
        logger.success(
          `Analysis completed. Processed ${objects} object(s)`,
        );
        const summaryPath = result.data?.summaryPath || '';
        const summaryLabel = summaryPath ? `Entry file: ${path.basename(summaryPath)}` : 'Entry file: index.md';
        logger.success(`Project analysis result. ${summaryLabel}`);
        const usage = result.data?.tokenUsage;
        if (usage) {
          logger.info(
            `LLM calls: ${usage.totalCalls}, prompt tokens: ${usage.totalPromptTokens}, ` +
            `completion tokens: ${usage.totalCompletionTokens}, total tokens: ${usage.totalTokens}`
          );
        }
      } else {
        logger.error(`Analysis failed: ${result.message}`);
        if (result.errors && result.errors.length > 0) {
          result.errors.forEach(err => logger.error(`- ${err.path}: ${err.message}`));
        }
        process.exit(1);
      }
    } catch (error) {
      const err = error as any;
      if (err instanceof AppError) {
        logger.error(`Execution failed: ${err.message}`, err);
      } else {
        logger.error('Execution failed', err as Error);
      }
      process.exit(1);
    }
  });

// resolve 子命令（V2.6：根据相对路径推导分析结果 Markdown 路径，不依赖索引）
program
  .command('resolve')
  .description('Resolve the analysis result Markdown path for a file/directory')
  .argument('<relative-path>', 'Relative path of the file/directory (from project root)')
  .option('-p, --project <path>', 'Project root path', process.cwd())
  .action(async (relativePath: string, options: { project?: string }) => {
    try {
      logger.setLevel(program.opts().logLevel as any);
      const projectRoot = options.project || process.cwd();

      const DEFAULT_OUTPUT_DIR = '.skill-any-code-result'

      const normalizeRel = (input: string): { rel: string; rawHadTrailingSlash: boolean } => {
        const raw = (input || '').trim()
        const rawPosix = raw.replace(/\\/g, '/')
        const rawHadTrailingSlash = rawPosix.endsWith('/') && rawPosix.length > 1
        let rel = rawPosix
        while (rel.startsWith('./')) rel = rel.slice(2)
        if (rel.endsWith('/') && rel.length > 1) rel = rel.slice(0, -1)
        if (rel === '') rel = '.'
        return { rel, rawHadTrailingSlash }
      }

      const { rel, rawHadTrailingSlash } = normalizeRel(relativePath)
      const targetAbs = path.resolve(projectRoot, rel)
      if (!(await fs.pathExists(targetAbs))) {
        process.stdout.write('N/A\n')
        process.exit(0)
        return
      }

      const stat = await fs.stat(targetAbs)
      const isDir = stat.isDirectory() || rawHadTrailingSlash || rel === '.'

      let mdRel: string
      if (isDir) {
        mdRel =
          rel === '.'
            ? path.posix.join(DEFAULT_OUTPUT_DIR, 'index.md')
            : path.posix.join(DEFAULT_OUTPUT_DIR, rel, 'index.md')
      } else {
        const parsed = path.posix.parse(rel)
        const dirPart = parsed.dir
        const name = `${parsed.base}.md`
        mdRel = dirPart ? path.posix.join(DEFAULT_OUTPUT_DIR, dirPart, name) : path.posix.join(DEFAULT_OUTPUT_DIR, name)
      }

      const mdAbs = path.resolve(projectRoot, mdRel)
      if (await fs.pathExists(mdAbs)) {
        process.stdout.write(mdRel + '\n')
      } else {
        process.stdout.write('N/A\n')
      }
      process.exit(0);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Resolve failed: ${msg}\n`);
      process.exit(1);
    }
  });

// 全局错误处理
program.showSuggestionAfterError();
program.configureHelp({
  sortSubcommands: true,
  sortOptions: true,
});

// 解析命令行参数
program.parseAsync(process.argv).catch((error) => {
  console.error(pc.red(`\nExecution failed: ${error.message}`));
  process.exit(1);
});
