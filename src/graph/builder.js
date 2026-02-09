import { dirname, join, resolve, relative, extname } from 'path';

const RESOLVE_EXTENSIONS = ['.js', '.ts', '.mjs', '.jsx', '.tsx', '.svelte'];
const INDEX_FILES = RESOLVE_EXTENSIONS.map(ext => 'index' + ext);

function detectAliases(frameworkConfig, allFilePaths) {
  const aliases = {};

  // detect if file paths include src/ prefix or not
  const hasLibDir = [...allFilePaths].some(p => p.startsWith('lib/'));
  const hasSrcLibDir = [...allFilePaths].some(p => p.startsWith('src/lib/'));
  const libPrefix = hasSrcLibDir ? 'src/lib' : hasLibDir ? 'lib' : 'src/lib';

  // SvelteKit aliases
  aliases['$lib'] = libPrefix;
  aliases['$app'] = null; // built-in, treat as external
  aliases['$env'] = null; // built-in, treat as external

  // common aliases - detect if src/ prefix is needed
  const hasSrcDir = [...allFilePaths].some(p => p.startsWith('src/'));
  const srcPrefix = hasSrcDir ? 'src' : '.';
  aliases['~'] = srcPrefix;
  aliases['@'] = srcPrefix;

  return aliases;
}

export function resolveImport(importSource, fromFile, allFilePaths, aliases, knownDirs) {
  if (!importSource.startsWith('.') && !importSource.startsWith('/')) {
    for (const [alias, target] of Object.entries(aliases)) {
      if (importSource === alias || importSource.startsWith(alias + '/')) {
        if (target === null) return { resolved: null, external: true };
        const rest = importSource.slice(alias.length);
        importSource = target + rest;
        break;
      }
    }

    // if the first path segment isn't a known project directory, it's an npm package
    if (!importSource.startsWith('.')) {
      const firstSeg = importSource.split('/')[0];
      if (!knownDirs || !knownDirs.has(firstSeg)) {
        const pkg = importSource.startsWith('@')
          ? importSource.split('/').slice(0, 2).join('/')
          : firstSeg;
        return { resolved: pkg, external: true };
      }
    }
  }

  // resolve relative to the importing file
  const fromDir = dirname(fromFile);
  let target;

  if (importSource.startsWith('.')) {
    target = join(fromDir, importSource);
  } else {
    target = importSource;
  }

  // normalize separators
  target = target.replace(/\\/g, '/');

  // try exact match first
  if (allFilePaths.has(target)) {
    return { resolved: target, external: false };
  }

  // try with extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    if (allFilePaths.has(target + ext)) {
      return { resolved: target + ext, external: false };
    }
  }

  // try as directory with index file
  for (const idx of INDEX_FILES) {
    const indexPath = target + '/' + idx;
    if (allFilePaths.has(indexPath)) {
      return { resolved: indexPath, external: false };
    }
  }

  return { resolved: target, external: false, unresolved: true };
}

function getImportType(imp) {
  if (imp.isDynamic) return 'dynamic';
  if (imp.isReExport) return 'reexport';
  return 'import';
}

function classifyFile(filePath, inDegree, analyzedFile) {
  // entry points: bin files, main files, route files
  if (inDegree === 0) {
    if (filePath.includes('routes/') || filePath.includes('pages/')) return 'entry';
    if (filePath.match(/^(bin|scripts)\//)) return 'entry';
    if (filePath.match(/(index|main|app|server)\.(js|ts|mjs)$/)) return 'entry';
  }
  return 'source';
}

export function buildGraph(analyzedFiles, options = {}) {
  const allFilePaths = new Set(analyzedFiles.map(f => f.path));
  const aliases = detectAliases(options.framework, allFilePaths);

  // collect top-level directory names for internal vs external detection
  const knownDirs = new Set();
  for (const f of analyzedFiles) {
    const first = f.path.split('/')[0];
    if (first) knownDirs.add(first);
  }

  const nodes = [];
  const edges = [];
  const externalPackages = new Set();

  const inDegreeMap = {};
  const outDegreeMap = {};

  for (const file of analyzedFiles) {
    outDegreeMap[file.path] = 0;
    if (!inDegreeMap[file.path]) inDegreeMap[file.path] = 0;

    const imports = file.imports || [];
    for (const imp of imports) {
      const { resolved, external, unresolved } = resolveImport(
        imp.source, file.path, allFilePaths, aliases, knownDirs
      );

      if (external) {
        externalPackages.add(resolved);
      }

      if (resolved && !external) {
        inDegreeMap[resolved] = (inDegreeMap[resolved] || 0) + 1;
      }
      outDegreeMap[file.path]++;

      edges.push({
        source: file.path,
        target: resolved || imp.source,
        type: getImportType(imp),
        specifiers: imp.specifiers || [],
        external: !!external,
      });
    }
  }

  // second pass: build nodes
  for (const file of analyzedFiles) {
    const inDeg = inDegreeMap[file.path] || 0;
    const outDeg = outDegreeMap[file.path] || 0;

    nodes.push({
      id: file.path,
      path: file.path,
      directory: dirname(file.path),
      type: classifyFile(file.path, inDeg, file),
      data: file,
      metrics: {
        complexity: file.metrics?.complexity || 0,
        maintainability: file.metrics?.maintainability || 100,
        inDegree: inDeg,
        outDegree: outDeg,
      },
    });
  }

  // external package nodes
  if (options.includeExternal) {
    for (const pkg of externalPackages) {
      nodes.push({
        id: pkg,
        path: pkg,
        directory: 'node_modules',
        type: 'external',
        data: null,
        metrics: { complexity: 0, maintainability: 100, inDegree: 0, outDegree: 0 },
      });
    }
  }

  return { nodes, edges };
}
