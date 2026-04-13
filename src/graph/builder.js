import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const RESOLVE_EXTENSIONS = ['.js', '.ts', '.mjs', '.jsx', '.tsx', '.svelte'];
const INDEX_FILES = RESOLVE_EXTENSIONS.map(ext => 'index' + ext);

function stripJsonComments(raw) {
  // Remove // and /* */ comments while preserving strings that contain //
  return raw.replace(/("(?:[^"\\]|\\.)*")|\/\/.*$|\/\*[\s\S]*?\*\//gm, (m, str) => str || '');
}

function readJsonConfig(rootDir) {
  for (const name of ['jsconfig.json', 'tsconfig.json']) {
    try {
      const raw = readFileSync(join(rootDir, name), 'utf8');
      return JSON.parse(stripJsonComments(raw));
    } catch { /* skip */ }
  }
  return null;
}

function detectAliases(frameworkConfig, allFilePaths, rootDir) {
  const aliases = {};

  const hasLibDir = [...allFilePaths].some(p => p.startsWith('lib/'));
  const hasSrcLibDir = [...allFilePaths].some(p => p.startsWith('src/lib/'));
  const libPrefix = hasSrcLibDir ? 'src/lib' : hasLibDir ? 'lib' : 'src/lib';

  aliases['$lib'] = libPrefix;
  aliases['$app'] = null;
  aliases['$env'] = null;

  if (rootDir) {
    const config = readJsonConfig(rootDir);
    const paths = config?.compilerOptions?.paths;
    if (paths) {
      for (const [alias, targets] of Object.entries(paths)) {
        if (alias === '$lib/*' || alias === '$app/*' || alias === '$env/*') continue;
        const cleanAlias = alias.replace(/\/\*$/, '');
        const target = targets?.[0]?.replace(/\/\*$/, '').replace(/^\.\//, '');
        if (target) aliases[cleanAlias] = target;
      }
    }
  }

  const hasSrcDir = [...allFilePaths].some(p => p.startsWith('src/'));
  const srcPrefix = hasSrcDir ? 'src' : '.';
  if (!aliases['~']) aliases['~'] = srcPrefix;
  if (!aliases['@']) aliases['@'] = srcPrefix;

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

  const fromDir = dirname(fromFile);
  let target;

  if (importSource.startsWith('.')) {
    target = join(fromDir, importSource);
  } else {
    target = importSource;
  }

  target = target.replace(/\\/g, '/');

  if (allFilePaths.has(target)) {
    return { resolved: target, external: false };
  }

  for (const ext of RESOLVE_EXTENSIONS) {
    if (allFilePaths.has(target + ext)) {
      return { resolved: target + ext, external: false };
    }
  }

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
  if (inDegree === 0) {
    if (filePath.includes('routes/') || filePath.includes('pages/')) return 'entry';
    if (filePath.match(/^(bin|scripts)\//)) return 'entry';
    if (filePath.match(/(index|main|app|server)\.(js|ts|mjs)$/)) return 'entry';
  }
  return 'source';
}

export function buildGraph(analyzedFiles, options = {}) {
  const allFilePaths = new Set(analyzedFiles.map(f => f.path));
  const aliases = detectAliases(options.framework, allFilePaths, options.rootDir);

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
