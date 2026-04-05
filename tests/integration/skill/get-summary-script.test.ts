/**
 * V2.6 get-summary Python 脚本集成测试：
 * - 校验部署后的脚本可执行
 * - 校验路径兼容（./ 前缀、反斜杠、目录尾斜杠）
 * - 校验不存在时输出 N/A
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs-extra'
import * as path from 'path'
import { startMockOpenAIServer } from '../../utils/mock-openai-server'
import { createTestProject, mkdtemp } from '../../utils/create-test-project'
import { createTestConfigInDir } from '../../utils/test-config-helper'

const execAsync = promisify(exec)

describe('get-summary.py Python 脚本集成测试 (V26)', () => {
  let testDir: string
  let tempHome: string
  let mock: { baseUrl: string; close: () => Promise<void> }
  const repoRoot = path.join(__dirname, '../../../')

  beforeAll(async () => {
    await execAsync('npm run build', { cwd: repoRoot })
  })

  beforeEach(async () => {
    testDir = mkdtemp('skill-any-code-get-summary')
    tempHome = mkdtemp('skill-any-code-get-summary-config')
    mock = await startMockOpenAIServer()
    await createTestConfigInDir(tempHome, {
      llmBaseUrl: mock.baseUrl,
      llmApiKey: 'test',
      llmModel: 'mock',
    })
    await createTestProject(testDir, {
      files: ['src/index.ts', 'src/utils/helper.ts'],
      directories: ['src', 'src/utils'],
    })
  })

  afterEach(async () => {
    await mock.close()
    await fs.remove(testDir).catch(() => {})
    await fs.remove(tempHome).catch(() => {})
  })

  const execEnv = () => ({ HOME: tempHome, USERPROFILE: tempHome })

  it('脚本命中时输出 md 相对路径，不存在时输出 N/A', async () => {
    // 生成解析结果 + skills
    await execAsync(
      `node dist/cli.js --path "${testDir}" --mode full --llm-base-url ${mock.baseUrl} --llm-api-key test --llm-max-retries 0`,
      { cwd: repoRoot, env: { ...process.env, ...execEnv() } },
    )

    const skillDir = path.join(testDir, '.agents', 'skills', 'skill-any-code')
    const scriptPath = path.join(skillDir, 'scripts', 'get-summary.py')
    expect(await fs.pathExists(scriptPath)).toBe(true)

    const run = async (input: string) => {
      const { stdout, stderr } = await execAsync(`python "${scriptPath}" "${input}"`, { cwd: testDir })
      expect(stderr).toBe('')
      return stdout.trim()
    }

    // 文件：标准写法
    const out1 = await run('src/index.ts')
    expect(out1).toBe('.skill-any-code-result/src/index.ts.md')
    expect(await fs.pathExists(path.join(testDir, out1.replace(/\//g, path.sep)))).toBe(true)

    // 文件：./ 前缀 + 反斜杠
    const out2 = await run('.\\src\\utils\\helper.ts')
    expect(out2).toBe('.skill-any-code-result/src/utils/helper.ts.md')

    // 目录：尾斜杠
    const out3 = await run('src/utils/')
    expect(out3).toBe('.skill-any-code-result/src/utils/index.md')

    // 不存在
    const out4 = await run('src/not-exist.ts')
    expect(out4).toBe('N/A')
  }, 60000)
})

