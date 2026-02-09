import { findCircularDependencies } from './circular-deps.js';
import { findDeadExports, findOrphanFiles } from './dead-code.js';
import { findComplexityIssues } from './complexity.js';
import { analyzeCoupling } from './coupling.js';

export function runInsights(graph, analyzedFiles, routes = []) {
  const circular = findCircularDependencies(graph);
  const { deadExports } = findDeadExports(graph, analyzedFiles);
  const orphans = findOrphanFiles(graph, analyzedFiles, routes);
  const complexFiles = findComplexityIssues(analyzedFiles);
  const couplingIssues = analyzeCoupling(graph);

  return {
    circular,
    deadExports,
    orphans,
    complexFiles: complexFiles.complexFiles,
    couplingIssues: couplingIssues.highCoupling,
    // full data for detailed reports
    _detail: {
      complexity: complexFiles,
      coupling: couplingIssues,
    },
  };
}

export function summarizeInsights(insights) {
  const issues = [];

  if (insights.circular.length) {
    const errors = insights.circular.filter(c => c.severity === 'error').length;
    const warnings = insights.circular.length - errors;
    issues.push(`${insights.circular.length} circular dependencies (${errors} critical)`);
  }

  if (insights.deadExports.length) {
    issues.push(`${insights.deadExports.length} unused exports`);
  }

  if (insights.orphans.length) {
    issues.push(`${insights.orphans.length} orphan files`);
  }

  if (insights.complexFiles.length) {
    issues.push(`${insights.complexFiles.length} complex files`);
  }

  if (insights.couplingIssues.length) {
    issues.push(`${insights.couplingIssues.length} high-coupling files`);
  }

  return issues;
}
