import * as walk from 'acorn-walk';

// AST node types that increase cyclomatic complexity
const DECISION_NODES = new Set([
  'IfStatement', 'ConditionalExpression',
  'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoWhileStatement',
  'SwitchCase',
  'CatchClause',
]);

const LOGICAL_OPS = new Set(['&&', '||', '??']);

function isFunctionNode(node) {
  return node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression';
}

function getFunctionName(node, parent) {
  if (node.id?.name) return node.id.name;

  // const foo = () => {} or const foo = function() {}
  if (parent?.type === 'VariableDeclarator' && parent.id?.name) {
    return parent.id.name;
  }

  // { methodName() {} }
  if (parent?.type === 'Property' && parent.key?.name) {
    return parent.key.name;
  }

  // class method
  if (parent?.type === 'MethodDefinition' && parent.key?.name) {
    return parent.key.name;
  }

  return '<anonymous>';
}

export function calculateComplexity(ast) {
  if (!ast) return { total: 1, functions: [] };

  const functions = [];
  let fileComplexity = 1; // base complexity

  // map function nodes to their complexity counters
  const fnStack = [];
  let currentFnComplexity = 0;

  walk.ancestor(ast, {
    IfStatement() { fileComplexity++; },
    ConditionalExpression() { fileComplexity++; },
    ForStatement() { fileComplexity++; },
    ForInStatement() { fileComplexity++; },
    ForOfStatement() { fileComplexity++; },
    WhileStatement() { fileComplexity++; },
    DoWhileStatement() { fileComplexity++; },
    SwitchCase(node) {
      // default case doesn't add complexity
      if (node.test) fileComplexity++;
    },
    CatchClause() { fileComplexity++; },
    LogicalExpression(node) {
      if (LOGICAL_OPS.has(node.operator)) fileComplexity++;
    },
  });

  // per-function complexity
  walk.ancestor(ast, {
    FunctionDeclaration(node, ancestors) {
      const complexity = countFunctionComplexity(node);
      const parent = ancestors[ancestors.length - 2];
      functions.push({ name: getFunctionName(node, parent), complexity, line: node.loc?.start?.line });
    },
    FunctionExpression(node, ancestors) {
      const complexity = countFunctionComplexity(node);
      const parent = ancestors[ancestors.length - 2];
      functions.push({ name: getFunctionName(node, parent), complexity, line: node.loc?.start?.line });
    },
    ArrowFunctionExpression(node, ancestors) {
      const complexity = countFunctionComplexity(node);
      const parent = ancestors[ancestors.length - 2];
      // skip trivial arrow fns like callbacks with single expression
      if (node.body.type !== 'BlockStatement') return;
      functions.push({ name: getFunctionName(node, parent), complexity, line: node.loc?.start?.line });
    },
  });

  return { total: fileComplexity, functions };
}

function countFunctionComplexity(fnNode) {
  let complexity = 1;

  walk.simple(fnNode.body, {
    IfStatement() { complexity++; },
    ConditionalExpression() { complexity++; },
    ForStatement() { complexity++; },
    ForInStatement() { complexity++; },
    ForOfStatement() { complexity++; },
    WhileStatement() { complexity++; },
    DoWhileStatement() { complexity++; },
    SwitchCase(node) { if (node.test) complexity++; },
    CatchClause() { complexity++; },
    LogicalExpression(node) {
      if (LOGICAL_OPS.has(node.operator)) complexity++;
    },
  });

  return complexity;
}

function countLinesOfLogic(content) {
  if (!content) return 0;
  const lines = content.split('\n');
  let count = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }

    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }

    if (trimmed.startsWith('//')) continue;
    count++;
  }
  return count;
}

// Simplified Halstead volume based on operator/operand counts
function estimateHalsteadVolume(content) {
  if (!content) return 1;

  const operators = content.match(/[+\-*/%=<>!&|^~?:;,.{}()\[\]]/g) || [];
  const operands = content.match(/\b\w+\b/g) || [];

  const n1 = new Set(operators).size || 1;
  const n2 = new Set(operands).size || 1;
  const N1 = operators.length || 1;
  const N2 = operands.length || 1;

  const N = N1 + N2;
  const n = n1 + n2;
  return N * Math.log2(n || 2);
}

export function calculateMetrics(analyzedFile) {
  const { ast, content, path } = analyzedFile;
  const loc = content ? content.split('\n').length : 0;
  const locLogic = countLinesOfLogic(content);

  const complexityData = calculateComplexity(ast);
  const halsteadVol = estimateHalsteadVolume(content);

  // Maintainability Index formula (normalized to 0-100)
  let mi = 171
    - 5.2 * Math.log(halsteadVol || 1)
    - 0.23 * complexityData.total
    - 16.2 * Math.log(loc || 1);

  mi = Math.max(0, Math.min(100, mi * (100 / 171)));

  return {
    complexity: complexityData.total,
    maintainability: Math.round(mi * 10) / 10,
    functionComplexity: complexityData.functions,
    linesOfCode: loc,
    linesOfLogic: locLogic,
  };
}
