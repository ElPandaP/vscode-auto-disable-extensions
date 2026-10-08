import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type * as vscode from 'vscode';
import { DISABLED_KEY, nextDisabledList, reenabledByUser, WorkspaceEnablement } from '../src/vscode/enablement';
import { readInstalledExtensions } from '../src/vscode/inventory';
import { normalizeDrive, resolvePaths, userDataDirFromGlobalStorage } from '../src/vscode/paths';
import { plan, toDisable } from '../src/resolve/planner';
import { ctx, detection, ext, INSTALLED } from './fixtures';

describe('disabled list', () => {
	test('adds and removes only its own entries', () => {
		const current = [{ id: 'user.manual', uuid: 'u1' }, { id: 'old.mine' }];
		expect(nextDisabledList(current, ['old.mine'], ['b.new', 'a.new'])).toEqual({
			list: [{ id: 'user.manual', uuid: 'u1' }, { id: 'a.new' }, { id: 'b.new' }],
			owned: ['a.new', 'b.new'],
		});
	});

	test('does not take over what the user disabled', () => {
		expect(nextDisabledList([{ id: 'User.Manual' }], [], ['user.manual', 'x.y'])).toEqual({
			list: [{ id: 'User.Manual' }, { id: 'x.y' }],
			owned: ['x.y'],
		});
	});

	test('empty wish clears own entries only', () => {
		expect(nextDisabledList([{ id: 'user.manual' }, { id: 'mine.a' }], ['mine.a'], [])).toEqual({ list: [{ id: 'user.manual' }], owned: [] });
	});

	test('owned entries missing from the list were re-enabled by the user', () => {
		expect(reenabledByUser([{ id: 'Mine.A' }], ['mine.a', 'mine.b'])).toEqual(['mine.b']);
	});
});

describe('enablement channel', () => {
	function fakeMemento(values: Record<string, unknown>) {
		const writes: { shared: boolean; key: string; value: unknown }[] = [];
		const storage = {
			initializeExtensionStorage: async (shared: boolean, key: string, fallback: unknown) => values[`${shared}:${key}`] ?? fallback,
			setValue: async (shared: boolean, key: string, value: unknown) => void writes.push({ shared, key, value }),
		};
		return { memento: { _storage: storage } as unknown as vscode.Memento, writes };
	}

	test('reads both scopes and writes the workspace one', async () => {
		const { memento, writes } = fakeMemento({
			[`false:${DISABLED_KEY}`]: [{ id: 'a.b' }, { junk: 1 }],
			[`true:${DISABLED_KEY}`]: [{ id: 'Eamodio.GitLens', uuid: 'x' }],
		});
		const e = WorkspaceEnablement.from(memento)!;
		expect(await e.workspaceDisabled()).toEqual([{ id: 'a.b' }]);
		expect(await e.globallyDisabled()).toEqual(['eamodio.gitlens']);
		await e.setWorkspaceDisabled([{ id: 'c.d' }]);
		await e.setWorkspaceDisabled([]);
		expect(writes).toEqual([
			{ shared: false, key: DISABLED_KEY, value: [{ id: 'c.d' }] },
			{ shared: false, key: DISABLED_KEY, value: undefined },
		]);
	});

	test('unavailable when VS Code internals change', () => {
		expect(WorkspaceEnablement.from({} as vscode.Memento)).toBeUndefined();
		expect(WorkspaceEnablement.from({ _storage: { setValue() {} } } as unknown as vscode.Memento)).toBeUndefined();
	});
});

describe('paths', () => {
	test('drive letters are upper-cased', () => {
		expect(normalizeDrive('c:\\Users\\x')).toBe('C:\\Users\\x');
		expect(normalizeDrive('/home/x')).toBe('/home/x');
	});

	test('user data dir and profile from globalStorage', () => {
		expect(userDataDirFromGlobalStorage('c:\\data\\udd\\User\\globalStorage\\pub.ext')).toBe('C:\\data\\udd');
		const inProfile = resolvePaths({ globalStoragePath: '/home/u/.config/Code/User/profiles/-3e8e/globalStorage/pub.ext', extensionPath: '/home/u/.vscode/extensions/pub.ext-1.0.0' });
		expect(inProfile).toEqual({
			userDataDir: '/home/u/.config/Code',
			extensionsDir: '/home/u/.vscode/extensions',
			defaultExtensionsJson: join('/home/u/.vscode/extensions', 'extensions.json'),
			profileExtensionsJson: join('/home/u/.config/Code', 'User', 'profiles', '-3e8e', 'extensions.json'),
		});
		expect(resolvePaths({ globalStoragePath: 'C:\\udd\\User\\globalStorage\\pub.ext', extensionPath: 'C:\\e\\pub.ext-1' }).profileExtensionsJson).toBeUndefined();
	});
});

describe('installed extensions', () => {
	async function setup(profileList?: string[]) {
		const root = await mkdtemp(join(tmpdir(), 'ade-inventory-'));
		const extensionsDir = join(root, 'extensions');
		for (const id of ['a.one', 'b.two']) {
			await mkdir(join(extensionsDir, `${id}-1.0.0`), { recursive: true });
			await writeFile(join(extensionsDir, `${id}-1.0.0`, 'package.json'), JSON.stringify({ name: id.split('.')[1], displayName: id }));
		}
		const entry = (id: string) => ({ identifier: { id: id.toUpperCase() }, relativeLocation: `${id}-1.0.0`, metadata: { isApplicationScoped: id === 'a.one' } });
		await writeFile(join(extensionsDir, 'extensions.json'), JSON.stringify([entry('a.one'), entry('b.two')]));
		const profileJson = join(root, 'profile', 'extensions.json');
		if (profileList) {
			await mkdir(dirname(profileJson), { recursive: true });
			await writeFile(profileJson, JSON.stringify(profileList.map(entry)));
		}
		return { root, paths: { userDataDir: root, extensionsDir, defaultExtensionsJson: join(extensionsDir, 'extensions.json'), profileExtensionsJson: profileJson } };
	}

	test('reads the current profile, ids lower-cased', async () => {
		const { root, paths } = await setup(['b.two']);
		try {
			expect(await readInstalledExtensions(paths)).toEqual([{ id: 'b.two', manifest: { name: 'two', displayName: 'b.two' }, isBuiltin: false, isApplicationScoped: false }]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test('falls back to Default when the profile shares its extensions', async () => {
		const { root, paths } = await setup();
		try {
			const exts = await readInstalledExtensions(paths);
			expect(exts.map(e => [e.id, e.isApplicationScoped])).toEqual([['a.one', true], ['b.two', false]]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe('what to disable', () => {
	test('everything managed the plan leaves out, never application-scoped ones', () => {
		const installed = [...INSTALLED, ext('everywhere.ext', { activationEvents: ['onLanguage:python'] }, { isApplicationScoped: true })];
		const p = plan(installed, detection(['Cargo.toml', 'src/main.rs']), ctx(installed));
		const off = toDisable(installed, p);
		expect(off).toContain('ms-dotnettools.csharp');
		expect(off).not.toContain('rust-lang.rust-analyzer');
		expect(off).not.toContain('everywhere.ext');
		expect(off).toEqual([...off].sort());
	});
});
