/**
 * Builds a workspace's plan: which installed extensions it needs and why, which it does not, plus
 * the dependencies of the needed ones. `toDisable` turns the plan into the list to disable.
 */

import { createHash } from 'node:crypto';
import picomatch from 'picomatch';
import type { Binding, Detection, InstalledExtension, Plan, PlannedExtension } from '../types';
import { classify, type ClassifyContext } from './classify';

export interface WorkspaceOverrides {
	include?: string[];
	exclude?: string[];
}

const matchers = new Map<string, (path: string) => boolean>();

function matcher(pattern: string): (path: string) => boolean {
	let isMatch = matchers.get(pattern);
	if (!isMatch) {
		isMatch = picomatch(pattern, { dot: true, nocase: true });
		matchers.set(pattern, isMatch);
	}
	return isMatch;
}

/** Why a binding matches the detection, or undefined when it does not. */
export function matchReason(binding: Binding, detection: Detection): string | undefined {
	const lang = binding.languages.find(l => detection.languages.includes(l));
	if (lang) {
		return `language ${lang}`;
	}
	const dep = binding.deps.find(d => detection.deps.includes(d));
	if (dep) {
		return `dependency ${dep}`;
	}
	for (const pattern of binding.files) {
		const isMatch = matcher(pattern);
		const file = detection.folders.flatMap(f => f.files).find(f => isMatch(f));
		if (file) {
			return `file ${file}`;
		}
	}
	return undefined;
}

export function planHash(ids: string[]): string {
	return createHash('sha1').update([...ids].sort().join('\n')).digest('hex').slice(0, 10);
}

/**
 * Picks the extensions a workspace needs out of everything installed in the current profile.
 * Built-in extensions and those marked "Apply Extension to all Profiles" are never managed.
 */
export function plan(
	installed: InstalledExtension[],
	detection: Detection,
	ctx: ClassifyContext,
	overrides: WorkspaceOverrides = {},
): Plan {
	const managed = installed.filter(e => !e.isBuiltin && !e.isApplicationScoped);
	const byId = new Map(managed.map(e => [e.id, e]));
	const include = new Set(overrides.include ?? []);
	const exclude = new Set(overrides.exclude ?? []);

	const chosen = new Map<string, PlannedExtension>();
	const excluded: { id: string; reason: string }[] = [];

	for (const ext of managed) {
		if (exclude.has(ext.id)) {
			excluded.push({ id: ext.id, reason: 'excluded for this workspace' });
			continue;
		}
		if (include.has(ext.id)) {
			chosen.set(ext.id, { id: ext.id, reason: 'included for this workspace' });
			continue;
		}
		const binding = classify(ext, ctx);
		switch (binding.kind) {
			case 'transversal':
				chosen.set(ext.id, { id: ext.id, reason: `always (${binding.source})` });
				break;
			case 'tech': {
				const why = matchReason(binding, detection);
				if (why) {
					chosen.set(ext.id, { id: ext.id, reason: why });
				} else {
					excluded.push({ id: ext.id, reason: `not used here (${binding.source})` });
				}
				break;
			}
			case 'never':
				excluded.push({ id: ext.id, reason: 'never (user rule)' });
				break;
			case 'pack':
				excluded.push({ id: ext.id, reason: 'extension pack (members are handled individually)' });
				break;
			case 'dependencyOnly':
				// Added below if something chosen depends on it.
				break;
		}
	}

	// Pull in dependencies of everything chosen, transitively.
	const queue = [...chosen.keys()];
	while (queue.length > 0) {
		const id = queue.pop()!;
		for (const dep of byId.get(id)?.manifest.extensionDependencies ?? []) {
			const depId = dep.toLowerCase();
			const depExt = byId.get(depId);
			if (depExt && !chosen.has(depId) && !exclude.has(depId)) {
				chosen.set(depId, { id: depId, reason: `required by ${id}` });
				queue.push(depId);
			}
		}
	}

	const chosenIds = new Set(chosen.keys());
	for (const ext of managed) {
		if (!chosenIds.has(ext.id) && !excluded.some(e => e.id === ext.id)) {
			excluded.push({ id: ext.id, reason: 'only needed as a dependency' });
		}
	}

	const extensions = [...chosen.values()].sort((a, b) => a.id.localeCompare(b.id));
	return {
		extensions,
		hash: planHash(extensions.map(e => e.id)),
		excluded: excluded.sort((a, b) => a.id.localeCompare(b.id)),
	};
}

/** Managed extensions the plan leaves out: the ones to disable in the workspace. */
export function toDisable(installed: InstalledExtension[], plan: Plan): string[] {
	const needed = new Set(plan.extensions.map(e => e.id));
	return installed
		.filter(e => !e.isBuiltin && !e.isApplicationScoped && !needed.has(e.id))
		.map(e => e.id)
		.sort();
}

/** Lower-case ids that some installed extension depends on. */
export function dependedOn(installed: InstalledExtension[]): Set<string> {
	const ids = new Set<string>();
	for (const ext of installed) {
		for (const dep of ext.manifest.extensionDependencies ?? []) {
			ids.add(dep.toLowerCase());
		}
	}
	return ids;
}
