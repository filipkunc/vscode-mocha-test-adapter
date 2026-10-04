// Minimal local proxy demonstrating the secure transport for custom launchers.
// Remote launchers also translate paths and deliver the key over SSH or another
// protected channel. Never place the key in command-line arguments or logs.
const { fork } = require('child_process');
const net = require('net');
const { once } = require('events');
const transport = require(process.env.MOCHA_WORKER_IPC_MODULE);

process.once('message', async args => {
    let worker;
    try {
        const key = process.env.MOCHA_WORKER_IPC_KEY;
        const reservation = net.createServer();
        reservation.listen(0, '127.0.0.1');
        await once(reservation, 'listening');
        const port = reservation.address().port;
        await new Promise(resolve => reservation.close(resolve));
        // Inherit the key through the environment, not argv. The bundled worker
        // removes it before loading configuration, dependencies or test files.
        worker = fork(args.workerScript, [JSON.stringify({ role: 'server', port, host: '127.0.0.1' })], {
            env: process.env, stdio: ['ignore', 'inherit', 'inherit', 'ipc']
        });
        worker.on('error', () => process.exit(1));
        // On success let TLS data and queued IPC messages drain before the
        // event loop exits naturally. An immediate exit could drop the suite.
        worker.once('exit', code => { if (code) process.exit(code); });
        process.once('disconnect', () => worker.kill());
        process.once('SIGTERM', () => worker.kill());
        const socket = await transport.createSecureConnection(port, { key });
        socket.on('error', () => worker.kill());
        let pendingMessages = 0;
        let ended = false;
        const disconnectAfterFlush = () => {
            if (ended && pendingMessages === 0 && process.connected) process.disconnect();
        };
        socket.once('close', () => { ended = true; disconnectAfterFlush(); });
        transport.readSecureMessages(socket, message => {
            pendingMessages++;
            process.send(message, () => { pendingMessages--; disconnectAfterFlush(); });
        });
        await transport.writeSecureMessage(socket, args);
    } catch {
        if (worker) worker.kill();
        console.error('Secure launcher failed; verify the worker version, runtime and key forwarding');
        process.exit(1);
    }
});
