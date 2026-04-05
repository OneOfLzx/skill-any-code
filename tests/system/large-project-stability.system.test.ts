import path from 'path'
import fs from 'fs-extra'
import os from 'os'

import { startMockOpenAIServer } from '../utils/mock-openai-server'
import { createTestConfigInDir } from '../utils/test-config-helper'
import { createLargeFixtureProject, mkdtempLargeProjectDir } from '../utils/large-project'

describe('System test: 大项目解析稳定性（问题6：Node 堆 OOM/crash 防回归）', () => {
  const repoRoot = path.join(__dirname, '../..')
  const distApp = path.join(repoRoot, 'dist', 'application', 'analysis.app.service.js')
  const distOk = fs.pathExistsSync(distApp)

  beforeAll(() => {
    if (!distOk) {
      if (process.env.ALLOW_SKIP_DIST_E2E === '1') {
        // eslint-disable-next-line no-console
        console.warn('[IT-LARGE-PROJECT-STABILITY] dist app missing, skipping due to ALLOW_SKIP_DIST_E2E=1')
        return
      }
      throw new Error('dist application missing; run build before system tests (or set ALLOW_SKIP_DIST_E2E=1)')
    }
  })

  const itWithDist = distOk ? it : it.skip

  itWithDist(
    'IT-LARGE-PROJECT-STABILITY-001: 200~400 文件规模解析应成功返回且不抛异常',
    async () => {
      const projectRoot = mkdtempLargeProjectDir('ca-large-system')
      const mock = await startMockOpenAIServer()
      const tempHome = path.join(os.tmpdir(), `ca-large-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      const originalHome = process.env.HOME
      const originalUserProfile = process.env.USERPROFILE

      try {
        await fs.ensureDir(tempHome)
        await createTestConfigInDir(tempHome, {
          llmBaseUrl: mock.baseUrl,
          llmApiKey: 'test',
          llmModel: 'mock',
          cacheEnabled: false,
          cacheMaxSizeMb: 0,
        })
        process.env.HOME = tempHome
        process.env.USERPROFILE = tempHome

        await createLargeFixtureProject(projectRoot, {
          modules: 10,
          depth: 4,
          branching: 1,
          filesPerDir: 5,
          totalFilesTarget: 220,
          ext: '.ts',
        })

        // dist 版服务与 dist/worker 脚本路径匹配，避免 workerpool 在 TS 源码路径下找不到依赖。
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { AnalysisAppService } = require('../../dist/application/analysis.app.service')
        const app = new AnalysisAppService()
        const res = await app.runAnalysis({
          path: projectRoot,
          mode: 'full',
          force: true,
          concurrency: 4,
          noSkills: true,
          llmConfig: {
            base_url: mock.baseUrl,
            api_key: 'test',
            model: 'mock',
            temperature: 0.1,
            max_tokens: 1000,
            timeout: 2000,
            max_retries: 0,
            retry_delay: 1,
            context_window_size: 1000,
            cache_enabled: false,
            cache_dir: path.join(projectRoot, '.cache'),
            cache_max_size_mb: 0,
          },
        } as any)

        if (!res.success) {
          throw new Error(`runAnalysis failed: ${JSON.stringify(res, null, 2)}`)
        }
        expect(res.success).toBe(true)
        expect(res.data?.analyzedFilesCount).toBeGreaterThan(100)
      } finally {
        process.env.HOME = originalHome
        process.env.USERPROFILE = originalUserProfile
        await mock.close()
        await fs.remove(projectRoot).catch(() => {})
        await fs.remove(tempHome).catch(() => {})
      }
    },
    300000,
  )

  // 预留：未来引入更严格的资源保护（token 上限/限流）后，这里可断言“优雅失败”而非进程崩溃。
  test.todo('IT-LARGE-PROJECT-STABILITY-002: 触发资源保护时应优雅失败并给出可操作提示')
})

