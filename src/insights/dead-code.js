const CONFIG_PATTERNS = /\.(config|rc)\.(js|ts|mjs|cjs)$|\.eslintrc|\.prettierrc|tailwind|postcss|vite\.config/;
const TEST_PATTERNS = /\.(test|spec|e2e)\.(js|ts|jsx|tsx)$|__tests__/;
const ROUTE_PATTERNS = /\+page\.|\/\+server\.|\/\+layout\.|\/\+error\.|\/page\.(tsx|jsx)|\/route\.(ts|js)|\/layout\.(tsx|jsx)/;

export function findDeadExports(graph, analyzedFiles) {
  // build a map of what's imported from where: file -> Set of imported names
  const importedSpecifiers = new Map();
  // also count how many files import each target
  const importerCount = new Map();

  for (const edge of graph.edges) {
    if (edge.external) continue;

    if (!importedSpecifiers.has(edge.target)) {
      importedSpecifiers.set(edge.target, new Set());
      importerCount.set(edge.target, new Set());
    }

    importerCount.get(edge.target).add(edge.source);

    const specs = importedSpecifiers.get(edge.target);
    for (const s of edge.specifiers) {
      const name = typeof s === 'object' ? (s.imported || s.local || '*') : s;
      specs.add(name);
    }

    // no specific specifiers = wildcard (import * as X, side-effect import)
    if (edge.specifiers.length === 0) {
      specs.add('*');
    }
  }

  const deadExports = [];

  for (const file of analyzedFiles) {
    const exports = file.exports || [];
    if (!exports.length) continue;

    // skip entry points — their exports face outward
    if (isEntryPoint(file.path)) continue;

    const imported = importedSpecifiers.get(file.path);

    // file not imported by anyone → belongs in orphans list, NOT here
    // dead exports only tracks exports within files that ARE part of the dependency graph
    if (!imported) continue;

    // wildcard import (import * as X) → everything is considered used
    if (imported.has('*')) continue;

    // Svelte components: default-imported → all named exports accessible via bind:this
    if (file.path.endsWith('.svelte') && imported.has('default')) continue;

    const usedCount = imported.size;
    const importers = importerCount.get(file.path)?.size || 0;

    for (const exp of exports) {
      const name = exp.name;

      // this export IS used
      if (name === 'default' && imported.has('default')) continue;
      if (imported.has(name)) continue;

      // `default` alongside used named exports = convenience alias, not dead code
      if (name === 'default' && usedCount > 0) continue;

      deadExports.push({
        file: file.path,
        export: name,
        type: exp.type || 'named',
        line: exp.line,
        importedBy: importers,
      });
    }
  }

  return { deadExports };
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

    orphans.push({
      file: file.path,
      reason,
      exports: (file.exports || []).length,
    });
  }

  return orphans;
}

function isEntryPoint(filePath) {
  if (CONFIG_PATTERNS.test(filePath)) return true;
  if (TEST_PATTERNS.test(filePath)) return true;
  if (ROUTE_PATTERNS.test(filePath)) return true;
  if (filePath.endsWith('.d.ts')) return true;
  // SvelteKit: .svelte files under routes/
  if (filePath.match(/routes\//) && filePath.endsWith('.svelte')) return true;
  // SvelteKit: +page.server, +layout.server, +server files
  if (filePath.match(/\+page\.server\.|^\+layout\.server\./)) return true;
  // hooks files
  if (filePath.match(/hooks\.(server|client)\.(js|ts)$/)) return true;
  if (filePath.match(/^(bin|scripts)\//)) return true;
  if (filePath.match(/(^|\/)index\.(js|ts|mjs)$/)) return true;
  if (filePath.match(/^(src\/)?(main|app|server)\.(js|ts|mjs)$/)) return true;
  return false;
}
