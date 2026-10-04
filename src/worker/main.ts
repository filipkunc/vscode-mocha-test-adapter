import * as path from 'path';
import * as fs from 'fs';
import * as util from 'util';
import Module from 'module';
import RegExEscape from 'escape-string-regexp';
import { WorkerArgs, ErrorInfo, NetworkOptions } from 'vscode-test-adapter-remoting-util/out/mocha';
import { patchMocha } from './patchMocha';
import { processTests } from './processTests';
import ReporterFactory from './reporter';
import { fileExists } from '../util';
import { createSecureConnection, receiveSecureConnection, readSecureMessages, writeSecureMessage, ipcKeyVariable } from '../secureIpc';
import { assertWorkerRuntime } from '../runtime';

export default (async () => {
	assertWorkerRuntime();
	const key = process.env[ipcKeyVariable];
	delete process.env[ipcKeyVariable];

	let netOpts: NetworkOptions | undefined;

	const role = process.env['MOCHA_WORKER_IPC_ROLE'];
	const port = parseInt(process.env['MOCHA_WORKER_IPC_PORT'] || '');
	const host = process.env['MOCHA_WORKER_IPC_HOST'];
	if (((role === 'client') || (role === 'server')) && port) {
		netOpts = { role, port, host };
	}

	if (!netOpts && (process.argv.length > 2) &&
		process.argv[2].startsWith('{') && process.argv[2].endsWith('}')) {
		netOpts = JSON.parse(process.argv[2]);
	}

	if (netOpts && netOpts.role && netOpts.port) {

		const socket = (netOpts.role === 'client') ?
			await createSecureConnection(netOpts.port, { host: netOpts.host, key }) :
			await receiveSecureConnection(netOpts.port, { host: netOpts.host, key });
		socket.on('error', () => process.exit(1));

		const args = await new Promise<WorkerArgs>((resolve, reject) => {
			socket.once('error', reject);
			socket.once('close', () => reject(new Error('Secure worker IPC closed before receiving arguments')));
			readSecureMessages(socket, resolve);
		});

		await execute(args, msg => writeSecureMessage(socket, msg), () => socket.unref());

	} else if (process.send) {

		const args = await new Promise<WorkerArgs>(resolve => {
			process.once('message', resolve);
		});

		await execute(args, async msg => { process.send!(msg); });

	} else {

		await execute(JSON.parse(process.argv[3]), async msg => console.log(msg));

	}
})();

async function execute(args: WorkerArgs, sendMessage: (message: any) => Promise<void>, onFinished?: () => void): Promise<void> {

	let logEnabled = args.logEnabled;
	let sendErrorInfo = (args.action === 'loadTests');
	const sourceMapSupportEnabled = args.mochaOpts.requires.includes('source-map-support/register');
	const multiFileSuites = args.multiFileSuites || false;
	const useBaseDir = sourceMapSupportEnabled || multiFileSuites;

	try {

		process.chdir(args.cwd);

		for (const envVar in args.env) {
			const val = args.env[envVar];
			if (val === null) {
				delete process.env[envVar];
			} else {
				process.env[envVar] = val;
			}
		}

		const mochaPath = args.mochaPath ? args.mochaPath : path.dirname(require.resolve('mocha'));
		if (args.logEnabled) sendMessage(`Using the mocha package at ${mochaPath}`);
		const mochaModule = require(mochaPath);
		const Mocha: typeof import('mocha') = mochaModule.default || mochaModule;
		if (mochaModule.default) {
			// Keep legacy CJS plugins working when Node returns Mocha 12's ESM
			// namespace. This compatibility mapping is confined to this worker.
			const cached = require.cache[require.resolve(mochaPath)];
			if (cached) cached.exports = Mocha;
		}

		let requireOrImport: ((file: string) => Promise<any>) | undefined;
		if (args.esmLoader) {
			for (const relativePath of ['lib/nodejs/esm-utils.cjs', 'lib/nodejs/esm-utils.js', 'lib/esm-utils.js']) {
				const esmUtilsPath = path.join(mochaPath, relativePath);
				if (await fileExists(esmUtilsPath)) {
					requireOrImport = require(esmUtilsPath).requireOrImport;
					break;
				}
			}
		}

		const locationSymbol = Symbol('location');
		if ((args.action === 'loadTests') && args.monkeyPatch) {
			if (args.logEnabled) sendMessage('Patching Mocha');
			patchMocha(
				Mocha,
				args.mochaOpts.ui,
				locationSymbol,
				useBaseDir ? args.cwd : undefined,
				args.logEnabled ? sendMessage : undefined
			);
		}

		const cwd = process.cwd();
		let cwdRequire: NodeRequire;
		if (Module.createRequire as any) {
			cwdRequire = Module.createRequire(path.join(cwd, "index.js"));
		} else {
			cwdRequire = require;
			module.paths.push(cwd, path.join(cwd, 'node_modules'));
			let dir = mochaPath;
			while (true) {
				module.paths.push(path.join(dir, 'node_modules'));
				const next = path.dirname(dir);
				if (next === dir) break;
				dir = next;
			}
		}

		let requires = []
		for (let req of args.mochaOpts.requires) {

			if (fs.existsSync(req) || fs.existsSync(`${req}.js`)) {
				req = cwdRequire.resolve(path.resolve(req));
			}

			if (requireOrImport) {
				if (args.logEnabled) sendMessage(`Trying requireOrImport('${req}')`);
				requires.push(await requireOrImport(req));
			} else {
				if (args.logEnabled) sendMessage(`Trying require('${req}')`);
				requires.push(cwdRequire(req));
			}
		}

		const mocha = new Mocha({ require: args.mochaOpts.requires });

		mocha.ui(args.mochaOpts.ui);
		mocha.timeout(args.mochaOpts.timeout);
		mocha.suite.retries(args.mochaOpts.retries);

		for (const req of requires) {
			if (req.mochaHooks) {
				mocha.rootHooks(req.mochaHooks);
			}
			if (req.mochaGlobalSetup) {
				mocha.globalSetup(req.mochaGlobalSetup);
			}
			if (req.mochaGlobalTeardown) {
				mocha.globalTeardown(req.mochaGlobalTeardown);
			}
		}

		if (args.mochaOpts.delay) mocha.delay();
		if (args.mochaOpts.fullTrace) mocha.fullTrace();
		if (args.mochaOpts.asyncOnly) mocha.asyncOnly();
		if (!args.debuggerPort && mocha.parallelMode) {
			mocha.parallelMode(args.mochaOpts.parallel);
			if (args.mochaOpts.jobs !== undefined) {
				mocha.options.jobs = args.mochaOpts.jobs;
			}
		}

		if (logEnabled) sendMessage('Loading files');
		for (const file of args.testFiles) {
			mocha.addFile(file);
		}

		if (args.esmLoader && (mocha as any).loadFilesAsync) {
			sendMessage('Trying to use Mocha\'s experimental ESM module loader');
			await mocha.loadFilesAsync();
		}

		if (args.action === 'loadTests') {

			mocha.grep('$^');
			mocha.run(async () => {
				await processTests(mocha.suite, locationSymbol, sendMessage, args.logEnabled);
				if (onFinished) onFinished();
			});

		} else {

			const utilsPath = await fileExists(`${mochaPath}/lib/utils.cjs`) ? `${mochaPath}/lib/utils.cjs` : `${mochaPath}/lib/utils`;
			const stringify: (obj: any) => string = require(utilsPath).stringify;
			const regExp = new RegExp('^(' + args.tests!.map(RegExEscape).join('|') + ')$');
			mocha.grep(regExp);
			mocha.reporter(<any>ReporterFactory(sendMessage, stringify, sourceMapSupportEnabled, useBaseDir ? args.cwd : undefined));

			if (args.logEnabled) sendMessage('Running tests');
			await new Promise<void>(resolve => {
				mocha.run(() => {
					sendMessage({ type: 'finished' });
					if (onFinished) onFinished();
					resolve();
				});
			});

		}

	} catch (err) {
		if (logEnabled) sendMessage(`Caught error ${util.inspect(err)}`);
		if (sendErrorInfo) sendMessage(<ErrorInfo>{ type: 'error', errorMessage: util.inspect(err) });
		throw err;
	}
}
