export function findCircularDependencies(graph) {
  const adj = new Map();

  // build adjacency list from internal edges only
  for (const edge of graph.edges) {
    if (edge.external) continue;
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source).push(edge.target);
  }

  const cycles = [];
  const visited = new Set();
  const inStack = new Set();
  const stack = [];

  function dfs(node) {
    visited.add(node);
    inStack.add(node);
    stack.push(node);

    const neighbors = adj.get(node) || [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        dfs(next);
      } else if (inStack.has(next)) {
        // found a cycle - extract it from the stack
        const cycleStart = stack.indexOf(next);
        if (cycleStart !== -1) {
          const cycle = stack.slice(cycleStart);
          cycle.push(next); // close the cycle
          addCycle(cycles, cycle);
        }
      }
    }

    stack.pop();
    inStack.delete(node);
  }

  for (const node of adj.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  // sort by length - shorter cycles are more problematic
  cycles.sort((a, b) => a.length - b.length);
  return cycles;
}

function addCycle(cycles, cycle) {
  // normalize: rotate so smallest element is first (prevents duplicates)
  const normalized = normalizeCycle(cycle.slice(0, -1));
  normalized.push(normalized[0]); // close it

  const key = normalized.join(' -> ');

  // check for duplicate
  for (const existing of cycles) {
    const existingKey = existing.cycle.join(' -> ');
    if (existingKey === key) return;
  }

  cycles.push({
    cycle: normalized,
    length: normalized.length - 1,
    severity: normalized.length - 1 <= 2 ? 'error' : 'warning',
  });
}

function normalizeCycle(nodes) {
  let minIdx = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i] < nodes[minIdx]) minIdx = i;
  }
  return [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)];
}
