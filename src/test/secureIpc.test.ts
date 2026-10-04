import assert from 'assert';
import * as net from 'net';
import { once } from 'events';
import { createIpcKey, createSecureConnection, receiveSecureConnection, readSecureMessages, writeSecureMessage, maxMessageBytes } from '../secureIpc';
import { assertWorkerRuntime } from '../runtime';

async function freePort(): Promise<number> {
	const server = net.createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const port = (server.address() as net.AddressInfo).port;
	await new Promise<void>(resolve => server.close(() => resolve()));
	return port;
}

async function pair() {
	const port = await freePort();
	const key = createIpcKey();
	const receiving = receiveSecureConnection(port, { key });
	const client = await createSecureConnection(port, { key });
	const server = await receiving;
	return { client, server };
}

describe('Authenticated worker transport', function() {
	it('encrypts messages and preserves fragmented UTF-8 and multiple frames', async function() {
		const { client, server } = await pair();
		try {
			assert.strictEqual(client.getProtocol(), 'TLSv1.2');
			assert.strictEqual(client.getCipher().name, 'ECDHE-PSK-CHACHA20-POLY1305');
			assert.strictEqual(client.authorized, true);
			const messages: any[] = [];
			const received = new Promise<void>(resolve => readSecureMessages(server, message => {
				messages.push(message);
				if (messages.length === 3) resolve();
			}));
			const frame = Buffer.from(JSON.stringify({ secret: '€🔒' }) + '\n');
			for (const byte of frame) client.write(Buffer.from([byte]));
			client.write('1\n2\n');
			await received;
			assert.deepStrictEqual(messages, [{ secret: '€🔒' }, 1, 2]);
		} finally { client.destroy(); server.destroy(); }
	});

	it('rejects a wrong or previous launch key without consuming the real worker connection', async function() {
		const port = await freePort();
		const key = createIpcKey();
		const receiving = receiveSecureConnection(port, { key });
		await assert.rejects(createSecureConnection(port, { key: createIpcKey() }));
		const client = await createSecureConnection(port, { key });
		const server = await receiving;
		client.destroy(); server.destroy();
	});

	it('rejects plaintext peers and subsequently accepts an authenticated worker', async function() {
		const port = await freePort();
		const key = createIpcKey();
		const receiving = receiveSecureConnection(port, { key });
		const attacker = net.createConnection(port, '127.0.0.1');
		attacker.on('error', () => {});
		attacker.resume();
		const closed = new Promise<void>(resolve => attacker.once('close', () => resolve()));
		attacker.write('{"action":"runTests"}\n');
		await closed;
		const client = await createSecureConnection(port, { key });
		const server = await receiving;
		client.destroy(); server.destroy();
	});

	it('fails closed when a launcher omits or corrupts the key', async function() {
		await assert.rejects(createSecureConnection(1234, { key: undefined }), /launch key/);
		assert.throws(() => receiveSecureConnection(1234, { key: 'bad' }), /launch key/);
	});

	it('times out and releases the port after unauthenticated clients stall', async function() {
		const port = await freePort();
		const receiving = receiveSecureConnection(port, { key: createIpcKey(), timeout: 150 });
		const rejected = assert.rejects(receiving, /timed out/);
		const attacker = net.createConnection(port, '127.0.0.1');
		attacker.on('error', () => {});
		await rejected;
		attacker.destroy();
		const next = net.createServer();
		next.listen(port, '127.0.0.1');
		await once(next, 'listening');
		await new Promise<void>(resolve => next.close(() => resolve()));
	});

	for (const frame of ['not-json\n', 'oversized']) {
		it(`contains ${frame.trim()} messages instead of throwing in the extension host`, async function() {
			const { client, server } = await pair();
			try {
				const failure = new Promise<Error>(resolve => server.once('error', resolve));
				readSecureMessages(server, () => assert.fail('Invalid message was accepted'));
				client.on('error', () => {});
				client.write(frame === 'oversized' ? Buffer.alloc(maxMessageBytes + 1, 65) : frame);
				assert.match((await failure).message, /Invalid or oversized/);
			} finally { client.destroy(); server.destroy(); }
		});
	}

	it('enforces the patched Mocha runtime requirement', function() {
		for (const version of ['18.20.0', '20.18.0', '21.0.0', '22.11.0']) assert.throws(() => assertWorkerRuntime(version));
		for (const version of ['20.19.0', '22.12.0', '24.0.0']) assert.doesNotThrow(() => assertWorkerRuntime(version));
	});
});
