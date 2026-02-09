import * as walk from 'acorn-walk';

function getParamNames(params) {
  return params.map(p => {
    if (p.type === 'Identifier') return p.name;
    if (p.type === 'AssignmentPattern' && p.left?.name) return p.left.name;
    if (p.type === 'RestElement' && p.argument?.name) return '...' + p.argument.name;
    if (p.type === 'ObjectPattern') return '{...}';
    if (p.type === 'ArrayPattern') return '[...]';
    return '?';
  });
}

function makeLoc(node) {
  return {
    start: { line: node.loc?.start?.line || 0, col: node.loc?.start?.column || 0 },
    end: { line: node.loc?.end?.line || 0, col: node.loc?.end?.column || 0 }
  };
}

function methodKindToType(kind) {
  if (kind === 'get') return 'getter';
  if (kind === 'set') return 'setter';
  return 'method';
}

function getPropertyName(node) {
  if (node.computed) return '[computed]';
  if (node.key?.name) return node.key.name;
  if (node.key?.value !== undefined) return String(node.key.value);
  return '[unknown]';
}

export function extractFunctions(ast, content) {
  const functions = [];
  const classes = [];

  if (!ast) return { functions, classes };

  // collect classes first so we can associate methods
  walk.simple(ast, {
    ClassDeclaration(node) {
      const cls = {
        name: node.id?.name || '[anonymous]',
        extends: node.superClass?.name || null,
        line: node.loc?.start?.line || 0,
        endLine: node.loc?.end?.line || 0,
        methods: []
      };

      for (const item of node.body?.body || []) {
        if (item.type === 'MethodDefinition') {
          const name = getPropertyName(item);
          cls.methods.push({
            name,
            type: methodKindToType(item.kind),
            static: item.static || false,
            async: item.value?.async || false,
            line: item.loc?.start?.line || 0
          });

          // also add to flat functions list
          functions.push({
            name,
            type: methodKindToType(item.kind),
            class: cls.name,
            async: item.value?.async || false,
            generator: item.value?.generator || false,
            line: item.loc?.start?.line || 0,
            endLine: item.loc?.end?.line || 0,
            params: getParamNames(item.value?.params || []),
            loc: makeLoc(item)
          });
        }
      }

      classes.push(cls);
    }
  });

  // standalone functions
  walk.simple(ast, {
    FunctionDeclaration(node) {
      functions.push({
        name: node.id?.name || '[anonymous]',
        type: 'function',
        class: null,
        async: node.async || false,
        generator: node.generator || false,
        line: node.loc?.start?.line || 0,
        endLine: node.loc?.end?.line || 0,
        params: getParamNames(node.params),
        loc: makeLoc(node)
      });
    }
  });

  // arrow functions and function expressions assigned to variables
  walk.simple(ast, {
    VariableDeclarator(node) {
      if (!node.init) return;
      const init = node.init;

      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
        const name = node.id?.name || '[anonymous]';
        functions.push({
          name,
          type: init.type === 'ArrowFunctionExpression' ? 'arrow' : 'function',
          class: null,
          async: init.async || false,
          generator: init.generator || false,
          line: node.loc?.start?.line || 0,
          endLine: init.loc?.end?.line || init.body?.loc?.end?.line || 0,
          params: getParamNames(init.params),
          loc: makeLoc(node)
        });
      }
    }
  });

  // handle class expressions assigned to variables
  walk.simple(ast, {
    VariableDeclarator(node) {
      if (!node.init || node.init.type !== 'ClassExpression') return;
      const classNode = node.init;
      const cls = {
        name: node.id?.name || classNode.id?.name || '[anonymous]',
        extends: classNode.superClass?.name || null,
        line: node.loc?.start?.line || 0,
        endLine: classNode.loc?.end?.line || 0,
        methods: []
      };

      for (const item of classNode.body?.body || []) {
        if (item.type === 'MethodDefinition') {
          const name = getPropertyName(item);
          cls.methods.push({
            name,
            type: methodKindToType(item.kind),
            static: item.static || false,
            async: item.value?.async || false,
            line: item.loc?.start?.line || 0
          });
        }
      }

      classes.push(cls);
    }
  });

  // deduplicate by name+line (class methods show up in both walks)
  const seen = new Set();
  const deduped = functions.filter(f => {
    const key = `${f.name}:${f.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { functions: deduped, classes };
}
