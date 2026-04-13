// SvelteKit canonical route file basenames
const ROUTE_FILES = new Set([
  '+page.svelte', '+page.js', '+page.ts',
  '+page.server.js', '+page.server.ts',
  '+server.js', '+server.ts',
  '+layout.svelte', '+layout.js', '+layout.ts',
  '+layout.server.js', '+layout.server.ts',
  '+error.svelte',
]);

// Files that belong at src/ root
const SRC_ROOT_RE = /^(app\.(html|css|d\.ts)|hooks\.(server|client)\.(js|ts)|service-worker\.(js|ts))$/;

// Well-known lib subdirectories
const LIB_ORGANIZED_DIRS = new Set([
  'components', 'server', 'stores', 'utils', 'types',
  'constants', 'helpers', 'actions', 'api', 'assets',
  'styles', 'config', 'schemas', 'middleware', 'services',
]);

function normalizePath(filePath) {
  return filePath.startsWith('src/') ? filePath.slice(4) : filePath;
}

function basename(filePath) {
  return filePath.split('/').pop();
}

function looksLikeStore(file) {
  if (/store/i.test(file.path)) return true;
  if (!file.imports) return false;
  return file.imports.some(imp =>
    imp.source === 'svelte/store' ||
    imp.source === 'svelte/store/index' ||
    /\/stores?[/.]/.test(imp.source)
  );
}

function looksLikeServerOnly(file) {
  if (/\.server\./i.test(file.path)) return true;
  if (!file.imports) return false;
  return file.imports.some(imp =>
    imp.source.includes('$env/static/private') ||
    imp.source.includes('$env/dynamic/private') ||
    imp.source.includes('$lib/server')
  );
}

function looksLikeTypes(file) {
  if (file.path.endsWith('.d.ts')) return true;
  if (/types?\.(ts|js)$/.test(basename(file.path))) return true;
  if (file.exports && file.exports.length > 0 && file.exports.every(e => e.type === 'type')) return true;
  return false;
}

function looksLikeUtil(file) {
  return /util|helper|format|parse|validate|transform|convert/i.test(basename(file.path));
}

function classifyFile(file) {
  const p = normalizePath(file.path);
  const name = basename(p);
  const parts = p.split('/');
  const ext = file.extension || '';

  if (parts[0] === 'routes') {
    if (ROUTE_FILES.has(name)) {
      return { status: 'correct', reason: 'Valid SvelteKit route file', category: 'route-valid' };
    }
    // Colocated files in routes/ are valid — suggest, don't flag
    if (ext === '.svelte') {
      return {
        status: 'suggestion',
        reason: 'Component colocated with route — consider lib/components/ if reused',
        suggestedPath: 'lib/components/' + name,
        category: 'route-component',
      };
    }
    if (['.js', '.ts', '.mjs'].includes(ext)) {
      return {
        status: 'suggestion',
        reason: 'Utility colocated with route — consider lib/ if reused',
        category: 'route-utility',
      };
    }
  }

  if (parts[0] === 'lib' && parts.length >= 3 && LIB_ORGANIZED_DIRS.has(parts[1])) {
    return { status: 'correct', reason: 'Organized in lib/' + parts[1] + '/', category: 'lib-organized' };
  }

  if (parts[0] === 'lib' && parts.length >= 3 && !LIB_ORGANIZED_DIRS.has(parts[1])) {
    return { status: 'correct', reason: 'Organized in lib/ subdirectory', category: 'lib-subdir' };
  }

  if (parts[0] === 'lib' && parts.length === 2) {
    if (ext === '.svelte') {
      return {
        status: 'suggestion',
        reason: 'Component in lib/ root — consider lib/components/',
        suggestedPath: 'lib/components/' + name,
        category: 'lib-root-component',
      };
    }
    if (looksLikeStore(file)) {
      return {
        status: 'suggestion',
        reason: 'Store in lib/ root — consider lib/stores/',
        suggestedPath: 'lib/stores/' + name,
        category: 'lib-root-store',
      };
    }
    if (looksLikeServerOnly(file)) {
      return {
        status: 'suggestion',
        reason: 'Server code in lib/ root — consider lib/server/',
        suggestedPath: 'lib/server/' + name,
        category: 'lib-root-server',
      };
    }
    if (looksLikeTypes(file)) {
      return {
        status: 'suggestion',
        reason: 'Type definitions in lib/ root — consider lib/types/',
        suggestedPath: 'lib/types/' + name,
        category: 'lib-root-types',
      };
    }
    if (looksLikeUtil(file)) {
      return {
        status: 'suggestion',
        reason: 'Utility in lib/ root — consider lib/utils/',
        suggestedPath: 'lib/utils/' + name,
        category: 'lib-root-util',
      };
    }
    if (/^index\.(js|ts|mjs)$/.test(name)) {
      return { status: 'correct', reason: 'Barrel export file', category: 'lib-index' };
    }
    return { status: 'unknown', reason: 'File in lib/ root — consider organizing into a subfolder', category: 'lib-root-other' };
  }

  if (parts.length === 1) {
    if (SRC_ROOT_RE.test(name)) {
      return { status: 'correct', reason: 'Standard SvelteKit src root file', category: 'src-root-valid' };
    }
    return {
      status: 'suggestion',
      reason: 'File at project root — consider moving to lib/',
      suggestedPath: 'lib/' + name,
      category: 'src-root-other',
    };
  }

  if (parts[0] !== 'routes' && parts[0] !== 'lib') {
    if (parts[0] === 'params') {
      return { status: 'correct', reason: 'SvelteKit param matcher', category: 'params' };
    }
    return { status: 'unknown', reason: 'Non-standard directory', category: 'other' };
  }

  return { status: 'unknown', reason: 'Cannot determine ideal location', category: 'fallback' };
}

export function analyzeOrganization(analyzedFiles, routes = [], framework = 'sveltekit') {
  const files = [];
  let correct = 0;
  let misplaced = 0;
  let suggestion = 0;
  let unknown = 0;

  for (const file of analyzedFiles) {
    const result = classifyFile(file);
    files.push({
      path: file.path,
      status: result.status,
      reason: result.reason,
      suggestedPath: result.suggestedPath || null,
      category: result.category,
    });

    switch (result.status) {
      case 'correct': correct++; break;
      case 'misplaced': misplaced++; break;
      case 'suggestion': suggestion++; break;
      default: unknown++; break;
    }
  }

  const total = files.length;
  const score = total > 0 ? Math.round((correct / total) * 100) : 100;

  return {
    files,
    summary: { correct, misplaced, suggestion, unknown, total, score },
  };
}
