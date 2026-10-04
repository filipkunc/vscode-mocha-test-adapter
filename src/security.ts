/** An omitted TCP host must never turn a worker listener into a wildcard listener. */
export function ipcHostOrLoopback(host: string | null | undefined): string {
	return host || '127.0.0.1';
}
