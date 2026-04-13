import { parseFile } from './parser.js';
import { extractModuleInfo } from './module-analyzer.js';
import { extractFunctions } from './function-analyzer.js';
import { extractCalls, extractReferences } from './call-analyzer.js';
import { calculateMetrics } from '../graph/metrics.js';
import { dirname } from 'path';

export function analyzeFile(scannedFile) {
  const base = {
    path: scannedFile.path,
    directory: dirname(scannedFile.path),
    extension: scannedFile.extension,
    lines: scannedFile.lines,
    size: scannedFile.size,
  };

  // .d.ts and empty svelte scripts return null — not a parse error
  const isTypeOnly = scannedFile.path.endsWith('.d.ts');
  const ast = parseFile(scannedFile.content, scannedFile.path);

  if (!ast) {
    return {
      ...base,
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      calls: [],
      metrics: { complexity: 0, maintainability: 0, functionComplexity: [], linesOfCode: scannedFile.lines, linesOfLogic: 0 },
      parseError: !isTypeOnly
    };
  }

  const moduleInfo = extractModuleInfo(ast);
  const { functions, classes } = extractFunctions(ast, scannedFile.content);
  const calls = extractCalls(ast);
  const references = extractReferences(ast);
  const metrics = calculateMetrics({ ast, content: scannedFile.content, path: scannedFile.path });

  return {
    ...base,
    imports: moduleInfo.imports,
    exports: moduleInfo.exports,
    functions,
    classes,
    calls,
    references,
    metrics,
    parseError: false
  };
}

export function analyzeAll(files) {
  return files.map(f => analyzeFile(f));
}
