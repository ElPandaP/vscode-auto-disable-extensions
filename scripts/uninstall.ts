/**
 * Removes Auto Disable Extensions completely: the extension, the entries it added to each
 * workspace's "Disable (Workspace)" list, and its state. Extensions you disabled yourself stay
 * disabled. Also removes what its profile-based predecessor (AutoProfile, before 0.2) left: the
 * "AutoProfile N" profiles and the old extension id.
 *
 * VS Code must be closed: while running it keeps its storage in memory and rewrites it on exit.
 *
 *   bun scripts/uninstall.ts                      # dry run, shows what would be removed
 *   bun scripts/uninstall.ts --yes                # do it
 *   bun scripts/uninstall.ts --user-data-dir <d> --extensions-dir <e>   # non-default folders (e.g. a sandbox)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

const EXTENSION_ID = 'elpandap.auto-disable-extensions';
const LEGACY_ID = 'autoprofile-dev.autoprofile';
const DISABLED_KEY = 'extensionsIdentifiers/disabled';
const SLOT = /^AutoProfile \d+$/;

const args = process.argv.slice(2);
const apply = args.includes('--yes');
const udIndex = args.indexOf('--user-data-dir');
const customUserData = udIndex >= 0 ? args[udIndex + 1] : undefined;
const edIndex = args.indexOf('--extensions-dir');
const customExtensions = edIndex >= 0 ? args[edIndex + 1] : undefined;
const userDataDir = customUserData ?? defaultUserDataDir();
const userDir = join(userDataDir, 'User');
const storageJson = join(userDir, 'globalStorage', 'storage.json');

function defaultUserDataDir(): string {
	switch (process.platform) {
		case 'win32':
			return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Code');
		case 'darwin':
			return join(homedir(), 'Library', 'Application Support', 'Code');
		default:
			return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Code');
	}
}

function vscodeIsRunning(): boolean {
	if (process.platform === 'win32') {
		const out = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Code.exe', '/NH'], { encoding: 'utf8' }).stdout ?? '';
		return out.toLowerCase().includes('code.exe');
	}
	return spawnSync('pgrep', ['-x', process.platform === 'darwin' ? 'Electron' : 'code'], { encoding: 'utf8' }).status === 0;
}

function codeCli(): string {
	return process.platform === 'win32' ? 'code.cmd' : 'code';
}

interface Storage {
	userDataProfiles?: { location: string | { path?: string }; name: string }[];
	profileAssociations?: { workspaces?: Record<string, string>; emptyWindows?: Record<string, string> };
	[key: string]: unknown;
}

function profileId(location: string | { path?: string }): string {
	const raw = typeof location === 'string' ? location : location.path ?? '';
	return raw.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

if (!existsSync(storageJson)) {
	console.error(`No VS Code data found at ${userDataDir}`);
	process.exit(1);
}
if (customUserData && !customExtensions) {
	console.error('With --user-data-dir also pass --extensions-dir, or the real extensions folder would be used.');
	process.exit(1);
}
if (apply && vscodeIsRunning()) {
	console.error('Close every VS Code window first (VS Code would overwrite storage.json on exit).');
	process.exit(1);
}

const storage = JSON.parse(readFileSync(storageJson, 'utf8')) as Storage;
const slots = (storage.userDataProfiles ?? []).filter(p => SLOT.test(p.name)).map(p => ({ name: p.name, id: profileId(p.location) }));
const slotIds = new Set(slots.map(s => s.id));
const assoc = storage.profileAssociations ?? {};
const affected = Object.entries(assoc.workspaces ?? {}).filter(([, id]) => slotIds.has(id)).map(([ws]) => decodeURIComponent(ws));
// Workspace lists: the extension's state says which ids it added to each workspace.
interface State { workspaces?: Record<string, { disabledByUs?: string[] }> }
const stateFile = join(userDir, 'globalStorage', EXTENSION_ID, 'state.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) as State : {};
const workspaceStorage = join(userDir, 'workspaceStorage');
const storageDirs = existsSync(workspaceStorage) ? readdirSync(workspaceStorage).map(d => join(workspaceStorage, d)) : [];
function workspaceUri(dir: string): string | undefined {
	try {
		const ws = JSON.parse(readFileSync(join(dir, 'workspace.json'), 'utf8')) as { folder?: string; workspace?: string };
		return (ws.folder ?? ws.workspace)?.toLowerCase();
	} catch {
		return undefined;
	}
}
const cleanups = Object.entries(state.workspaces ?? {})
	.filter(([, ws]) => (ws.disabledByUs?.length ?? 0) > 0)
	.flatMap(([key, ws]) => storageDirs
		.filter(dir => workspaceUri(dir) === key.toLowerCase() && existsSync(join(dir, 'state.vscdb')))
		.map(dir => ({ key, db: join(dir, 'state.vscdb'), ids: new Set(ws.disabledByUs!.map(id => id.toLowerCase())) })));

const folders = [
	...slots.map(s => join(userDir, 'profiles', s.id)),
	...slots.map(s => join(userDataDir, 'CachedProfilesData', s.id)),
	...[EXTENSION_ID, LEGACY_ID].map(id => join(userDir, 'globalStorage', id)),
].filter(existsSync);

console.log(`VS Code data: ${userDataDir}`);
console.log(`Extension:    ${EXTENSION_ID} (and legacy ${LEGACY_ID})`);
console.log(`Legacy profiles: ${slots.map(s => s.name).join(', ') || '(none)'}`);
console.log(`Workspaces back to Default: ${affected.length}`);
affected.forEach(ws => console.log(`  ${ws}`));
console.log(`Workspaces where extensions are re-enabled: ${cleanups.length}`);
cleanups.forEach(c => console.log(`  ${decodeURIComponent(c.key)}: ${[...c.ids].join(', ')}`));
console.log(`Folders to delete: ${folders.length}`);
folders.forEach(f => console.log(`  ${f}`));

if (!apply) {
	console.log('\nDry run. Run again with --yes to remove (close VS Code first).');
	process.exit(0);
}

// 1. Extension, current and legacy id (from the Default profile).
for (const id of [EXTENSION_ID, LEGACY_ID]) {
	const cliArgs = [
		...(customUserData ? ['--user-data-dir', customUserData] : []),
		...(customExtensions ? ['--extensions-dir', customExtensions] : []),
		'--uninstall-extension',
		id,
	];
	try {
		// .cmd files need a shell on Windows, which splits on spaces: quote every argument.
		const win = process.platform === 'win32';
		execFileSync(codeCli(), win ? cliArgs.map(a => `"${a}"`) : cliArgs, { stdio: 'pipe', shell: win });
		console.log(`Uninstalled ${id}`);
	} catch {
		// Not installed.
	}
}

// 2. Legacy profiles and their associations.
const backup = `${storageJson}.auto-disable-extensions-backup-${Date.now()}`;
copyFileSync(storageJson, backup);
storage.userDataProfiles = (storage.userDataProfiles ?? []).filter(p => !SLOT.test(p.name));
for (const key of ['workspaces', 'emptyWindows'] as const) {
	const map = assoc[key];
	if (map) {
		for (const [k, id] of Object.entries(map)) {
			if (slotIds.has(id)) {
				delete map[k];
			}
		}
	}
}
writeFileSync(storageJson, JSON.stringify(storage, null, 4));

// 3. Workspace lists (before the state folder that records them is deleted).
for (const c of cleanups) {
	const db = new Database(c.db);
	try {
		const row = db.query<{ value: string }, [string]>('SELECT value FROM ItemTable WHERE key = ?').get(DISABLED_KEY);
		const list = row ? (JSON.parse(row.value) as { id: string }[]) : [];
		const kept = list.filter(e => !c.ids.has(e.id.toLowerCase()));
		if (kept.length === list.length) {
			continue;
		}
		if (kept.length > 0) {
			db.run('UPDATE ItemTable SET value = ? WHERE key = ?', [JSON.stringify(kept), DISABLED_KEY]);
		} else {
			db.run('DELETE FROM ItemTable WHERE key = ?', [DISABLED_KEY]);
		}
	} finally {
		db.close();
	}
}

// 4. Folders.
for (const folder of folders) {
	rmSync(folder, { recursive: true, force: true });
}

console.log(`\nDone. Backup of storage.json: ${backup}`);
