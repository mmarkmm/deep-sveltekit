const CONFIG_PATTERNS = /\.(config|rc)\.(js|ts|mjs|cjs)$|\.eslintrc|\.prettierrc|tailwind|postcss|vite\.config/;
const TEST_PATTERNS = /\.(test|spec|e2e)\.(js|ts|jsx|tsx)$|__tests__/;
const ROUTE_PATTERNS = /\+page\.|\/\+server\.|\/\+layout\.|\/\+error\./;

export function findDeadExports(graph, analyzedFiles) {
  const importedSpecifiers = new Map();
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

    if (edge.specifiers.length === 0) {
      specs.add('*');
    }
  }

  const deadExports = [];

  for (const file of analyzedFiles) {
    const exports = file.exports || [];
    if (!exports.length) continue;

    if (isEntryPoint(file.path)) continue;

    const imported = importedSpecifiers.get(file.path);

    // not imported by anyone → belongs in orphans, not here
    if (!imported) continue;
    if (imported.has('*')) continue;
    // svelte components: default-imported means all named exports are accessible via bind:this
    if (file.path.endsWith('.svelte') && imported.has('default')) continue;

    const usedCount = imported.size;
    const importers = importerCount.get(file.path)?.size || 0;

    const internallyUsed = file.references instanceof Set
      ? new Set(file.references)
      : new Set();

    if (file.calls) {
      for (const call of file.calls) {
        if (!call.callee) continue;
        internallyUsed.add(call.callee);
        // foo.bar() → also mark 'foo'
        const root = call.callee.split('.')[0];
        if (root) internallyUsed.add(root);
      }
    }

    for (const exp of exports) {
      const name = exp.name;

      if (name === 'default' && imported.has('default')) continue;
      if (imported.has(name)) continue;
      if (name === 'default' && usedCount > 0) continue;
      if (internallyUsed.has(name)) continue;

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
  // All files in routes/ directory are entry points (SvelteKit routing)
  if (/routes\//.test(filePath)) return true;
  if (/hooks\.(server|client)\.(js|ts)$/.test(filePath)) return true;
  if (/^(bin|scripts)\//.test(filePath)) return true;
  if (/(^|\/)index\.(js|ts|mjs)$/.test(filePath)) return true;
  if (/^(src\/)?(main|app|server)\.(js|ts|mjs)$/.test(filePath)) return true;
  // SvelteKit param matchers
  if (/params\//.test(filePath)) return true;
  return false;
}
