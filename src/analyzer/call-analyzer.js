import * as walk from 'acorn-walk';

// Determine the enclosing function name from the ancestor chain
function findEnclosingFunction(ancestors) {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const node = ancestors[i];
    if (node.type === 'FunctionDeclaration' && node.id) {
      return node.id.name;
    }
    if (node.type === 'MethodDefinition' || node.type === 'Property') {
      const className = findClassName(ancestors, i);
      const methodName = node.key?.name || node.key?.value || '[computed]';
      return className ? `${className}.${methodName}` : methodName;
    }
    // arrow/function expression assigned to a variable
    if (
      (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') &&
      ancestors[i - 1]?.type === 'VariableDeclarator'
    ) {
      return ancestors[i - 1].id?.name || null;
    }
  }
  return null; // top-level
}

function findClassName(ancestors, fromIndex) {
  for (let i = fromIndex - 1; i >= 0; i--) {
    const n = ancestors[i];
    if (n.type === 'ClassDeclaration' && n.id) return n.id.name;
    if (n.type === 'ClassExpression' && n.id) return n.id.name;
  }
  return null;
}

function resolveCallee(node) {
  if (node.type === 'Identifier') {
    return { name: node.name, type: 'direct' };
  }

  if (node.type === 'MemberExpression') {
    const parts = [];
    let current = node;
    let depth = 0;

    while (current.type === 'MemberExpression' && depth < 5) {
      if (current.property?.name) {
        parts.unshift(current.property.name);
      } else if (current.property?.value !== undefined) {
        parts.unshift(String(current.property.value));
      } else {
        parts.unshift('[computed]');
      }
      current = current.object;
      depth++;
    }

    if (current.type === 'Identifier') {
      parts.unshift(current.name);
    } else if (current.type === 'ThisExpression') {
      parts.unshift('this');
    } else if (current.type === 'CallExpression') {
      // chained call like foo().bar()
      const inner = resolveCallee(current.callee);
      parts.unshift(inner.name + '()');
      return { name: parts.join('.'), type: 'chained' };
    }

    return { name: parts.join('.'), type: parts.length > 1 ? 'member' : 'direct' };
  }

  // something weird, just skip
  return null;
}

export function extractCalls(ast) {
  const calls = [];
  if (!ast) return calls;

  walk.ancestor(ast, {
    CallExpression(node, _state, ancestors) {
      let calleeNode = node.callee;

      // unwrap: await is handled by the parent, but if the callee itself
      // is wrapped we still resolve it the same way
      const resolved = resolveCallee(calleeNode);
      if (!resolved) return;

      const caller = findEnclosingFunction([...ancestors]);

      calls.push({
        caller,
        callee: resolved.name,
        line: node.loc?.start?.line || 0,
        type: resolved.type
      });
    }
  });

  return calls;
}
