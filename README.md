# deep-sveltekit

Static analysis for SvelteKit projects. One command, one HTML file.

```bash
npx deep-sveltekit ./src
```

Parses the AST, resolves `$lib` and barrel re-exports, and generates a self-contained interactive report.

## What you get

- **Tree** — file explorer with complexity, coupling, and function counts inline
- **Treemap** — file sizes as nested rectangles, click to drill down
- **Routes** — every route with method badges you can filter
- **Insights** — health score, risk hotspots, circular deps, dead exports, orphans, duplicate import paths, import/export mismatches

Everything in a single HTML file. No runtime dependencies.

## Usage

```bash
npx deep-sveltekit ./src                    # scan and open
npx deep-sveltekit ./src -o report.html     # custom output
npx deep-sveltekit ./src -f json            # JSON output
npx deep-sveltekit ./src --no-open          # don't open browser
```

## API

```js
import { analyze } from 'deep-sveltekit';

const report = await analyze('./src');
```

## License

MIT
