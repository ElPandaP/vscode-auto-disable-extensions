/**
 * Per-workspace overrides: "keep enabled here" (include) and "disable here" (exclude) lists.
 */

import type { WorkspaceOverrides } from './planner';

/** Adds ids to a workspace's include (or exclude) list and removes them from the opposite one. */
export function withRule(overrides: WorkspaceOverrides, kind: 'include' | 'exclude', ids: string[]): WorkspaceOverrides {
	const other = kind === 'include' ? 'exclude' : 'include';
	return {
		...overrides,
		[kind]: [...new Set([...(overrides[kind] ?? []), ...ids])].sort(),
		[other]: (overrides[other] ?? []).filter(id => !ids.includes(id)),
	};
}
