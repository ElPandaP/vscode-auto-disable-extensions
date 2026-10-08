/**
 * Disposable, isolated VS Code for manual testing (own user-data and extensions folders), created
 * outside the repository so its sample projects never end up in a workspace scan.
 *
 *   bun scripts/sandbox.ts setup [--mode ask|auto]   # fresh sandbox: settings, sample repos, extensions, Auto Disable Extensions .vsix
 *   bun scripts/sandbox.ts open <repo>               # open a sample repo (rust-repo, web-repo, mono, csharp-repo)
 *   bun scripts/sandbox.ts logs                      # print Auto Disable Extensions logs of every sandbox window
 *   bun scripts/sandbox.ts stop                      # close sandbox windows only
 *   bun scripts/sandbox.ts clean                     # stop and delete the sandbox
 *
 * Location: $AUTO_DISABLE_SANDBOX or <tmp>/auto-disable-extensions-sandbox.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.env.AUTO_DISABLE_SANDBOX ?? join(tmpdir(), 'auto-disable-extensions-sandbox'));
const UDD = join(ROOT, 'udd');
const EXTS = join(ROOT, 'exts');
const REPOS = join(ROOT, 'repos');
const PROJECT = fileURLToPath(new URL('..', import.meta.url));

/** Small real extensions covering tech-bound, transversal, dependency and hint cases. */
const EXTENSIONS = [
	'dustypomerleau.rust-syntax',
	'dbaeumer.vscode-eslint',
	'kreativ-software.csharpextensions',
	'ms-azuretools.vscode-containers',
	'usernamehw.errorlens',
	'bierner.markdown-mermaid',
];

const CARGO = '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = "1"\n';
const PACKAGE = JSON.stringify({ name: 'web', dependencies: { react: '^18' }, devDependencies: { vite: '^5', eslint: '^9', typescript: '^5' } });

const REPO_FILES: Record<string, Record<string, string>> = {
	'rust-repo': { 'Cargo.toml': CARGO, 'src/main.rs': 'fn main() {}\n', 'README.md': '# Rust demo\n' },
	'web-repo': { 'package.json': PACKAGE, 'tsconfig.json': '{}', 'src/App.tsx': 'export const App = () => null;\n', 'vite.config.ts': 'export default {};\n' },
	'mono': {
		'backend/Cargo.toml': CARGO,
		'backend/src/main.rs': 'fn main() {}\n',
		'frontend/package.json': PACKAGE,
		'frontend/tsconfig.json': '{}',
		'frontend/src/App.tsx': 'export const App = () => null;\n',
	},
	'csharp-repo': {
		'App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup><PackageReference Include="Newtonsoft.Json" Version="13.0.3" /></ItemGroup>\n</Project>\n',
		'App/Program.cs': 'class P { static void Main() {} }\n',
	},
};

function vscodeExe(): string {
	const cli = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['code'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]?.trim();
	if (!cli) {
		throw new Error('`code` is not on PATH');
	}
	// <install>/bin/code(.cmd) -> <install>/Code.exe on Windows; elsewhere the CLI itself opens windows.
	const exe = join(dirname(dirname(cli)), 'Code.exe');
	return process.platform === 'win32' && existsSync(exe) ? exe : cli;
}

function code(args: string[]): void {
	const all = ['--user-data-dir', UDD, '--extensions-dir', EXTS, ...args];
	if (process.platform === 'win32') {
		// .cmd files need a shell, which splits on spaces: quote every argument.
		execFileSync('code.cmd', all.map(a => `"${a}"`), { stdio: 'inherit', shell: true });
	} else {
		execFileSync('code', all, { stdio: 'inherit' });
	}
}

function stop(): void {
	if (process.platform === 'win32') {
		// Only processes started with this sandbox's user-data-dir.
		spawnSync('powershell', ['-NoProfile', '-Command',
			`Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -like '*${UDD}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`]);
	} else {
		spawnSync('pkill', ['-f', UDD]);
	}
}

/** Deletes the sandbox, retrying while just-killed VS Code processes still hold file locks. */
function remove(): void {
	for (let attempt = 0; ; attempt++) {
		try {
			rmSync(ROOT, { recursive: true, force: true });
			return;
		} catch (err) {
			if (attempt >= 20) {
				throw err;
			}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
		}
	}
}

function setup(mode: string): void {
	stop();
	remove();
	mkdirSync(join(UDD, 'User'), { recursive: true });
	mkdirSync(EXTS, { recursive: true });
	writeFileSync(join(UDD, 'User', 'settings.json'), JSON.stringify({
		'editor.fontSize': 17,
		'workbench.colorTheme': 'Solarized Light',
		'extensions.autoUpdate': false,
		'extensions.autoCheckUpdates': false,
		'update.mode': 'none',
		'telemetry.telemetryLevel': 'off',
		'workbench.startupEditor': 'none',
		'security.workspace.trust.enabled': false,
		// Fresh profiles otherwise show a modal sign-in dialog that blocks CLI-opened windows.
		'chat.disableAIFeatures': true,
		'autoDisableExtensions.mode': mode,
	}, null, 2));
	writeFileSync(join(UDD, 'User', 'keybindings.json'), '[\n  { "key": "ctrl+alt+k", "command": "workbench.action.toggleSidebarVisibility" }\n]\n');
	for (const [repo, files] of Object.entries(REPO_FILES)) {
		for (const [file, content] of Object.entries(files)) {
			const path = join(REPOS, repo, file);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, content);
		}
	}
	const vsix = readdirSync(PROJECT).filter(f => f.endsWith('.vsix')).map(f => join(PROJECT, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
	if (!vsix) {
		throw new Error('No .vsix found; run `bun run package` first');
	}
	code([...EXTENSIONS.flatMap(e => ['--install-extension', e]), '--install-extension', vsix]);
	console.log(`\nSandbox ready at ${ROOT} (mode: ${mode}). Open a repo with: bun scripts/sandbox.ts open rust-repo`);
}

function open(repo: string): void {
	const folder = join(REPOS, repo);
	if (!existsSync(folder)) {
		throw new Error(`Unknown repo "${repo}". Available: ${Object.keys(REPO_FILES).join(', ')}`);
	}
	spawn(vscodeExe(), ['--user-data-dir', UDD, '--extensions-dir', EXTS, '--new-window', folder], { detached: true, stdio: 'ignore' }).unref();
}

function logs(): void {
	const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
		.flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : e.name === 'Auto Disable Extensions.log' ? [join(dir, e.name)] : []);
	const dir = join(UDD, 'logs');
	for (const file of existsSync(dir) ? walk(dir).sort() : []) {
		console.log(`=== ${file.slice(dir.length + 1)}`);
		console.log(readFileSync(file, 'utf8'));
	}
}

const [command, arg] = process.argv.slice(2);
switch (command) {
	case 'setup': {
		const modeIndex = process.argv.indexOf('--mode');
		setup(modeIndex > 0 ? process.argv[modeIndex + 1]! : 'auto');
		break;
	}
	case 'open':
		open(arg ?? 'rust-repo');
		break;
	case 'logs':
		logs();
		break;
	case 'stop':
		stop();
		break;
	case 'clean':
		stop();
		remove();
		console.log(`Deleted ${ROOT}`);
		break;
	default:
		console.log('Usage: bun scripts/sandbox.ts setup [--mode ask|auto] | open <repo> | logs | stop | clean');
}
