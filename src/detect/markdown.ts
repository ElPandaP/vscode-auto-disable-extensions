/**
 * Finds diagram languages in Markdown code fences (```mermaid), so diagram extensions stay enabled
 * where the diagrams live inside documentation.
 */

/**
 * Languages used inside Markdown code fences that count as a project signal. Only diagram languages
 * are listed: a ```ts block in a README does not make a TypeScript project, but ```mermaid is the
 * main way Mermaid is used and its extensions declare the `mermaid` language.
 */
const FENCE_LANGUAGES: Record<string, string> = {
	mermaid: 'mermaid',
};

export function isMarkdownFile(path: string): boolean {
	return /\.(md|markdown|mdx)$/i.test(path);
}

/** Signal languages of the code fences in a Markdown text. */
export function fencedLanguages(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(/^ {0,3}(?:`{3,}|~{3,})[ \t]*([\w.+-]+)/gm)) {
		const lang = FENCE_LANGUAGES[match[1]!.toLowerCase()];
		if (lang) {
			found.add(lang);
		}
	}
	return [...found];
}
