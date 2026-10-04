export function assertWorkerRuntime(version = process.versions.node): void {
	const [major, minor] = version.split('.').map(Number);
	if ((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22) return;
	throw new Error('Mocha Test Explorer requires Node.js 20.19+ or 22.12+; update mochaExplorer.nodePath or use the Node runtime bundled with VS Code 1.102+');
}
