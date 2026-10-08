/**
 * Loads hints.json, corrections for popular extensions whose manifest says too little or too much,
 * and normalizes the user's `autoDisableExtensions.extensions` rules.
 */

import type { Rule, UserRule } from '../types';
import rawHints from './hints.json';

/** Project hints shipped with the extension, keyed by lower-case id ($comment entries dropped). */
export const PROJECT_HINTS: Record<string, Rule> = Object.fromEntries(
	Object.entries(rawHints as Record<string, unknown>)
		.filter(([key]) => !key.startsWith('$'))
		.map(([key, value]) => [key.toLowerCase(), value as Rule]),
);

/** Normalizes the `autoDisableExtensions.extensions` setting (keys lower-cased, junk dropped). */
export function normalizeUserRules(value: unknown): Record<string, UserRule> {
	const rules: Record<string, UserRule> = {};
	if (!value || typeof value !== 'object') {
		return rules;
	}
	for (const [id, rule] of Object.entries(value)) {
		if (rule === 'always' || rule === 'never' || (rule && typeof rule === 'object')) {
			rules[id.toLowerCase()] = rule as UserRule;
		}
	}
	return rules;
}
