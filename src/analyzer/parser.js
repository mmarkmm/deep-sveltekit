import * as acorn from 'acorn';
import jsx from 'acorn-jsx';

const jsxParser = acorn.Parser.extend(jsx());

const ACORN_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  locations: true,
  allowReturnOutsideFunction: true,
  allowImportExportEverywhere: true,
  allowAwaitOutsideFunction: true,
  allowSuperOutsideMethod: true,
};

function tryParse(code) {
  try { return jsxParser.parse(code, { ...ACORN_OPTIONS, sourceType: 'module' }); } catch {}
  try { return acorn.parse(code, { ...ACORN_OPTIONS, sourceType: 'module' }); } catch {}
  try { return acorn.parse(code, { ...ACORN_OPTIONS, sourceType: 'script' }); } catch {}
  return null;
}

export function extractSvelteScript(content) {
  const scripts = [];

  const moduleMatch = content.match(/<script\s+context=["']module["'][^>]*>([\s\S]*?)<\/script>/);
  if (moduleMatch) scripts.push(moduleMatch[1]);

  const scriptRegex = /<script(?!\s+context=["']module["'])[^>]*>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = scriptRegex.exec(content)) !== null) {
    scripts.push(match[1]);
  }

  return scripts.join('\n\n');
}

// Rough TS->JS transform — good enough for static analysis, not a compiler.
export function stripTypeAnnotations(content) {
  let code = content;

  code = code.replace(/import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]\s*;?/g, '');
  code = code.replace(/import\s+type\s+\w+\s+from\s+['"][^'"]+['"]\s*;?/g, '');
  code = code.replace(/^type\s+\w+(?:<[^>]*>)?\s*=\s*[^;]+;/gm, '');
  code = code.replace(/^export\s+type\s+\w+(?:<[^>]*>)?\s*=\s*[^;]+;/gm, '');
  code = code.replace(/^(?:export\s+)?interface\s+\w+(?:<[^>]*>)?(?:\s+extends\s+[^{]+)?\s*\{[^}]*\}/gm, '');
  code = code.replace(/\)\s*:\s*\w+(?:<[^>]*>)?(?:\s*\[\s*\])?\s*(?=\{|=>)/g, ')');
  code = code.replace(/:\s*[A-Z]\w*(?:<[^>]*>)?(?:\s*\[\s*\])?(?=\s*[,)=;])/g, '');
  code = code.replace(/:\s*(?:string|number|boolean|void|any|never|unknown|null|undefined|object)\b(\s*\[\s*\])?/g, '');
  code = code.replace(/\s+as\s+\w+(?:<[^>]*>)?/g, '');
  code = code.replace(/<(?:string|number|boolean|any|unknown|void|never|null|undefined|Record|Array|Promise|Map|Set|Partial|Required|Omit|Pick|Extract|Exclude)\b[^>]*>/g, '');
  code = code.replace(/(\w)!([.)\],;\s])/g, '$1$2');
  code = code.replace(/\b(?:private|protected|public|readonly)\s+/g, '');
  code = code.replace(/^declare\s+.+$/gm, '');
  code = code.replace(/\s+satisfies\s+\w+(?:<[^>]*>)?/g, '');
  // TODO: enums have runtime semantics but we strip them for now
  code = code.replace(/^(?:export\s+)?(?:const\s+)?enum\s+\w+\s*\{[^}]*\}/gm, '');

  return code;
}

// Svelte 5 runes are compiler-level macros that don't exist at runtime.
// We inject stub declarations so acorn can parse them without errors.
const SVELTE5_RUNE_DECLARATIONS = 'const $state=0,$derived=0,$effect=0,$props=0,$bindable=0,$inspect=0;\n';

export function parseFile(content, filePath) {
  // .d.ts files are ambient type declarations — no runtime code to analyze
  if (filePath.endsWith('.d.ts')) return null;

  let code = content;
  const ext = filePath.split('.').pop();
  let isSvelteTS = false;

  if (ext === 'svelte') {
    isSvelteTS = /<script[^>]*lang=["']ts["']/.test(content);
    code = extractSvelteScript(content);
    if (!code.trim()) return null;
    code = SVELTE5_RUNE_DECLARATIONS + code;
  }

  if (['ts', 'tsx'].includes(ext) || isSvelteTS) {
    code = stripTypeAnnotations(code);
  }

  return tryParse(code);
}
