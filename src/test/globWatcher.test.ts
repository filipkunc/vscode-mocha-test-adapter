import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { once } from 'events';
import { watchGlobs } from '../globWatcher';

describe('Glob watches with Chokidar 4', function() {
	it('discovers new matching files and directories, changes and deletions, while honoring ignores', async function() {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocha-watch-'));
		fs.mkdirSync(path.join(directory, 'src'));
		const watcher = watchGlobs([path.join(directory, 'src/**/*.{js,ts}')], [path.join(directory, '**/node_modules/**'), path.join(directory, '**/ignored.js')]);
		const events: string[] = [];
		watcher.on('all', (event, filename) => events.push(`${event}:${path.relative(directory, filename).split(path.sep).join('/')}`));
		const waitFor = (expected: string) => new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => { watcher.removeListener('all', listener); reject(new Error(`Missing watcher event ${expected}: ${events}`)); }, 2000);
			const listener = () => { if (events.includes(expected)) { clearTimeout(timer); watcher.removeListener('all', listener); resolve(); } };
			watcher.on('all', listener);
			listener();
		});
		try {
			await once(watcher, 'ready');
			assert.ok(Object.keys(watcher.getWatched()).every(filename =>
				path.parse(filename).root !== filename), 'A workspace glob must not watch the filesystem root');
			fs.mkdirSync(path.join(directory, 'src/new'));
			const test = path.join(directory, 'src/new/test.ts');
			fs.writeFileSync(test, 'first');
			await waitFor('add:src/new/test.ts');
			fs.writeFileSync(test, 'changed');
			await waitFor('change:src/new/test.ts');
			fs.unlinkSync(test);
			await waitFor('unlink:src/new/test.ts');
			fs.mkdirSync(path.join(directory, 'src/node_modules'));
			fs.writeFileSync(path.join(directory, 'src/node_modules/dependency.js'), 'ignored');
			fs.writeFileSync(path.join(directory, 'src/new/ignored.js'), 'ignored');
			fs.writeFileSync(path.join(directory, 'src/new/unrelated.json'), '{}');
			fs.writeFileSync(path.join(directory, 'src/new/control.js'), 'included');
			await waitFor('add:src/new/control.js');
			await new Promise<void>(resolve => setTimeout(resolve, 150));
			assert.ok(events.every(event => !/dependency.js|ignored.js|unrelated.json/.test(event)));
			assert.ok(Object.keys(watcher.getWatched()).every(filename => !filename.includes('node_modules')));
		} finally { await watcher.close(); fs.rmSync(directory, { recursive: true }); }
	});

	it('supports literal directory watches and negated patterns', async function() {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocha-watch-'));
		const watcher = watchGlobs([directory, '!' + path.join(directory, '**/*.skip')], []);
		const files: string[] = [];
		watcher.on('add', filename => files.push(filename));
		try {
			await once(watcher, 'ready');
			assert.ok(Object.keys(watcher.getWatched()).every(filename =>
				path.parse(filename).root !== filename), 'A workspace glob must not watch the filesystem root');
			const added = once(watcher, 'add');
			fs.writeFileSync(path.join(directory, 'hidden.skip'), 'ignored');
			fs.writeFileSync(path.join(directory, 'visible.txt'), 'included');
			await added;
			await new Promise<void>(resolve => setTimeout(resolve, 150));
			assert.deepStrictEqual(files, [path.join(directory, 'visible.txt')]);
		} finally { await watcher.close(); fs.rmSync(directory, { recursive: true }); }
	});
});
