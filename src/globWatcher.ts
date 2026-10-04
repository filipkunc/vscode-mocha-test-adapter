import * as path from 'path';
import chokidar, { FSWatcher } from 'chokidar';
import { Minimatch } from 'minimatch';

const normalize = (filename: string) => filename.split(path.sep).join('/');
const matcherOptions = { dot: true, nonegate: true, windowsPathsNoEscape: true, nocase: process.platform === 'win32' };

function compile(pattern: string) {
	const matcher = new Minimatch(normalize(pattern), matcherOptions);
	// nocase turns even literal path segments into regexes. Parse roots with
	// case sensitivity so a Windows drive letter never becomes the first glob.
	const rootMatcher = new Minimatch(normalize(pattern), { ...matcherOptions, nocase: false });
	const roots = rootMatcher.set.map(parts => {
		const firstMagic = parts.findIndex(part => typeof part !== 'string');
		const literalParts = firstMagic < 0 ? parts : parts.slice(0, firstMagic);
		return literalParts.join('/') || path.parse(pattern).root;
	});
	const comparable = (value: string) => matcherOptions.nocase ? value.toLowerCase() : value;
	const matches = (filename: string) => matcher.match(filename) || (!rootMatcher.hasMagic() && roots.some(root =>
		comparable(filename).startsWith(comparable(root.replace(/\/$/, '') + '/'))));
	return { matcher, roots, matches };
}

/** Watch stable directory roots so glob matches created after startup are discovered. */
export function watchGlobs(patterns: string[], ignores: string[]): FSWatcher {
	const included = patterns.filter(pattern => !pattern.startsWith('!')).map(compile);
	const excluded = [...ignores, ...patterns.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1))].map(compile);
	const roots = [...new Set(included.flatMap(pattern => pattern.roots))];
	return chokidar.watch(roots, {
		ignoreInitial: true,
		ignored: (filename, stats) => {
			const normalized = normalize(filename);
			if (excluded.some(pattern => pattern.matches(normalized) || pattern.matcher.match(normalized + '/'))) return true;
			// Keep directories under the roots: they may later contain a matching file.
			return !!stats?.isFile() && !included.some(pattern => pattern.matches(normalized));
		}
	});
}
