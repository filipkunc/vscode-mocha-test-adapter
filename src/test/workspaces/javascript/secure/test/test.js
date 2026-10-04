const assert = require('assert');
assert.strictEqual(process.env.MOCHA_WORKER_IPC_KEY, undefined);
it('does not expose the launch key to tests', function() {
    assert.strictEqual(process.env.MOCHA_WORKER_IPC_KEY, undefined);
});
