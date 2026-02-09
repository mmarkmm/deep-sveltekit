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

// Try multiple parse strategies - first one that works wins
function tryParse(code) {
  // 1) acorn-jsx, module
  try {
    return jsxParser.parse(code, { ...ACORN_OPTIONS, sourceType: 'module' });
  } catch {}

  // 2) plain acorn, module
  try {
    return acorn.parse(code, { ...ACORN_OPTIONS, sourceType: 'module' });
  } catch {}

  // 3) plain acorn, script
  try {
    return acorn.parse(code, { ...ACORN_OPTIONS, sourceType: 'script' });
  } catch {}

  return null;
}

export function extractSvelteScript(content) {
  const scripts = [];

  // match <script context="module"> ... </script>
  const moduleMatch = content.match(/<script\s+context=["']module["'][^>]*>([\s\S]*?)<\/script>/);
  if (moduleMatch) scripts.push(moduleMatch[1]);

  // match <script> ... </script> (but not context="module" ones)
  const scriptRegex = /<script(?!\s+context=["']module["'])[^>]*>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = scriptRegex.exec(content)) !== null) {
    scripts.push(match[1]);
  }

  return scripts.join('\n\n');
}

// Strip TypeScript-specific syntax so acorn can parse it.
// This is intentionally rough - handles the common cases, not all edge cases.
export function stripTypeAnnotations(content) {
  let code = content;

  // remove `import type { ... } from '...'` and `import { type Foo, ... }`
  code = code.replace(/import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]\s*;?/g, '');
  code = code.replace(/import\s+type\s+\w+\s+from\s+['"][^'"]+['"]\s*;?/g, '');

  // remove `type Foo = ...` declarations (up to semicolon or next line starting with export/const/etc)
  code = code.replace(/^type\s+\w+(?:<[^>]*>)?\s*=\s*[^;]+;/gm, '');
  code = code.replace(/^export\s+type\s+\w+(?:<[^>]*>)?\s*=\s*[^;]+;/gm, '');

  // remove interface blocks
  code = code.replace(/^(?:export\s+)?interface\s+\w+(?:<[^>]*>)?(?:\s+extends\s+[^{]+)?\s*\{[^}]*\}/gm, '');

  // remove function return type annotations: ): Type { or ): Type =>
  code = code.replace(/\)\s*:\s*\w+(?:<[^>]*>)?(?:\s*\[\s*\])?\s*(?=\{|=>)/g, ')');

  // remove type annotations from parameters: (foo: Type, bar: Type<X>)
  // matches `: Word` or `: Word<...>` or `: Word[]` when followed by , ) =
  code = code.replace(/:\s*[A-Z]\w*(?:<[^>]*>)?(?:\s*\[\s*\])?(?=\s*[,)=;])/g, '');

  // remove primitive type annotations from variable declarations
  code = code.replace(/:\s*(?:string|number|boolean|void|any|never|unknown|null|undefined|object)\b(\s*\[\s*\])?/g, '');

  // remove `as Type` casts
  code = code.replace(/\s+as\s+\w+(?:<[^>]*>)?/g, '');

  // remove generic type params from function calls and declarations
  code = code.replace(/<(?:string|number|boolean|any|unknown|void|never|null|undefined|Record|Array|Promise|Map|Set|Partial|Required|Omit|Pick|Extract|Exclude)\b[^>]*>/g, '');

  // remove `!` non-null assertions (but not !== )
  code = code.replace(/(\w)!([.)\],;\s])/g, '$1$2');

  // remove access modifiers and readonly
  code = code.replace(/\b(?:private|protected|public|readonly)\s+/g, '');

  // remove `declare` statements
  code = code.replace(/^declare\s+.+$/gm, '');

  // remove satisfies keyword
  code = code.replace(/\s+satisfies\s+\w+(?:<[^>]*>)?/g, '');

  // TODO: handle enum declarations - they have runtime semantics but we strip them for now
  code = code.replace(/^(?:export\s+)?(?:const\s+)?enum\s+\w+\s*\{[^}]*\}/gm, '');

  return code;
}

export function parseFile(content, filePath) {
  let code = content;
  const ext = filePath.split('.').pop();

  if (ext === 'svelte') {
    code = extractSvelteScript(content);
    if (!code.trim()) return null;
  }

  if (['ts', 'tsx'].includes(ext)) {
    code = stripTypeAnnotations(code);
  }

  return tryParse(code);
}
