// Extract import/export information from an AST

function getSpecifierType(specifier) {
  switch (specifier.type) {
    case 'ImportDefaultSpecifier': return 'default';
    case 'ImportNamespaceSpecifier': return 'namespace';
    case 'ImportSpecifier': return 'named';
    default: return 'named';
  }
}

function getSpecifierImported(specifier) {
  if (specifier.type === 'ImportDefaultSpecifier') return 'default';
  if (specifier.type === 'ImportNamespaceSpecifier') return '*';
  return specifier.imported?.name || specifier.local?.name;
}

function detectDeclarationType(declaration) {
  if (!declaration) return 'const';

  switch (declaration.type) {
    case 'FunctionDeclaration': return 'function';
    case 'ClassDeclaration': return 'class';
    case 'VariableDeclaration': {
      // peek at the init to classify arrow functions, etc
      const decl = declaration.declarations?.[0];
      if (!decl?.init) return 'const';
      const init = decl.init;
      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') return 'function';
      if (init.type === 'ClassExpression') return 'class';
      if (init.type === 'NewExpression') return 'const';
      return 'const';
    }
    default: return 'const';
  }
}

function extractExportNames(declaration) {
  if (!declaration) return [];

  if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
    return declaration.id ? [{ name: declaration.id.name, type: detectDeclarationType(declaration) }] : [];
  }

  if (declaration.type === 'VariableDeclaration') {
    return declaration.declarations.map(d => ({
      name: d.id?.name || '[destructured]',
      type: detectDeclarationType(declaration)
    }));
  }

  return [];
}

export function extractModuleInfo(ast) {
  const imports = [];
  const exports = [];

  if (!ast?.body) return { imports, exports };

  for (const node of ast.body) {
    // imports
    if (node.type === 'ImportDeclaration') {
      imports.push({
        source: node.source.value,
        specifiers: node.specifiers.map(s => ({
          local: s.local.name,
          imported: getSpecifierImported(s),
          type: getSpecifierType(s)
        })),
        line: node.loc?.start?.line || 0
      });
    }

    // export named with declaration: export function foo() {} / export const x = ...
    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      const names = extractExportNames(node.declaration);
      for (const { name, type } of names) {
        exports.push({
          name,
          type,
          line: node.loc?.start?.line || 0
        });
      }
    }

    // export named with specifiers: export { foo, bar as baz }
    // or re-export: export { default as Foo } from './Foo.svelte'
    if (node.type === 'ExportNamedDeclaration' && !node.declaration && node.specifiers?.length) {
      for (const spec of node.specifiers) {
        exports.push({
          name: spec.exported?.name || spec.local?.name,
          type: node.source ? 'reexport' : 'const',
          line: node.loc?.start?.line || 0,
          ...(node.source && { source: node.source.value })
        });
      }

      // re-exports also count as imports (they create dependency edges)
      if (node.source) {
        imports.push({
          source: node.source.value,
          isReExport: true,
          specifiers: node.specifiers.map(s => ({
            local: s.local.name,
            imported: s.local.name,
            type: s.type === 'ExportDefaultSpecifier' ? 'default' : 'named'
          })),
          line: node.loc?.start?.line || 0
        });
      }
    }

    // export default
    if (node.type === 'ExportDefaultDeclaration') {
      let type = 'default';
      if (node.declaration) {
        if (node.declaration.type === 'FunctionDeclaration') type = 'function';
        else if (node.declaration.type === 'ClassDeclaration') type = 'class';
        else if (node.declaration.type === 'ArrowFunctionExpression') type = 'function';
      }
      exports.push({
        name: node.declaration?.id?.name || 'default',
        type,
        line: node.loc?.start?.line || 0
      });
    }

    // export * from './module'
    if (node.type === 'ExportAllDeclaration') {
      exports.push({
        name: node.exported?.name || '*',
        type: 'reexport-all',
        line: node.loc?.start?.line || 0,
        source: node.source.value
      });

      // also creates a dependency edge
      imports.push({
        source: node.source.value,
        isReExport: true,
        specifiers: [],
        line: node.loc?.start?.line || 0
      });
    }
  }

  return { imports, exports };
}
