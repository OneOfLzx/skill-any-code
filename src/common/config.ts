import fs from 'fs-extra';
import yaml from 'js-yaml';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { DEFAULT_CONCURRENCY, DEFAULT_OUTPUT_DIR } from './constants';
import { logger } from './logger';
import { AppError, ErrorCode } from './errors';

// V2.5：全局黑名单默认值（.gitignore 语法）
const DEFAULT_BLACKLIST = [
  '*.yml', '*.yaml', '*.ini', '*.cfg', '*.json', '*.toml',
  '*.md', '*.txt', '*.rst',
  'README*', 'LICENSE*', 'CHANGELOG*',
  '*.lock', 'package-lock.json', 'yarn.lock',
  '*.env*', 'credentials.*', '*.pem', '*.key',
  // 图片与图标等常见二进制资源（需求文档 13.3 / 测试文档 16.6）
  '*.png', '*.jpg', '*.jpeg', '*.gif',
  '*.bmp', '*.svg', '*.webp', '*.ico',
  'docs/', 'dist/', 'build/', 'coverage/',
  'node_modules/', '.git/', '.skill-any-code-result/',
  '.agents/', '.claude/', '.gitignore', '.vscode/',
  '*.xml', '*.so', '*.bin'
];

const DEFAULT_PROVIDERS = ['opencode', 'cursor', 'claude', 'codex'];

const ConfigSchema = z.object({
  global: z.object({
    log_level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    output_format: z.enum(['text', 'json', 'markdown']).default('text'),
    auto_confirm: z.boolean().default(false),
    output_dir: z.string().default(DEFAULT_OUTPUT_DIR),
  }).default({}),
  analyze: z.object({
    default_mode: z.enum(['full', 'incremental', 'auto']).default('auto'),
    /**
     * 最大并发数上限：
     * - 实际默认并发 = CPU核心数 * 2；
     * - 若 CPU*2 > max_concurrency，则使用 max_concurrency 作为上限。
     */
    max_concurrency: z.number().default(16),
    default_depth: z.number().default(-1),
    // 单文件大小上限（bytes）；超过后在项目扫描模式中跳过解析
    max_file_size_bytes: z.number().int().positive().default(700 * 1024),
    blacklist: z.array(z.string()).default(DEFAULT_BLACKLIST),
  }).default({}),
  skills: z.object({
    default_providers: z.array(z.string()).default(DEFAULT_PROVIDERS),
  }).default({}),
  llm: z.object({
    // V2.5：默认配置中不再内置具体远程服务与模型，避免误上传代码（需求文档 13.4.1）
    base_url: z.string().default(''),
    api_key: z.string().default(''),
    model: z.string().default(''),
    temperature: z.number().min(0).max(2).default(0.1),
    max_tokens: z.number().int().min(100).default(4000),
    timeout: z.number().int().min(1000).default(60000),
    max_retries: z.number().int().min(0).default(3),
    retry_delay: z.number().int().min(100).default(1000),
    context_window_size: z.number().int().min(1000).default(700 * 1024),
    cache_enabled: z.boolean().default(true),
    cache_dir: z.string().default('~/.cache/skill-any-code/llm'),
    // V2.5：新增缓存容量上限（MB），0 表示禁用磁盘缓存（需求文档 13.5.2）
    cache_max_size_mb: z.number().int().min(0).default(50),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

class ConfigManager {
  private config: Config | null = null;
  private configPath: string = '';

  private getDefaultConfigPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, '.config', 'skill-any-code', 'config.yaml');
  }

  private expandTilde(pathStr: string): string {
    if (pathStr.startsWith('~') && (pathStr.length === 1 || pathStr[1] === '/' || pathStr[1] === '\\')) {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      return path.join(home, pathStr.slice(1));
    }
    return pathStr;
  }

  /**
   * 加载配置文件。
   *
   * V2.5 起，当目标配置文件不存在时：
   * - 不再自动创建磁盘文件（由 init 子命令负责）；
   * - 抛出带有 ErrorCode.CONFIG_NOT_INITIALIZED 的 AppError，表示「配置未初始化」，
   *   由 CLI 层捕获并提示用户先执行 init（测试文档 16.3 / 16.1.1）。
   */
  async load(customPath?: string): Promise<Config> {
    this.configPath = customPath ? this.expandTilde(customPath) : this.getDefaultConfigPath();

    // 1. 加载默认配置（作为解析/校验基线）
    let config = ConfigSchema.parse({});

    // 2. 加载配置文件；不存在时交由上层处理「未初始化」状态
    if (await fs.pathExists(this.configPath)) {
      try {
        const fileContent = await fs.readFile(this.configPath, 'utf-8');
        const fileConfig = yaml.load(fileContent) as Record<string, unknown>;
        config = ConfigSchema.parse(fileConfig);
        logger.debug(`Loaded config file: ${this.configPath}`);
      } catch (error) {
        logger.warn(`Failed to parse config file. Using defaults: ${(error as Error).message}`);
      }
    } else {
      // 配置文件不存在：不再隐式创建，由 CLI 的 init 子命令负责初始化
      const defaultConfig = ConfigSchema.parse({});
      this.config = defaultConfig;
      throw new AppError(
        ErrorCode.CONFIG_NOT_INITIALIZED,
        `Config is not initialized: ${this.configPath}`,
      );
    }

    // 3. 加载环境变量
    const envConfig: any = {};
    Object.entries(process.env).forEach(([key, value]) => {
      if (!key.startsWith('SKILL_ANY_CODE_')) return;
      const configKey = key.replace('SKILL_ANY_CODE_', '').toLowerCase();
      
      if (!envConfig.global) envConfig.global = {};
      if (configKey === 'log_level' && value) envConfig.global.log_level = value;
      if (configKey === 'output_format' && value) envConfig.global.output_format = value;
      if (configKey === 'auto_confirm' && value) envConfig.global.auto_confirm = value === 'true';
      if (configKey === 'output_dir' && value) envConfig.global.output_dir = value;
      
      if (!envConfig.analyze) envConfig.analyze = {};
      if (configKey === 'analyze_default_mode' && value) envConfig.analyze.default_mode = value;
      if (configKey === 'analyze_max_concurrency' && value) envConfig.analyze.max_concurrency = Number(value);
      if (configKey === 'analyze_default_depth' && value) envConfig.analyze.default_depth = Number(value);
      if (configKey === 'analyze_max_file_size_bytes' && value) {
        envConfig.analyze.max_file_size_bytes = Number(value);
      }

      if (!envConfig.skills) envConfig.skills = {};
      if (configKey === 'skills_default_providers' && value) {
        envConfig.skills.default_providers = value.split(',').map((s: string) => s.trim());
      }

      if (!envConfig.llm) envConfig.llm = {};
      if (configKey === 'llm_base_url' && value) envConfig.llm.base_url = value;
      if (configKey === 'llm_api_key' && value) envConfig.llm.api_key = value;
      if (configKey === 'llm_model' && value) envConfig.llm.model = value;
      if (configKey === 'llm_temperature' && value) envConfig.llm.temperature = Number(value);
      if (configKey === 'llm_max_tokens' && value) envConfig.llm.max_tokens = Number(value);
      if (configKey === 'llm_timeout' && value) envConfig.llm.timeout = Number(value);
      if (configKey === 'llm_max_retries' && value) envConfig.llm.max_retries = Number(value);
      if (configKey === 'llm_retry_delay' && value) envConfig.llm.retry_delay = Number(value);
      if (configKey === 'llm_context_window_size' && value) envConfig.llm.context_window_size = Number(value);
      if (configKey === 'llm_cache_enabled' && value) envConfig.llm.cache_enabled = value === 'true';
      if (configKey === 'llm_cache_dir' && value) envConfig.llm.cache_dir = value;
      if (configKey === 'llm_cache_max_size_mb' && value) envConfig.llm.cache_max_size_mb = Number(value);
    });

    // 注意：配置为嵌套对象，环境变量覆盖需要做“深合并”，否则只设置某个 llm 子字段
    // 会导致整个 llm 段被浅覆盖成不完整对象（从而触发 LLM_INVALID_CONFIG）。
    config = ConfigSchema.parse({
      ...config,
      global: { ...config.global, ...(envConfig.global ?? {}) },
      analyze: { ...config.analyze, ...(envConfig.analyze ?? {}) },
      skills: { ...config.skills, ...(envConfig.skills ?? {}) },
      llm: { ...config.llm, ...(envConfig.llm ?? {}) },
    });

    this.config = config;
    return config;
  }

  getConfig(): Config {
    if (!this.config) {
      throw new Error('Config not loaded. Call load() first.');
    }
    return this.config;
  }

  /**
   * 显式初始化配置文件内容。
   *
   * - 当目标文件不存在时：创建目录并写入默认配置；
   * - 当目标文件已存在时：直接覆盖为默认配置（是否覆盖由上层 CLI 交互确认）。
   */
  async init(customPath?: string): Promise<void> {
    this.configPath = customPath ? this.expandTilde(customPath) : this.getDefaultConfigPath();
    const defaultConfig = ConfigSchema.parse({});

    await fs.ensureDir(path.dirname(this.configPath));
    await fs.writeFile(this.configPath, yaml.dump(defaultConfig), 'utf-8');
    this.config = defaultConfig;
    logger.debug(`Initialized config file: ${this.configPath}`);
  }

  async save(config: Partial<Config>): Promise<void> {
    const currentConfig = this.config || await this.load();
    const mergedConfig = { ...currentConfig, ...config };
    const validatedConfig = ConfigSchema.parse(mergedConfig);
    
    await fs.ensureDir(path.dirname(this.configPath));
    await fs.writeFile(this.configPath, yaml.dump(validatedConfig), 'utf-8');
    this.config = validatedConfig;
  }

  async reset(): Promise<void> {
    const defaultConfig = ConfigSchema.parse({});
    await this.save(defaultConfig);
  }
}

export const configManager = new ConfigManager();
