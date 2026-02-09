const CONFIG_PATTERNS = /\.(config|rc)\.(js|ts|mjs|cjs)$|\.eslintrc|\.prettierrc|tailwind|postcss|vite\.config/;
const TEST_PATTERNS = /\.(test|spec|e2e)\.(js|ts|jsx|tsx)$|__tests__/;
const ROUTE_PATTERNS = /\+page\.|\/\+server\.|\/\+layout\.|\/\+error\.|\/page\.(tsx|jsx)|\/route\.(ts|js)|\/layout\.(tsx|jsx)/;

export function findDeadExports(graph, analyzedFiles) {
  // build a map of what's imported from where
  const importedSpecifiers = new Map(); // file -> Set of imported names

  for (const edge of graph.edges) {
    if (edge.external) continue;

    if (!importedSpecifiers.has(edge.target)) {
      importedSpecifiers.set(edge.target, new Set());
    }

    const specs = importedSpecifiers.get(edge.target);
    for (const s of edge.specifiers) {
      // specifiers can be objects { local, imported, type } or strings
      const name = typeof s === 'object' ? (s.imported || s.local || '*') : s;
      specs.add(name);
    }

    // if there are no specific specifiers, assume everything is used
    // (e.g., import * as X or side-effect import)
    if (edge.specifiers.length === 0) {
      specs.add('*');
    }
  }

  const deadExports = [];
  const orphanFiles = [];

  for (const file of analyzedFiles) {
    const exports = file.exports || [];
    if (!exports.length) continue;

    // skip files that shouldn't be flagged
    if (isEntryPoint(file.path)) continue;

    const imported = importedSpecifiers.get(file.path);

    // if nothing imports this file at all, it might be orphan
    if (!imported) {
      // but only flag as dead exports if it's not a route/config/test
      for (const exp of exports) {
        deadExports.push({
          file: file.path,
          export: exp.name,
          type: exp.type || 'named',
          line: exp.line,
        });
      }
      continue;
    }

    // wildcard import means everything is used
    if (imported.has('*')) continue;

    // Svelte components: if default-imported, named exports are component methods
    // accessible via bind:this (e.g., component.attach()) - treat all as used
    if (file.path.endsWith('.svelte') && imported.has('default')) continue;

    // check each export
    for (const exp of exports) {
      const name = exp.name;
      if (name === 'default' && imported.has('default')) continue;
      if (imported.has(name)) continue;

      deadExports.push({
        file: file.path,
        export: name,
        type: exp.type || 'named',
        line: exp.line,
      });
    }
  }

  return { deadExports, orphanFiles };
}

export function findOrphanFiles(graph, analyzedFiles, routes = []) {
  // files imported by at least one other file
  const imported = new Set();
  for (const edge of graph.edges) {
    if (!edge.external) {
      imported.add(edge.target);
    }
  }

  const routeFiles = new Set(routes.map(r => r.file));
  const orphans = [];

  for (const file of analyzedFiles) {
    if (imported.has(file.path)) continue;
    if (isEntryPoint(file.path)) continue;
    if (routeFiles.has(file.path)) continue;

    let reason = 'Not imported by any other file';
    if (file.exports?.length === 0) {
      reason = 'No exports and not imported';
    }

    orphans.push({ file: file.path, reason });
  }

  return orphans;
}

function isEntryPoint(filePath) {
  if (CONFIG_PATTERNS.test(filePath)) return true;
  if (TEST_PATTERNS.test(filePath)) return true;
  if (ROUTE_PATTERNS.test(filePath)) return true;
  // TypeScript declaration files are not regular code
  if (filePath.endsWith('.d.ts')) return true;
  // SvelteKit: all .svelte files under routes/ are entry points
  if (filePath.match(/routes\//) && filePath.endsWith('.svelte')) return true;
  // SvelteKit: all +page.server, +layout.server, +server files
  if (filePath.match(/\+page\.server\.|^\+layout\.server\./)) return true;
  // hooks files
  if (filePath.match(/hooks\.(server|client)\.(js|ts)$/)) return true;
  if (filePath.match(/^(bin|scripts)\//)) return true;
  if (filePath.match(/(^|\/)index\.(js|ts|mjs)$/)) return true;
  if (filePath.match(/^(src\/)?(main|app|server)\.(js|ts|mjs)$/)) return true;
  return false;
}
