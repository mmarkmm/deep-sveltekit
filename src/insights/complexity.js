const FILE_COMPLEXITY_THRESHOLD = 20;
const FUNCTION_COMPLEXITY_THRESHOLD = 10;
const HOTSPOT_COUNT = 10;

export function findComplexityIssues(analyzedFiles, metrics) {
  const complexFiles = [];
  const complexFunctions = [];
  let totalComplexity = 0;
  let fileCount = 0;

  for (const file of analyzedFiles) {
    const m = file.metrics;
    if (!m) continue;

    fileCount++;
    totalComplexity += m.complexity || 0;

    const fileFns = [];

    if (m.functionComplexity) {
      for (const fn of m.functionComplexity) {
        if (fn.complexity >= FUNCTION_COMPLEXITY_THRESHOLD) {
          const entry = {
            file: file.path,
            function: fn.name,
            complexity: fn.complexity,
            line: fn.line,
          };
          complexFunctions.push(entry);
          fileFns.push(fn);
        }
      }
    }

    if ((m.complexity || 0) >= FILE_COMPLEXITY_THRESHOLD) {
      complexFiles.push({
        file: file.path,
        complexity: m.complexity,
        maintainability: m.maintainability,
        functions: fileFns,
      });
    }
  }

  // sort most complex first
  complexFiles.sort((a, b) => b.complexity - a.complexity);
  complexFunctions.sort((a, b) => b.complexity - a.complexity);

  // top hotspots combine complexity + maintainability
  const hotspots = buildHotspots(analyzedFiles);

  return {
    complexFiles,
    complexFunctions,
    hotspots,
    averageComplexity: fileCount ? Math.round((totalComplexity / fileCount) * 10) / 10 : 0,
  };
}

function buildHotspots(analyzedFiles) {
  const scored = [];

  for (const file of analyzedFiles) {
    const m = file.metrics;
    if (!m) continue;

    // score: higher complexity + lower maintainability = worse
    const complexityScore = (m.complexity || 0) / FILE_COMPLEXITY_THRESHOLD;
    const maintScore = m.maintainability != null ? (100 - m.maintainability) / 50 : 0;
    const sizeScore = (m.linesOfCode || 0) / 500;

    const score = complexityScore + maintScore + sizeScore;
    if (score < 0.5) continue;

    const reasons = [];
    if ((m.complexity || 0) >= FILE_COMPLEXITY_THRESHOLD) {
      reasons.push(`complexity: ${m.complexity}`);
    }
    if (m.maintainability != null && m.maintainability < 40) {
      reasons.push(`low maintainability: ${m.maintainability}`);
    }
    if ((m.linesOfCode || 0) > 300) {
      reasons.push(`${m.linesOfCode} lines`);
    }

    scored.push({
      file: file.path,
      score: Math.round(score * 100) / 100,
      reason: reasons.join(', ') || 'accumulated complexity',
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, HOTSPOT_COUNT);
}
