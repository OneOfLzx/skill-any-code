import { z } from 'zod'

export const AnalyzeProjectCommandSchema = z.object({
  path: z.string().optional().describe('Project root path to analyze (default: current working directory)'),
  mode: z.enum(['full', 'incremental', 'auto']).default('auto').describe('Analysis mode'),
  depth: z.number().int().min(1).optional().describe('Max directory depth (-1 = unlimited)'),
  concurrency: z.number().int().min(1).optional().describe('Max concurrency (default: CPU cores * 2)'),
  outputDir: z.string().optional().describe('Output directory for analysis results'),
  skillsProviders: z.array(z.string()).optional().describe('AI tool providers to deploy the skill to'),
  noSkills: z.boolean().optional().describe('Skip skill generation')
})

export type AnalyzeProjectCommandParams = z.infer<typeof AnalyzeProjectCommandSchema>

export const ProjectCodeQuerySkillSchema = z.object({
  path: z.string().describe('Relative path of the file/directory from the project root'),
  type: z.enum(['summary', 'full', 'diagram']).default('summary').describe('Query type'),
  projectSlug: z.string().optional().describe('Project identifier (default: current project)')
})

export type ProjectCodeQuerySkillParams = z.infer<typeof ProjectCodeQuerySkillSchema>
