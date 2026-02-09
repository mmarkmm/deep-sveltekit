import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, extname, resolve } from 'path';

const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.svelte']);

const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', '.svelte-kit',
  '.next', 'coverage', 'vendor', '__pycache__', '.turbo',
  '.output', '.nuxt', '.cache'
];

function parseGitignore(content) {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(pattern => {
      // strip trailing slashes for directory matching
      let p = pattern.replace(/\/+$/, '');
      return p;
    });
}

function shouldIgnore(relativePath, name, ignorePatterns) {
  // check against default ignores first
  if (DEFAULT_IGNORE.includes(name)) return true;
  if (name.startsWith('.') && name !== '.') return true;

  for (const pattern of ignorePatterns) {
    // simple glob matching - covers most .gitignore patterns
    if (pattern === name) return true;
    if (relativePath.includes(pattern)) return true;

    // handle patterns with wildcards
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
      );
      if (regex.test(name) || regex.test(relativePath)) return true;
    }
  }
  return false;
}

async function loadGitignore(rootDir) {
  try {
    const content = await readFile(join(rootDir, '.gitignore'), 'utf-8');
    return parseGitignore(content);
  } catch {
    return [];
  }
}

async function walkDirectory(dir, rootDir, ignorePatterns, maxDepth, currentDepth = 0) {
  if (maxDepth !== undefined && currentDepth > maxDepth) return [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // permission denied, etc
  }

  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    if (shouldIgnore(relPath, entry.name, ignorePatterns)) continue;

    if (entry.isDirectory()) {
      const nested = await walkDirectory(fullPath, rootDir, ignorePatterns, maxDepth, currentDepth + 1);
      files.push(...nested);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      try {
        const content = await readFile(fullPath, 'utf-8');
        const fileStat = await stat(fullPath);
        files.push({
          path: relPath,
          fullPath: resolve(fullPath),
          extension: ext,
          content,
          size: fileStat.size,
          lines: content.split('\n').length
        });
      } catch {
        // skip unreadable files
      }
    }
  }

  return files;
}

export async function scanDirectory(directory, options = {}) {
  const rootDir = resolve(directory);
  const gitignorePatterns = await loadGitignore(rootDir);
  const maxDepth = options.depth;

  const files = await walkDirectory(rootDir, rootDir, gitignorePatterns, maxDepth);

  // sort by path for consistent output
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}
