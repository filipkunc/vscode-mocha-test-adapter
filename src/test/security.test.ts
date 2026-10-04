import assert from 'assert';
import Module from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import { ipcHostOrLoopback } from '../security';
import { createTestMochaAdapter } from './adapter';

// Load the extension-facing modules with a minimal VS Code host. Restore the
// loader immediately so other tests continue to use the real Node modules.
const vscode = {
	workspace: {
		isTrusted: false,
		getConfiguration: () => ({ get: () => undefined }),
		onDidChangeConfiguration: () => ({ dispose() {} }),
		onDidSaveTextDocument: () => ({ dispose() {} })
	},
	window: { createOutputChannel() { throw new Error('Untrusted activation created an output channel'); } }
};
const loader = (Module as any)._load;
let ConfigReader: typeof import('../configReader').ConfigReader;
let activate: typeof import('../main').activate;
try {
	(Module as any)._load = function(name: string, ...args: any[]) {
		return name === 'vscode' ? vscode : loader.call(this, name, ...args);
	};
	ConfigReader = require('../configReader').ConfigReader;
	activate = require('../main').activate;
} finally {
	(Module as any)._load = loader;
}

describe('Security boundaries', function() {
	it('does not initialize logging or adapters in an untrusted workspace', async function() {
		await activate({ subscriptions: [] } as any);
	});

	it('does not read or execute config for an enabled but untrusted folder', async function() {
		const reader = new ConfigReader(
			{ uri: { scheme: 'file', fsPath: __dirname } } as any,
			{ get() { throw new Error('Enabled state must not bypass trust'); } } as any,
			async () => {}, () => {}, { enabled: false } as any
		);
		try {
			assert.strictEqual(await reader.currentConfig, undefined);
		} finally {
			reader.dispose();
		}
	});

	it('keeps env values out of diagnostics and handles a hasOwnProperty env key', async function() {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocha-env-'));
		const logs: string[] = [];
		fs.writeFileSync(path.join(directory, '.env'), 'DOTENV_TOKEN=dotenv-secret\n');
		const reader = new ConfigReader(
			{ uri: { scheme: 'file', fsPath: directory } } as any,
			{} as any, async () => {}, () => {},
			{ enabled: true, debug: (message: string) => logs.push(message) } as any
		);
		try {
			const config = { get: (key: string) => key === 'env'
				? { API_TOKEN: 'config-secret', hasOwnProperty: 'also-secret', UNSET: null }
				: key === 'envPath' ? '.env' : undefined };
			const env = await (reader as any).getEnv(config, { requires: ['esm'] });
			assert.strictEqual(env.API_TOKEN, 'config-secret');
			assert.strictEqual(env.DOTENV_TOKEN, 'dotenv-secret');
			assert.strictEqual(env.NYC_ROOT_ID, '');
			assert.strictEqual(env.UNSET, null);
			assert.ok(logs.some(message => message.includes('API_TOKEN')));
			for (const secret of ['config-secret', 'dotenv-secret', 'also-secret']) {
				assert.ok(logs.every(message => !message.includes(secret)));
			}
		} finally {
			reader.dispose();
			fs.rmSync(directory, { recursive: true });
		}
	});

	it('uses loopback for null, empty and omitted IPC hosts', function() {
		for (const host of [null, undefined, '']) {
			assert.strictEqual(ipcHostOrLoopback(host), '127.0.0.1');
		}
		assert.strictEqual(ipcHostOrLoopback('::1'), '::1');
		assert.strictEqual(ipcHostOrLoopback('remote-host'), 'remote-host');
	});

	it('blocks load, run and debug before reading config when trust is absent', async function() {
		const adapter = await createTestMochaAdapter('javascript/bdd');
		Object.defineProperty(adapter, 'isWorkspaceTrusted', { get: () => false });
		Object.defineProperty(adapter, 'configReader', { value: {
			get currentConfig() { throw new Error('Untrusted operation read config'); },
			reloadConfig() { throw new Error('Untrusted operation reloaded config'); }
		} });
		await adapter.load();
		await adapter.run(['anything']);
		await adapter.debug(['anything']);
		assert.strictEqual(adapter.getLoadedTests(), undefined);
		assert.deepStrictEqual(adapter.getTestRunEvents(), []);
	});

	for (const role of ['client', 'server']) {
		it(`loads tests over TCP with an omitted host (adapter as ${role})`, async function() {
			const adapter = await createTestMochaAdapter('javascript/bdd');
			const config = await (adapter as any).configReader.currentConfig;
			const server = net.createServer();
			await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
			config.ipcPort = (server.address() as net.AddressInfo).port;
			await new Promise<void>(resolve => server.close(() => resolve()));
			config.ipcRole = role;
			config.ipcHost = undefined;
			if (role === 'client') config.nodePath = process.execPath;
			config.mochaOpts.exit = true;
			await adapter.load();
			assert.ok(adapter.getLoadedTests(), adapter.getTestLoadFinishedEvent()?.errorMessage);
			await adapter.run([adapter.getLoadedTests()!.id]);
			assert.ok(adapter.getTestsThatWereRun().some(test => test.result === 'passed'));
		});
	}

	it('supports an IPC launcher that proxies through encrypted TCP without exposing the key to tests', async function() {
		const adapter = await createTestMochaAdapter('javascript/secure');
		const config = await (adapter as any).configReader.currentConfig;
		config.launcherScript = path.resolve(__dirname, '../../examples/secure-launcher.js');
		await adapter.load();
		assert.ok(adapter.getLoadedTests(), adapter.getTestLoadFinishedEvent()?.errorMessage);
		await adapter.run([adapter.getLoadedTests()!.id]);
		assert.deepStrictEqual(adapter.getTestsThatWereRun().map(test => test.result), ['passed']);
	});
});
