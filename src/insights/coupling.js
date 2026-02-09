const HIGH_COUPLING_THRESHOLD = 15;

export function analyzeCoupling(graph) {
  const ca = {}; // afferent: who depends on me
  const ce = {}; // efferent: who do I depend on

  // initialize all nodes
  for (const node of graph.nodes) {
    if (node.type === 'external') continue;
    ca[node.id] = new Set();
    ce[node.id] = new Set();
  }

  for (const edge of graph.edges) {
    if (edge.external) continue;
    if (!ce[edge.source]) ce[edge.source] = new Set();
    if (!ca[edge.target]) ca[edge.target] = new Set();

    ce[edge.source].add(edge.target);
    ca[edge.target].add(edge.source);
  }

  const files = [];
  const highCoupling = [];
  const hubs = [];

  for (const node of graph.nodes) {
    if (node.type === 'external') continue;

    const caCount = ca[node.id]?.size || 0;
    const ceCount = ce[node.id]?.size || 0;
    const total = caCount + ceCount;

    // instability: 0 = maximally stable, 1 = maximally unstable
    const instability = total > 0 ? Math.round((ceCount / total) * 100) / 100 : 0;

    files.push({
      file: node.id,
      ca: caCount,
      ce: ceCount,
      instability,
    });

    if (total > HIGH_COUPLING_THRESHOLD) {
      let reason;
      if (caCount > ceCount * 2) {
        reason = `Hub: ${caCount} dependents - risky to change`;
      } else if (ceCount > caCount * 2) {
        reason = `High dependency count: imports ${ceCount} modules`;
      } else {
        reason = `High total coupling: ${caCount} in + ${ceCount} out`;
      }

      highCoupling.push({ file: node.id, total, reason });
    }

    // files that are both highly depended on AND depend on many others
    if (caCount >= 5 && ceCount >= 5) {
      hubs.push({
        file: node.id,
        dependents: caCount,
        dependencies: ceCount,
      });
    }
  }

  // sort by total coupling descending
  files.sort((a, b) => (b.ca + b.ce) - (a.ca + a.ce));
  highCoupling.sort((a, b) => b.total - a.total);
  hubs.sort((a, b) => (b.dependents + b.dependencies) - (a.dependents + a.dependencies));

  return { files, highCoupling, hubs };
}
