import * as tls from 'tls';
import { Socket } from 'net';
import { randomBytes } from 'crypto';
import { ipcHostOrLoopback } from './security';

export const ipcKeyVariable = 'MOCHA_WORKER_IPC_KEY';
export const maxMessageBytes = 16 * 1024 * 1024;
const identity = 'mocha-worker-v1';
// Certificate-free TLS authenticates both endpoints with a fresh launch key.
// ECDHE provides forward secrecy; the only allowed cipher uses authenticated encryption.
const tlsOptions: tls.SecureContextOptions = {
	minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2',
	ciphers: 'ECDHE-PSK-CHACHA20-POLY1305'
};

export function createIpcKey(): string { return randomBytes(32).toString('hex'); }

function keyBytes(key: string | undefined): Buffer {
	if (!key || !/^[a-f0-9]{64}$/.test(key)) {
		throw new Error('Secure worker IPC requires a valid launch key; update the launcher to forward MOCHA_WORKER_IPC_KEY');
	}
	return Buffer.from(key, 'hex');
}

export interface SecureIpcOptions {
	host?: string;
	key: string | undefined;
	timeout?: number;
}

function connectionTimeout(timeout = 5000): number {
	if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('IPC timeout must be a positive finite number');
	return timeout;
}

export async function createSecureConnection(port: number, options: SecureIpcOptions): Promise<tls.TLSSocket> {
	const psk = keyBytes(options.key);
	const deadline = Date.now() + connectionTimeout(options.timeout);
	while (true) {
		try {
			return await new Promise<tls.TLSSocket>((resolve, reject) => {
				const socket = tls.connect({
					...tlsOptions, port, host: ipcHostOrLoopback(options.host),
					pskCallback: () => ({ identity, psk }),
					// The peer proves possession of the PSK instead of presenting a certificate.
					checkServerIdentity: () => undefined
				});
				const timer = setTimeout(() => socket.destroy(new Error('Secure IPC connection timed out')), Math.max(1, deadline - Date.now()));
				socket.once('error', error => { clearTimeout(timer); socket.destroy(); reject(error); });
				socket.once('secureConnect', () => {
					clearTimeout(timer);
					socket.disableRenegotiation();
					resolve(socket);
				});
			});
		} catch (error: any) {
			// Only retry startup races, never authentication/protocol failures.
			if (error.code !== 'ECONNREFUSED' || Date.now() >= deadline) throw error;
			await new Promise<void>(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
		}
	}
}

export function receiveSecureConnection(port: number, options: SecureIpcOptions): Promise<tls.TLSSocket> {
	const psk = keyBytes(options.key);
	const timeout = connectionTimeout(options.timeout);
	return new Promise((resolve, reject) => {
		const pending = new Set<Socket>();
		let finished = false;
		const server = tls.createServer({
			...tlsOptions, handshakeTimeout: Math.min(timeout, 5000),
			pskCallback: (_socket, peerIdentity) => peerIdentity === identity ? psk : null
		});
		server.maxConnections = 16;
		const cleanup = () => {
			clearTimeout(timer);
			server.close();
			for (const socket of pending) socket.destroy();
		};
		const fail = (error: Error) => {
			if (finished) return;
			finished = true;
			cleanup();
			reject(error);
		};
		const timer = setTimeout(() => fail(new Error('Secure IPC connection timed out')), timeout);
		server.on('connection', socket => {
			pending.add(socket);
			socket.once('close', () => pending.delete(socket));
		});
		server.on('tlsClientError', (_error, socket) => socket.destroy());
		server.on('error', fail);
		server.on('secureConnection', socket => {
			if (finished) { socket.destroy(); return; }
			finished = true;
			// Identify the accepted raw connection by its peer address/port.
			for (const raw of pending) {
				if (raw.remotePort !== socket.remotePort || raw.remoteAddress !== socket.remoteAddress) raw.destroy();
			}
			pending.clear();
			clearTimeout(timer);
			server.close();
			socket.disableRenegotiation();
			resolve(socket);
		});
		server.listen(port, ipcHostOrLoopback(options.host));
	});
}

/** Bounded newline-delimited JSON, with parsing/handler errors contained in the socket. */
export function readSecureMessages(socket: Socket, handler: (message: any) => void): () => void {
	let buffer = Buffer.allocUnsafe(1024);
	let size = 0;
	const append = (part: Buffer) => {
		const length = size + part.length;
		if (length > maxMessageBytes) throw new Error('IPC message exceeds size limit');
		if (length > buffer.length) {
			const expanded = Buffer.allocUnsafe(Math.min(maxMessageBytes, Math.max(length, buffer.length * 2)));
			buffer.copy(expanded, 0, 0, size);
			buffer = expanded;
		}
		part.copy(buffer, size);
		size = length;
	};
	const onData = (data: Buffer) => {
		try {
			let start = 0;
			for (let end = data.indexOf(10); end >= 0; end = data.indexOf(10, start)) {
				append(data.subarray(start, end));
				const line = buffer.toString('utf8', 0, size);
				size = 0; start = end + 1;
				if (buffer.length > 65536) buffer = Buffer.allocUnsafe(1024);
				if (line) handler(JSON.parse(line));
			}
			append(data.subarray(start));
		} catch {
			socket.destroy(new Error('Invalid or oversized worker IPC message'));
		}
	};
	socket.on('data', onData);
	return () => socket.removeListener('data', onData);
}

export function writeSecureMessage(socket: Socket, message: any): Promise<void> {
	const json = JSON.stringify(message);
	if (Buffer.byteLength(json) > maxMessageBytes) return Promise.reject(new Error('IPC message exceeds size limit'));
	return new Promise((resolve, reject) => socket.write(json + '\n', error => error ? reject(error) : resolve()));
}
