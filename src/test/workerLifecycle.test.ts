import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fork } from 'child_process';

describe('Embedded worker lifetime', function() {
	for (const action of ['loadTests', 'runTests']) {
		it(`resolves ${action} after sending the result without terminating its host`, async function() {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocha-embedded-'));
			const worker = path.resolve(__dirname, '../../out/worker/bundle.js');
			const wrapper = path.join(directory, 'host.js');
			const testFile = path.join(directory, 'test.js');
			fs.writeFileSync(testFile, "setInterval(() => {}, 1000); describe('embedded', () => it('passes', () => {}));");
			fs.writeFileSync(wrapper, `require(${JSON.stringify(worker)}).then(() => process.send({ embeddedCompleted: true }, () => process.exit(0)));`);
			const child = fork(wrapper, [], { execArgv: [], silent: true });
			const messages: any[] = [];
			let output = '';
			child.stdout!.resume(); child.stderr!.on('data', data => output += data);
			try {
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(() => { child.kill(); reject(new Error('Embedded worker timed out: ' + output)); }, 5000);
					child.on('message', message => messages.push(message));
					child.once('error', error => { clearTimeout(timer); reject(error); });
					child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(output)); });
					child.send({ action, cwd: directory, testFiles: [testFile], tests: ['embedded passes'], env: {},
						mochaPath: path.dirname(require.resolve('mocha/package.json')), workerScript: worker,
						mochaOpts: { ui: 'bdd', timeout: 1000, retries: 0, requires: [], delay: false, fullTrace: false, exit: true, asyncOnly: false, parallel: false },
						monkeyPatch: true, esmLoader: true, logEnabled: false });
				});
				assert.deepStrictEqual(messages[messages.length - 1], { embeddedCompleted: true });
				assert.ok(messages.some(message => message && message.type === (action === 'loadTests' ? 'suite' : 'finished')));
				if (action === 'runTests') assert.ok(messages.some(message => message && message.type === 'test' && message.state === 'passed'));
			} finally { child.kill(); fs.rmSync(directory, { recursive: true, force: true }); }
		});
	}
});
