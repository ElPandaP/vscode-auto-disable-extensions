/**
 * Human-readable technology names (Rust, React, Tauri…) for the status bar and prompts, derived from
 * the detected languages and dependencies.
 */

/** Display names only: matching always works on language ids and dependencies, never on these labels. */

const LANGUAGE_NAMES: Record<string, string> = {
	rust: 'Rust',
	typescript: 'TypeScript',
	typescriptreact: 'TypeScript',
	javascript: 'JavaScript',
	javascriptreact: 'JavaScript',
	csharp: 'C#',
	fsharp: 'F#',
	python: 'Python',
	java: 'Java',
	kotlin: 'Kotlin',
	go: 'Go',
	ruby: 'Ruby',
	php: 'PHP',
	c: 'C/C++',
	cpp: 'C/C++',
	swift: 'Swift',
	dart: 'Dart',
	lua: 'Lua',
	elixir: 'Elixir',
	haskell: 'Haskell',
	scala: 'Scala',
	zig: 'Zig',
	vue: 'Vue',
	svelte: 'Svelte',
	dockerfile: 'Docker',
	dockercompose: 'Docker',
	terraform: 'Terraform',
	sql: 'SQL',
	powershell: 'PowerShell',
};

const DEPENDENCY_NAMES: Record<string, string> = {
	'npm:react': 'React',
	'npm:vite': 'Vite',
	'npm:next': 'Next.js',
	'npm:nuxt': 'Nuxt',
	'npm:vue': 'Vue',
	'npm:svelte': 'Svelte',
	'npm:@angular/core': 'Angular',
	'npm:tailwindcss': 'Tailwind',
	'npm:@tauri-apps/api': 'Tauri',
	'cargo:tauri': 'Tauri',
	'npm:electron': 'Electron',
	'npm:express': 'Express',
	'npm:@nestjs/core': 'NestJS',
	'pip:django': 'Django',
	'pip:flask': 'Flask',
	'pip:fastapi': 'FastAPI',
	'cargo:axum': 'Axum',
	'cargo:actix-web': 'Actix',
	'cargo:bevy': 'Bevy',
	'nuget:microsoft.aspnetcore.app': 'ASP.NET',
};

const TOOLING = new Set(['Docker', 'Terraform', 'SQL', 'PowerShell']);

export function technologyNames(languages: Iterable<string>, deps: Iterable<string>): string[] {
	const names: string[] = [];
	const push = (name: string | undefined) => {
		if (name && !names.includes(name)) {
			names.push(name);
		}
	};
	for (const lang of languages) {
		push(LANGUAGE_NAMES[lang]);
	}
	for (const dep of deps) {
		push(DEPENDENCY_NAMES[dep]);
	}
	// TypeScript projects always contain some JavaScript (configs); listing both is noise.
	const shown = names.includes('TypeScript') ? names.filter(name => name !== 'JavaScript') : names;
	// Programming languages and frameworks first, infrastructure after.
	return [...shown.filter(n => !TOOLING.has(n)), ...shown.filter(n => TOOLING.has(n))];
}
