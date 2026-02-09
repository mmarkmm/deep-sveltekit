# deep-sveltekit

Architecture visualization for SvelteKit projects.

```bash
npx deep-sveltekit ./src
```

Scans your codebase, parses the AST, resolves all imports (`$lib`, barrel re-exports, aliases), and outputs a single interactive HTML report.

## Features

- **Graph** — Three-layer architecture map (Routes / Modules / Core) with dependency arrows, client/server classification, complexity indicators
- **Routes** — Every detected route with HTTP method breakdown
- **Insights** — Circular deps, dead exports, orphan files, complexity hotspots, coupling
- **Tree** — Full file explorer with per-file complexity

Zero runtime dependencies in the output — one HTML file, works anywhere.

## Usage

```bash
npx deep-sveltekit ./src                    # scan and open report
npx deep-sveltekit ./src -o report.html     # custom output path
npx deep-sveltekit ./src -f json            # JSON output
npx deep-sveltekit ./src --no-open          # don't open browser
```

## API

```js
import { analyze } from 'deep-sveltekit';

const report = await analyze('./src');
console.log(report.stats);
console.log(report.insights.circular);
```

## How it works

1. Walks the directory, finds `.js` `.ts` `.jsx` `.tsx` `.svelte` files
2. Parses with [acorn](https://github.com/acornjs/acorn), extracts imports/exports/functions
3. Resolves `$lib`, relative paths, barrel re-exports
4. Builds dependency graph, runs circular dep detection, dead export analysis, complexity scoring
5. Renders self-contained HTML

## License

MIT
