/**
 * Combines scanned files, manifest dependencies and Markdown fence languages into a Detection: the
 * languages, dependencies and technology names of the workspace.
 */

import type { Detection, FolderFiles } from '../types';
import { languagesOfFiles, type LanguageIndex } from './languages';
import { technologyNames } from './techs';

/** Combines scanned files, parsed manifest dependencies and Markdown fence languages into a Detection. */
export function detect(folders: FolderFiles[], deps: Iterable<string>, index: LanguageIndex, fencedLanguages: Iterable<string> = []): Detection {
	const languages = new Set<string>(fencedLanguages);
	for (const folder of folders) {
		for (const lang of languagesOfFiles(folder.files, index)) {
			languages.add(lang);
		}
	}
	const sortedLanguages = [...languages].sort();
	const sortedDeps = [...new Set(deps)].sort();
	return {
		folders,
		languages: sortedLanguages,
		deps: sortedDeps,
		techs: technologyNames(sortedLanguages, sortedDeps),
	};
}
