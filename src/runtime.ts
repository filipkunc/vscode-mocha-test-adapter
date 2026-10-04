export function assertWorkerRuntime(version = process.versions.node): void {
	const [major, minor] = version.split('.').map(Number);
	if ((major === 22 && minor >= 12) || major === 24 || major === 26) return;
	throw new Error('Mocha Test Explorer requires Node.js 22.12+, 24 LTS or 26; update mochaExplorer.nodePath or use the Node runtime bundled with VS Code 1.102+');
}
