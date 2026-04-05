import * as fs from 'fs-extra';
import * as path from 'path';

export type E2ELLMMood = 'mock' | 'real';

const E2E_LLM_MODE_ENV = 'SKILL_ANY_CODE_E2E_LLM_MODE';

export function getE2ELLMMood(): { mode: E2ELLMMood; useMockLLM: boolean } {
  const raw = (process.env[E2E_LLM_MODE_ENV] || 'mock').toLowerCase().trim();
  const mode: E2ELLMMood = raw === 'real' ? 'real' : 'mock';
  return {
    mode,
    useMockLLM: mode !== 'real',
  };
}

export async function loadE2EApiKey(
  projectRoot: string,
): Promise<string | null> {
  const keyFile = path.join(projectRoot, 'tests', 'priv_data', 'api_key.txt');

  if (!(await fs.pathExists(keyFile))) {
    return null;
  }

  const content = await fs.readFile(keyFile, 'utf-8');
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  return lines[0] || null;
}

