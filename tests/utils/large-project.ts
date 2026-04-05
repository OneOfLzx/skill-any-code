import fs from 'fs-extra'
import path from 'path'
import os from 'os'

export type CreateLargeFixtureProjectOptions = {
  /**
   * 顶层模块数量（src/modules/mod0..）
   * 建议 6~16，避免目录过多导致 IO 变慢
   */
  modules: number
  /**
   * 每个模块的子目录深度（>=1）
   */
  depth: number
  /**
   * 每个目录的子目录数量（默认 2）。
   * 设为 1 可线性增长目录数量，避免指数膨胀导致过慢。
   */
  branching?: number
  /**
   * 每个目录写入多少个文件（可为 0）
   */
  filesPerDir: number
  /**
   * 目标总文件数（上限控制，避免 CI 慢/占用过多内存）
   */
  totalFilesTarget: number
  /**
   * 额外文件扩展名，默认 .ts
   */
  ext?: string
}

export type LargeProjectStats = {
  rootDir: string
  dirCount: number
  fileCount: number
}

export function mkdtempLargeProjectDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
}

/**
 * 构造一个“可控的大项目”fixture。
 * 目标：200~400 文件级别，目录层级与模块结构更接近真实仓库，但每个文件内容较小，避免 CI 真实 OOM。
 */
export async function createLargeFixtureProject(
  rootDir: string,
  options: CreateLargeFixtureProjectOptions,
): Promise<LargeProjectStats> {
  const { modules, depth, branching = 2, filesPerDir, totalFilesTarget, ext = '.ts' } = options
  if (modules < 1) throw new Error(`modules must be >= 1, got ${modules}`)
  if (depth < 1) throw new Error(`depth must be >= 1, got ${depth}`)
  if (branching < 1) throw new Error(`branching must be >= 1, got ${branching}`)
  if (filesPerDir < 0) throw new Error(`filesPerDir must be >= 0, got ${filesPerDir}`)
  if (totalFilesTarget < 1) throw new Error(`totalFilesTarget must be >= 1, got ${totalFilesTarget}`)

  await fs.ensureDir(rootDir)

  // 基础文件（非必需，但更接近真实项目结构）
  await fs.writeFile(
    path.join(rootDir, 'package.json'),
    JSON.stringify({ name: 'large-fixture-project', private: true, version: '0.0.0' }, null, 2),
    'utf-8',
  )
  await fs.ensureDir(path.join(rootDir, 'src'))
  await fs.writeFile(path.join(rootDir, 'src', `index${ext}`), `export const root = "ok";\n`, 'utf-8')

  const modulesRoot = path.join(rootDir, 'src', 'modules')
  await fs.ensureDir(modulesRoot)

  let dirCount = 0
  let fileCount = 0

  const writeFile = async (dir: string, relName: string, content: string) => {
    const abs = path.join(dir, relName)
    await fs.writeFile(abs, content, 'utf-8')
    fileCount++
  }

  const fileContent = (moduleId: number, level: number, dirId: string, i: number) =>
    [
      `export const moduleId = ${moduleId};`,
      `export const level = ${level};`,
      `export const dirId = "${dirId}";`,
      `export const idx = ${i};`,
      `export function ping() { return "${moduleId}-${level}-${dirId}-${i}"; }`,
      '',
    ].join(os.EOL)

  // BFS 生成目录，控制总量与层级
  type DirNode = { abs: string; moduleId: number; level: number; dirId: string }
  const queue: DirNode[] = []

  for (let m = 0; m < modules; m++) {
    const modDir = path.join(modulesRoot, `mod${m}`)
    await fs.ensureDir(modDir)
    dirCount++
    queue.push({ abs: modDir, moduleId: m, level: 1, dirId: `m${m}` })

    if (fileCount < totalFilesTarget) {
      await writeFile(modDir, `index${ext}`, `export * from "./public";\n`)
      if (fileCount < totalFilesTarget) {
        await writeFile(modDir, `public${ext}`, `export const name = "mod${m}";\n`)
      }
    }
  }

  while (queue.length > 0 && fileCount < totalFilesTarget) {
    const cur = queue.shift()!

    // 在当前目录写入少量文件
    for (let i = 0; i < filesPerDir && fileCount < totalFilesTarget; i++) {
      const name = `f_${cur.dirId}_l${cur.level}_i${i}${ext}`
      await writeFile(cur.abs, name, fileContent(cur.moduleId, cur.level, cur.dirId, i))
    }

    if (cur.level >= depth) continue

    for (let c = 0; c < branching; c++) {
      const childId = `${cur.dirId}_${cur.level}_${c}`
      const childAbs = path.join(cur.abs, `d${cur.level}_${c}`)
      await fs.ensureDir(childAbs)
      dirCount++
      queue.push({ abs: childAbs, moduleId: cur.moduleId, level: cur.level + 1, dirId: childId })
    }
  }

  return { rootDir, dirCount, fileCount }
}

