import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanDirectory } from '../src/scanner.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures', 'sample-project');

describe('scanner', () => {
	it('finds all js files in fixture project', async () => {
		const files = await scanDirectory(FIXTURES);
		assert.ok(files.length >= 7, `Expected at least 7 files, got ${files.length}`);

		const paths = files.map(f => f.path);
		assert.ok(paths.some(p => p.includes('math.js')), 'Should find math.js');
		assert.ok(paths.some(p => p.includes('users.js')), 'Should find users.js');
		assert.ok(paths.some(p => p.includes('orphan.js')), 'Should find orphan.js');
	});

	it('returns correct file metadata', async () => {
		const files = await scanDirectory(FIXTURES);
		const math = files.find(f => f.path.includes('math.js'));

		assert.ok(math, 'Should find math.js');
		assert.ok(math.content.length > 0, 'Content should not be empty');
		assert.ok(math.lines > 0, 'Should have line count');
		assert.ok(math.size > 0, 'Should have file size');
		assert.equal(math.extension, '.js');
		assert.ok(math.fullPath.endsWith('math.js'));
	});

	it('ignores node_modules by default', async () => {
		const files = await scanDirectory(FIXTURES);
		const nodeModFiles = files.filter(f => f.path.includes('node_modules'));
		assert.equal(nodeModFiles.length, 0, 'Should not include node_modules files');
	});
});
