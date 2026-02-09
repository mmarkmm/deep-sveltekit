import { readdir, readFile, stat } from 'fs/promises';
import { join, relative, extname, resolve } from 'path';

const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.svelte']);

const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', '.svelte-kit',
  '.next', 'coverage', 'vendor', '__pycache__', '.turbo',
  '.output', '.nuxt', '.cache'
];

function parseGitignore(content) {
  const patterns = [];
  const negations = new Set();

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // negation patterns (e.g., !.env.example)
    if (line.startsWith('!')) {
      negations.add(line.slice(1).replace(/\/+$/, '').replace(/^\/+/, ''));
      continue;
    }

    let p = line.replace(/\/+$/, '');
    // leading / means root-relative only — store as-is with a flag
    const rootOnly = p.startsWith('/');
    if (rootOnly) p = p.slice(1);

    patterns.push({ pattern: p, rootOnly });
  }

  return { patterns, negations };
}

function matchSegment(relativePath, name, pattern, rootOnly) {
  // exact name match (directory or file name)
  if (pattern === name) return true;

  // handle wildcards
  if (pattern.includes('*')) {
    const regex = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*\*/g, '{{GLOBSTAR}}').replace(/\*/g, '[^/]*').replace(/\{\{GLOBSTAR\}\}/g, '.*') + '$'
    );
    if (regex.test(name) || regex.test(relativePath)) return true;
  }

  // path-segment matching: pattern must match a complete directory segment
  if (pattern.includes('/')) {
    // pattern with / is a path pattern — match against relative path
    if (rootOnly) {
      return relativePath === pattern || relativePath.startsWith(pattern + '/');
    }
    return relativePath.includes(pattern + '/') || relativePath.endsWith(pattern)
      || relativePath === pattern;
  }

  // simple name: match any path segment exactly
  if (rootOnly) {
    // root-only: first segment must match
    return relativePath.split('/')[0] === pattern;
  }

  // match any segment in the path
  const segments = relativePath.split('/');
  return segments.includes(pattern);
}

function shouldIgnore(relativePath, name, ignorePatterns) {
  const { patterns, negations } = ignorePatterns;

  // check against default ignores (exact segment match, not substring)
  if (DEFAULT_IGNORE.includes(name)) return true;
  if (name.startsWith('.') && name !== '.') return true;

  // check negations first — if file is explicitly un-ignored, allow it
  if (negations.has(name) || negations.has(relativePath)) return false;

  for (const { pattern, rootOnly } of patterns) {
    if (matchSegment(relativePath, name, pattern, rootOnly)) return true;
  }
  return false;
}

async function loadGitignore(rootDir) {
  try {
    const content = await readFile(join(rootDir, '.gitignore'), 'utf-8');
    return parseGitignore(content);
  } catch {
    return { patterns: [], negations: new Set() };
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
