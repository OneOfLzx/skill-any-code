import * as fs from 'fs-extra'
import * as path from 'path'
import { ISkillGenerator, SkillGenerateOptions, SkillProvider } from '../../domain/interfaces'
import { getSkillMdContent } from './templates/skill.md.template'
import { getResolveScriptContent } from './templates/resolve.script'
import { logger } from '../../common/logger'

const PROVIDER_DIRECTORY_MAP: Record<SkillProvider, string> = {
  opencode: '.agents/skills/skill-any-code',
  cursor: '.agents/skills/skill-any-code',
  codex: '.agents/skills/skill-any-code',
  claude: '.claude/skills/skill-any-code',
}

export class SkillGenerator implements ISkillGenerator {
  async generate(options: SkillGenerateOptions): Promise<string[]> {
    const { projectRoot, providers } = options
    const deployedPaths: string[] = []

    const uniqueDirs = new Set<string>()
    for (const p of providers) {
      const lowerProvider = p.toLowerCase() as SkillProvider
      const dir = PROVIDER_DIRECTORY_MAP[lowerProvider]
      if (dir) {
        uniqueDirs.add(dir)
      } else {
        logger.warn(`Unknown provider: ${p}. Skipped.`)
      }
    }

    const skillMd = getSkillMdContent()
    const resolveScript = getResolveScriptContent()

    for (const relativeDir of uniqueDirs) {
      const targetDir = path.join(projectRoot, relativeDir)
      try {
        await fs.ensureDir(targetDir)
        await fs.ensureDir(path.join(targetDir, 'scripts'))

        await fs.writeFile(path.join(targetDir, 'SKILL.md'), skillMd, 'utf-8')
        await fs.writeFile(path.join(targetDir, 'scripts', 'get-summary.py'), resolveScript, 'utf-8')

        deployedPaths.push(targetDir)
        logger.debug(`Skill deployed to: ${targetDir}`)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        logger.warn(`Failed to deploy skill (${targetDir}): ${msg}`)
      }
    }

    return deployedPaths
  }
}
