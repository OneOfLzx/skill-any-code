import ignore, { Ignore } from 'ignore'
import * as fs from 'fs-extra'
import * as path from 'path'
import { IBlacklistService } from '../domain/interfaces'

export class BlacklistService implements IBlacklistService {
  private ig: Ignore = ignore()

  async load(globalBlacklist: string[], projectRoot: string): Promise<void> {
    this.ig = ignore()

    this.ig.add(globalBlacklist)

    const projectIgnorePath = path.join(projectRoot, '.skill-any-code-ignore')
    if (await fs.pathExists(projectIgnorePath)) {
      const content = await fs.readFile(projectIgnorePath, 'utf-8')
      this.ig.add(content)
    }

    const gitignorePath = path.join(projectRoot, '.gitignore')
    if (await fs.pathExists(gitignorePath)) {
      const content = await fs.readFile(gitignorePath, 'utf-8')
      this.ig.add(content)
    }
  }

  isIgnored(relativePath: string): boolean {
    // 1. 统一为正斜杠（Windows path.relative 可能返回反斜杠）
    let normalized = relativePath.replace(/\\/g, '/')
    // 2. 去掉 leading ./ 或 /（ignore 库拒绝此类路径并抛错，见 REGEX_TEST_INVALID_PATH）
    // path.relative 在部分 Windows 场景下可能返回 ".\" 前缀，归一化后为 "./"，会导致 ignore 库抛出 RangeError
    normalized = normalized.replace(/^\.\//, '').replace(/^\/+/, '')
    // ignore 库不接受空字符串路径；空路径表示“项目根自身”，这里视为不忽略
    if (!normalized) return false
    return this.ig.ignores(normalized)
  }
}
