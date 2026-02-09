import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFile } from '../src/analyzer/parser.js';
import { extractModuleInfo } from '../src/analyzer/module-analyzer.js';
import { extractFunctions } from '../src/analyzer/function-analyzer.js';
import { extractCalls } from '../src/analyzer/call-analyzer.js';

describe('parser', () => {
	it('parses basic ES module', () => {
		const code = `
			import { foo } from './bar.js';
			export function baz(x) { return foo(x); }
		`;
		const ast = parseFile(code, 'test.js');
		assert.ok(ast, 'Should return AST');
		assert.equal(ast.type, 'Program');
	});

	it('parses JSX', () => {
		const code = `
			export function App() {
				return <div className="app"><h1>Hello</h1></div>;
			}
		`;
		const ast = parseFile(code, 'test.jsx');
		assert.ok(ast, 'Should parse JSX');
	});

	it('returns null for unparseable content', () => {
		const ast = parseFile('this is not {{ valid }} js $$', 'test.js');
		assert.equal(ast, null);
	});
});

describe('module-analyzer', () => {
	it('extracts imports', () => {
		const ast = parseFile(`
			import { foo, bar } from './utils.js';
			import baz from './baz.js';
		`, 'test.js');

		const { imports } = extractModuleInfo(ast);
		assert.equal(imports.length, 2);
		assert.equal(imports[0].source, './utils.js');
		assert.equal(imports[0].specifiers.length, 2);
		assert.equal(imports[1].source, './baz.js');
	});

	it('extracts exports', () => {
		const ast = parseFile(`
			export function doStuff() {}
			export const VALUE = 42;
			export class MyClass {}
			export default function main() {}
		`, 'test.js');

		const { exports } = extractModuleInfo(ast);
		assert.equal(exports.length, 4);

		const names = exports.map(e => e.name);
		assert.ok(names.includes('doStuff'));
		assert.ok(names.includes('VALUE'));
		assert.ok(names.includes('MyClass'));
	});

	it('detects export types correctly', () => {
		const ast = parseFile(`
			export function fn() {}
			export class Cls {}
			export const arrow = () => {};
			export const val = 42;
		`, 'test.js');

		const { exports } = extractModuleInfo(ast);
		const fn = exports.find(e => e.name === 'fn');
		const cls = exports.find(e => e.name === 'Cls');
		const arrow = exports.find(e => e.name === 'arrow');

		assert.equal(fn.type, 'function');
		assert.equal(cls.type, 'class');
		assert.equal(arrow.type, 'function');
	});
});

describe('function-analyzer', () => {
	it('extracts functions', () => {
		const code = `
			function standalone(a, b) { return a + b; }
			const arrow = (x) => x * 2;
			async function fetchData(url) { return fetch(url); }
		`;
		const ast = parseFile(code, 'test.js');
		const { functions } = extractFunctions(ast, code);

		assert.ok(functions.length >= 3, `Expected at least 3 functions, got ${functions.length}`);

		const names = functions.map(f => f.name);
		assert.ok(names.includes('standalone'));
		assert.ok(names.includes('arrow'));
		assert.ok(names.includes('fetchData'));

		const fetchFn = functions.find(f => f.name === 'fetchData');
		assert.equal(fetchFn.async, true);
	});

	it('extracts classes with methods', () => {
		const code = `
			class Animal {
				constructor(name) {
					this.name = name;
				}
				speak() {
					return this.name + ' makes a noise';
				}
				static create(name) {
					return new Animal(name);
				}
			}
		`;
		const ast = parseFile(code, 'test.js');
		const { classes } = extractFunctions(ast, code);

		assert.equal(classes.length, 1);
		assert.equal(classes[0].name, 'Animal');
		assert.ok(classes[0].methods.length >= 3);

		const staticMethod = classes[0].methods.find(m => m.name === 'create');
		assert.ok(staticMethod, 'Should find static method');
	});
});

describe('call-analyzer', () => {
	it('extracts direct calls', () => {
		const code = `
			function main() {
				foo();
				bar(1, 2);
			}
		`;
		const ast = parseFile(code, 'test.js');
		const calls = extractCalls(ast);

		const callNames = calls.map(c => c.callee);
		assert.ok(callNames.includes('foo'));
		assert.ok(callNames.includes('bar'));
	});

	it('extracts member calls', () => {
		const code = `
			class Repo {
				async find() {
					const result = await this.collection.findOne({ id: 1 });
					console.log(result);
					return result;
				}
			}
		`;
		const ast = parseFile(code, 'test.js');
		const calls = extractCalls(ast);

		const callNames = calls.map(c => c.callee);
		assert.ok(callNames.some(n => n.includes('findOne')), 'Should find findOne call');
		assert.ok(callNames.some(n => n.includes('console.log')), 'Should find console.log call');
	});
});
