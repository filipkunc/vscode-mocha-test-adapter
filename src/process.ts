import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';

const stopping = new WeakMap<ChildProcess, Promise<void>>();

/** Windows SIGTERM is an unconditional kill; it cannot run launcher cleanup handlers. */
export function terminateWorker(child: ChildProcess): Promise<void> {
	const existing = stopping.get(child);
	if (existing) return existing;
	const result = (async () => {
		if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
		if (process.platform !== 'win32') { child.kill(); return; }
		const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
		await new Promise<void>((resolve, reject) => {
			const killer = spawn(executable, ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
			killer.once('error', reject);
			killer.once('close', code => {
				if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
				else reject(new Error('Windows worker process-tree termination failed'));
			});
		});
	})();
	stopping.set(child, result);
	return result;
}
