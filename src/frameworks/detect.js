import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { readdir } from 'fs/promises';

const SVELTEKIT_CONFIGS = ['svelte.config.js', 'svelte.config.ts'];

async function readPackageJson(rootDir) {
  let dir = rootDir;
  for (let i = 0; i < 5; i++) {
    try {
      const raw = await readFile(join(dir, 'package.json'), 'utf-8');
      return JSON.parse(raw);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function hasSvelteKitConfig(files) {
  const paths = new Set(files.map(f => f.path));
  return SVELTEKIT_CONFIGS.some(cfg => paths.has(cfg));
}

async function checkParentDirs(rootDir) {
  let dir = dirname(rootDir);
  for (let i = 0; i < 3; i++) {
    try {
      const entries = await readdir(dir);
      if (SVELTEKIT_CONFIGS.some(c => entries.includes(c))) {
        return true;
      }
    } catch { break; }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

export async function detectFramework(rootDir, files) {
  const pkg = await readPackageJson(rootDir);

  // Check for svelte.config.js in scanned files or parent directories
  const isSvelteKit = hasSvelteKitConfig(files) || await checkParentDirs(rootDir);

  if (isSvelteKit) {
    const version = pkg?.dependencies?.['@sveltejs/kit']
      || pkg?.devDependencies?.['@sveltejs/kit'];
    return { name: 'sveltekit', version: version || undefined, config: pkg };
  }

  // Check package.json for svelte (without kit)
  const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (allDeps?.['svelte']) {
    return { name: 'svelte', version: allDeps['svelte'], config: pkg };
  }

  return { name: 'generic', config: pkg };
}
