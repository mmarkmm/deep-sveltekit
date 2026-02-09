import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { scanDirectory } from './scanner.js';
import { analyzeAll } from './analyzer/index.js';
import { detectFramework } from './frameworks/detect.js';
import { buildGraph } from './graph/builder.js';
import { runInsights } from './insights/index.js';
import { analyzeSvelteKitRoutes } from './frameworks/sveltekit.js';
import { generateHTML } from './output/html.js';
import { writeJSON } from './output/json.js';
import { exec } from 'child_process';

// ansi helpers
const c = {
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  reset: '\x1b[0m'
};

function parseArgs(args) {
  const opts = {
    directory: null,
    output: 'deep-sveltekit-report.html',
    format: 'html',
    framework: null,
    depth: undefined,
    open: true,
    version: false,
    help: false
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') { opts.help = true; i++; continue; }
    if (arg === '-v' || arg === '--version') { opts.version = true; i++; continue; }
    if (arg === '--no-open') { opts.open = false; i++; continue; }

    if ((arg === '-o' || arg === '--output') && args[i + 1]) {
      opts.output = args[++i]; i++; continue;
    }
    if ((arg === '-f' || arg === '--format') && args[i + 1]) {
      opts.format = args[++i]; i++; continue;
    }
    if (arg === '--framework' && args[i + 1]) {
      opts.framework = args[++i]; i++; continue;
    }
    if (arg === '--depth' && args[i + 1]) {
      opts.depth = parseInt(args[++i], 10); i++; continue;
    }

    // positional = directory
    if (!arg.startsWith('-')) {
      opts.directory = arg;
    }
    i++;
  }

  // adjust output extension based on format
  if (opts.format === 'json' && opts.output === 'deep-sveltekit-report.html') {
    opts.output = 'deep-sveltekit-report.json';
  }

  return opts;
}

async function getVersion() {
  try {
    const pkgPath = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

function printHelp(version) {
  process.stdout.write(`
${c.bold(`deep-sveltekit v${version}`)} - Static analysis for SvelteKit

${c.bold('Usage:')}
  deep-sveltekit <directory> [options]

${c.bold('Options:')}
  -o, --output <file>     Output file path ${c.dim('(default: deep-sveltekit-report.html)')}
  -f, --format <type>     Output format: html, json ${c.dim('(default: html)')}
  --depth <n>             Max directory depth
  --no-open               Don't open report in browser
  -v, --version           Show version
  -h, --help              Show help

${c.bold('Examples:')}
  deep-sveltekit .
  deep-sveltekit ./src
  deep-sveltekit ./src -o report.html
`);
}

function openInBrowser(filePath) {
  const cmd = process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' : 'xdg-open';

  exec(`${cmd} "${filePath}"`, () => {
    // ignore errors, not critical
  });
}

export async function run(args) {
  const opts = parseArgs(args);
  const version = await getVersion();

  if (opts.version) {
    process.stdout.write(`deep-sveltekit v${version}\n`);
    return;
  }

  if (opts.help) {
    printHelp(version);
    return;
  }

  const directory = opts.directory || '.';
  const rootDir = resolve(directory);

  process.stdout.write(`\n${c.bold(`deep-sveltekit v${version}`)}\n`);
  process.stdout.write(`${c.dim('Scanning')} ${rootDir}\n\n`);

  // scan
  const files = await scanDirectory(rootDir, { depth: opts.depth });
  process.stdout.write(`  ${c.green('found')} ${files.length} files\n`);

  if (files.length === 0) {
    process.stdout.write(`\n${c.yellow('No supported files found.')} Check the directory path.\n`);
    return;
  }

  // analyze
  const analyzed = analyzeAll(files);
  const parseErrors = analyzed.filter(f => f.parseError).length;
  const totalFunctions = analyzed.reduce((sum, f) => sum + f.functions.length, 0);
  process.stdout.write(`  ${c.green('analyzed')} ${analyzed.length} files (${totalFunctions} functions)`);
  if (parseErrors > 0) {
    process.stdout.write(` ${c.yellow(`[${parseErrors} parse errors]`)}`);
  }
  process.stdout.write('\n');

  // detect framework
  let frameworkInfo;
  if (opts.framework) {
    frameworkInfo = { name: opts.framework };
  } else {
    frameworkInfo = await detectFramework(rootDir, files);
  }
  const framework = frameworkInfo.name;
  process.stdout.write(`  ${c.green('framework')} ${framework}\n`);

  // extract routes (SvelteKit file-based routing)
  let routes = [];
  if (framework === 'sveltekit') {
    routes = analyzeSvelteKitRoutes(files, analyzed);
  }
  if (routes.length > 0) {
    process.stdout.write(`  ${c.green('routes')} ${routes.length}\n`);
  }

  // build graph
  const graph = buildGraph(analyzed);
  process.stdout.write(`  ${c.green('graph')} ${graph.nodes.length} nodes, ${graph.edges.length} edges\n`);

  // insights
  const insights = runInsights(graph, analyzed, routes);

  // build report data
  const reportData = {
    meta: {
      name: rootDir.split('/').pop(),
      root: rootDir,
      framework,
      generatedAt: new Date().toISOString(),
      version
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
      parseErrors
    }
  };

  // output
  const outputPath = resolve(opts.output);
  if (opts.format === 'json') {
    await writeJSON(reportData, outputPath);
  } else {
    const html = await generateHTML(reportData);
    const { writeFile } = await import('fs/promises');
    await writeFile(outputPath, html, 'utf-8');
  }

  // summary
  process.stdout.write(`\n${c.bold('Summary:')}\n`);
  process.stdout.write(`  Files:        ${analyzed.length}\n`);
  process.stdout.write(`  Functions:    ${totalFunctions}\n`);
  process.stdout.write(`  Dependencies: ${graph.edges.length}\n`);
  process.stdout.write(`  Circular:     ${insights.circular.length}\n`);
  process.stdout.write(`  Orphans:      ${insights.orphans.length}\n`);
  process.stdout.write(`\n  ${c.cyan('report')} ${outputPath}\n\n`);

  // open
  if (opts.open && opts.format === 'html') {
    openInBrowser(outputPath);
  }
}
