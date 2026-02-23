export { scanDirectory } from './scanner.js';
export { analyzeFile, analyzeAll } from './analyzer/index.js';
export { detectFramework } from './frameworks/detect.js';
export { analyzeSvelteKitRoutes } from './frameworks/sveltekit.js';
export { buildGraph } from './graph/builder.js';
export { runInsights } from './insights/index.js';
export { generateHTML } from './output/html.js';
export { generateJSON, writeJSON } from './output/json.js';

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { scanDirectory } from './scanner.js';
import { analyzeAll } from './analyzer/index.js';
import { detectFramework } from './frameworks/detect.js';
import { analyzeSvelteKitRoutes } from './frameworks/sveltekit.js';
import { buildGraph } from './graph/builder.js';
import { runInsights } from './insights/index.js';

export async function analyze(directory, options = {}) {
  const files = await scanDirectory(directory, { depth: options.depth });
  const analyzed = analyzeAll(files);
  const frameworkInfo = await detectFramework(directory, files);
  const framework = frameworkInfo.name;

  let routes = [];
  if (framework === 'sveltekit') {
    routes = analyzeSvelteKitRoutes(files, analyzed);
  }

  const graph = buildGraph(analyzed);
  const insights = runInsights(graph, analyzed, routes, framework);
  const totalFunctions = analyzed.reduce((sum, f) => sum + f.functions.length, 0);

  return {
    meta: {
      name: directory.split('/').pop(),
      root: directory,
      version: (() => { try { const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'); return JSON.parse(readFileSync(p, 'utf-8')).version; } catch(e) { return '1.0.0'; } })(),
      framework,
      generatedAt: new Date().toISOString(),
    },
    files: analyzed,
    graph,
    routes,
    insights,
    stats: {
      totalFiles: analyzed.length,
      totalFunctions,
      totalDependencies: graph.edges.length,
      totalExports: analyzed.reduce((sum, f) => sum + f.exports.length, 0),
      parseErrors: analyzed.filter(f => f.parseError).length,
    },
  };
}
