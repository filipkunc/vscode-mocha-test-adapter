import * as net from "net";
import { createTestMochaAdapter } from "./adapter";

describe("Test files that keep the node process alive", function() {

	it("should not be left running after loading the tests", async function() {

		const adapter = await createTestMochaAdapter('javascript/exit-load');

		await adapter.load();
		await new Promise(resolve => setTimeout(resolve, 10));

		await throwIfWorkerProcessIsRunning();
	});

	it("should not be left running after running the tests", async function() {

		this.timeout(10000);

		const adapter = await createTestMochaAdapter('javascript/exit-run');

		await adapter.load();
		const rootSuite = adapter.getLoadedTests();
		await adapter.run([ rootSuite!.id ]);

		await throwIfWorkerProcessIsRunning();
	});
});

async function throwIfWorkerProcessIsRunning(): Promise<void> {
	const deadline = Date.now() + 2000;
	while (true) {
		const server = net.createServer();
		try {
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(12345, '127.0.0.1', resolve);
			});
			await new Promise<void>(resolve => server.close(() => resolve()));
			return;
		} catch (error: any) {
			if (error.code !== 'EADDRINUSE' || Date.now() >= deadline) throw error;
			await new Promise(resolve => setTimeout(resolve, 25));
		}
	}
}
