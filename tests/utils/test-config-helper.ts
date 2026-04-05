/**
 * V2.5 测试配置辅助：创建可用的配置文件，避免"配置文件未初始化"导致测试失败
 * 所有调用 CLI analyze/config/resolve 的测试应在 setup 中先创建配置
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface TestConfigOptions {
  /** Mock LLM 服务 baseUrl，传入后写入 llm.base_url */
  llmBaseUrl?: string;
  /** Mock 场景下 api_key，默认 "test" */
  llmApiKey?: string;
  /** Mock 场景下 model，默认 "mock" */
  llmModel?: string;
  /** 缓存禁用（测试常用） */
  cacheEnabled?: boolean;
  /** cache_max_size_mb，cacheEnabled=false 时可设 0 */
  cacheMaxSizeMb?: number;
}

const DEFAULT_CONFIG_YAML = `global:
  log_level: info
  output_format: text
  auto_confirm: false
  output_dir: ./.skill-any-code-result
analyze:
  default_mode: auto
  default_concurrency: 4
  default_depth: -1
  blacklist:
    - "*.yml"
    - "*.yaml"
    - "*.md"
    - "*.env*"
    - "credentials.*"
    - "node_modules/"
    - ".git/"
    - ".skill-any-code-result/"
skills:
  default_providers:
    - opencode
    - cursor
    - claude
llm:
  base_url: ""
  api_key: ""
  model: ""
  temperature: 0.1
  max_tokens: 4000
  timeout: 60000
  max_retries: 0
  retry_delay: 1000
  context_window_size: 128000
  cache_enabled: true
  cache_dir: "~/.cache/skill-any-code/llm"
  cache_max_size_mb: 500
`;

/**
 * 创建临时配置文件并写入完整 YAML，返回配置文件路径
 * @param llmBaseUrl 若传入，则写入 llm.base_url（用于 Mock 服务器）
 */
export async function createTestConfig(
  options: TestConfigOptions = {}
): Promise<{ configPath: string; tempDir: string }> {
  const tempDir = path.join(os.tmpdir(), `sac-test-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.ensureDir(tempDir);
  const configPath = path.join(tempDir, 'config.yaml');

  let yaml = DEFAULT_CONFIG_YAML;
  if (options.llmBaseUrl !== undefined) {
    yaml = yaml.replace('base_url: ""', `base_url: "${options.llmBaseUrl}"`);
  }
  if (options.llmApiKey !== undefined) {
    yaml = yaml.replace('api_key: ""', `api_key: "${options.llmApiKey}"`);
  }
  if (options.llmModel !== undefined) {
    yaml = yaml.replace('model: ""', `model: "${options.llmModel}"`);
  }
  if (options.cacheEnabled === false) {
    yaml = yaml.replace('cache_enabled: true', 'cache_enabled: false');
  }
  if (options.cacheMaxSizeMb !== undefined) {
    yaml = yaml.replace('cache_max_size_mb: 500', `cache_max_size_mb: ${options.cacheMaxSizeMb}`);
  }

  await fs.writeFile(configPath, yaml, 'utf-8');
  return { configPath, tempDir };
}

/**
 * 在指定目录下创建 config（用于 HOME 覆盖场景）
 */
export async function createTestConfigInDir(
  dir: string,
  options: TestConfigOptions = {}
): Promise<string> {
  const configDir = path.join(dir, '.config', 'skill-any-code');
  await fs.ensureDir(configDir);
  const configPath = path.join(configDir, 'config.yaml');

  let yaml = DEFAULT_CONFIG_YAML;
  if (options.llmBaseUrl !== undefined) {
    yaml = yaml.replace('base_url: ""', `base_url: "${options.llmBaseUrl}"`);
  }
  if (options.llmApiKey !== undefined) {
    yaml = yaml.replace('api_key: ""', `api_key: "${options.llmApiKey}"`);
  }
  if (options.llmModel !== undefined) {
    yaml = yaml.replace('model: ""', `model: "${options.llmModel}"`);
  }
  if (options.cacheEnabled === false) {
    yaml = yaml.replace('cache_enabled: true', 'cache_enabled: false');
  }
  if (options.cacheMaxSizeMb !== undefined) {
    yaml = yaml.replace('cache_max_size_mb: 500', `cache_max_size_mb: ${options.cacheMaxSizeMb}`);
  }

  await fs.writeFile(configPath, yaml, 'utf-8');
  return configPath;
}

/** LLM 覆盖参数 */
export interface LlmOverrides {
  base_url: string;
  api_key?: string;
  model?: string;
}

/**
 * 在指定路径创建配置文件，并注入 LLM 覆盖（用于 Mock 服务器）
 */
export async function createTestConfigWithLlm(
  configPath: string,
  overrides: LlmOverrides
): Promise<void> {
  await fs.ensureDir(path.dirname(configPath));
  let yaml = DEFAULT_CONFIG_YAML;
  yaml = yaml.replace('base_url: ""', `base_url: "${overrides.base_url}"`);
  yaml = yaml.replace('api_key: ""', `api_key: "${overrides.api_key ?? 'test'}"`);
  yaml = yaml.replace('model: ""', `model: "${overrides.model ?? 'mock'}"`);
  await fs.writeFile(configPath, yaml, 'utf-8');
}
