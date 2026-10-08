import { describe, expect, test } from 'bun:test';
import { withRule } from '../src/resolve/overrides';

describe('workspace overrides', () => {
	test('include moves ids out of exclude', () => {
		expect(withRule({ include: ['a'], exclude: ['b', 'c'] }, 'include', ['c', 'd'])).toEqual({ include: ['a', 'c', 'd'], exclude: ['b'] });
	});

	test('exclude moves ids out of include', () => {
		expect(withRule({ include: ['a', 'b'] }, 'exclude', ['a'])).toEqual({ include: ['b'], exclude: ['a'] });
	});

	test('empty rule is a no-op on lists', () => {
		expect(withRule({}, 'include', [])).toEqual({ include: [], exclude: [] });
	});
});
