import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanDirectory } from '../src/scanner.js';
import { analyzeAll } from '../src/analyzer/index.js';
import { buildGraph } from '../src/graph/builder.js';
import { findCircularDependencies } from '../src/insights/circular-deps.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures', 'sample-project');

describe('graph builder', () => {
	it('builds graph from fixture project', async () => {
		const files = await scanDirectory(FIXTURES);
		const analyzed = analyzeAll(files);
		const graph = buildGraph(analyzed);

		assert.ok(graph.nodes.length >= 7, `Expected at least 7 nodes, got ${graph.nodes.length}`);
		assert.ok(graph.edges.length >= 5, `Expected at least 5 edges, got ${graph.edges.length}`);
	});

	it('resolves relative imports', async () => {
		const files = await scanDirectory(FIXTURES);
		const analyzed = analyzeAll(files);
		const graph = buildGraph(analyzed);

		// format.js imports from math.js
		const formatToMath = graph.edges.find(
			e => e.source.includes('format.js') && e.target.includes('math.js')
		);
		assert.ok(formatToMath, 'Should have edge from format.js to math.js');
	});
});

describe('circular dependency detection', () => {
	it('finds circular deps in fixture project', async () => {
		const files = await scanDirectory(FIXTURES);
		const analyzed = analyzeAll(files);
		const graph = buildGraph(analyzed);
		const circular = findCircularDependencies(graph);

		assert.ok(circular.length >= 1, 'Should find at least 1 circular dependency');

		// OrderList <-> UserCard is circular
		const hasCycle = circular.some(c =>
			c.cycle.some(f => f.includes('OrderList')) &&
			c.cycle.some(f => f.includes('UserCard'))
		);
		assert.ok(hasCycle, 'Should detect OrderList <-> UserCard cycle');
	});
});
