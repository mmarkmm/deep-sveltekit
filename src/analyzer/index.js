import { parseFile } from './parser.js';
import { extractModuleInfo } from './module-analyzer.js';
import { extractFunctions } from './function-analyzer.js';
import { extractCalls } from './call-analyzer.js';
import { dirname } from 'path';

export function analyzeFile(scannedFile) {
  const base = {
    path: scannedFile.path,
    directory: dirname(scannedFile.path),
    extension: scannedFile.extension,
    lines: scannedFile.lines,
    size: scannedFile.size,
  };

  const ast = parseFile(scannedFile.content, scannedFile.path);

  if (!ast) {
    return {
      ...base,
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      calls: [],
      parseError: true
    };
  }

  const moduleInfo = extractModuleInfo(ast);
  const { functions, classes } = extractFunctions(ast, scannedFile.content);
  const calls = extractCalls(ast);

  return {
    ...base,
    imports: moduleInfo.imports,
    exports: moduleInfo.exports,
    functions,
    classes,
    calls,
    parseError: false
  };
}

export function analyzeAll(files) {
  return files.map(f => analyzeFile(f));
}
