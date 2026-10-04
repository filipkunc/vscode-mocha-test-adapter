# Mocha Test Explorer for Visual Studio Code

Run your Mocha tests using the 
[Test Explorer UI](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer).

![Screenshot](img/screenshot.png)

## Features

* Shows a Test Explorer in the Test view in VS Code's sidebar with all detected tests and suites and their state
* Adds CodeLenses to your test files for starting and debugging tests
* Adds Gutter decorations to your test files showing the tests' state
* Adds line decorations to the source line where a test failed
* Shows a failed test's log when the test is selected in the explorer
* Lets you choose test suites or individual tests in the explorer that should be run automatically after each file change

## Getting started

* Install the extension and restart VS Code
* Put your Mocha command line options (if you have any) in a [mocha configuration file](https://mochajs.org/#configuring-mocha-nodejs)
  (either a `.mocharc.*` file or a `mocha` property in your `package.json` or a [`mocha.opts`](https://mochajs.org/#mochaopts) file)
  or VS Code's settings (see below)
* Ensure that your project's root folder is a VS Code root folder.  If you are using a "monorepo" architecture (ie. a single repository with multiple projects in separate sub-folders), you may need to add your project sub-folders to VS Code separately.  See [this article on multi-root workspaces](https://code.visualstudio.com/docs/editor/multi-root-workspaces) for further details on how to add folders.
* Open the Test view by clicking on the flask icon in the [Activity Bar](https://code.visualstudio.com/docs/getstarted/userinterface#_activity-bar)
* Run / Debug your tests using the ![Run](img/run.png) / ![Debug](img/debug.png) icons in the Test Explorer or the CodeLenses in your test file

## Security

Mocha Test Explorer requires VS Code 1.102 or later and a trusted workspace. The bundled Mocha 12 requires Node 20.19 or later in the 20.x line, or Node 22.12 or later; this applies to `mochaExplorer.nodePath` and remote workers too. Test discovery executes workspace code, including JavaScript configuration files, required modules and test files. Loading, running and debugging tests are blocked in untrusted workspaces, in addition to the extension's Workspace Trust declaration.

Diagnostic messages about configured environment variables include names only. Test output and errors can still contain secrets printed by workspace code; review logs before sharing them.

TCP worker communication is optional; the default uses Node's child-process IPC. TCP connections now require TLS 1.2 with a fresh 256-bit pre-shared key for every worker launch, authenticating both endpoints and encrypting messages with `ECDHE-PSK-CHACHA20-POLY1305`. Missing/wrong keys, plaintext peers and unsupported ciphers fail closed. The protocol never falls back to plaintext. Connection attempts have a deadline, and JSON messages are limited to 16 MiB and parsed without uncaught exceptions. TCP hosts set to `null`, an empty string or omitted fall back to `127.0.0.1` on both sides; explicit remote hosts remain supported.

The key is delivered to the launcher through `MOCHA_WORKER_IPC_KEY`, never in command-line arguments or diagnostic messages, and removed from the bundled worker's environment before loading workspace code. Protect it when transferring it to a remote worker. Processes capable of reading another process's environment or memory remain inside the local trust boundary. These controls do not sandbox trusted workspace code.

## Using transpilers (Typescript, Babel, etc.)

If you use a transpiler in your project, there are 2 ways to make the tests work in Mocha Test Explorer.
The first one is easier to configure, the second one offers better performance (especially in large projects):
* running the original (non-transpiled) sources directly by transpiling them on-the-fly using `ts-node` for Typescript, `babel-register` for Babel, etc.
  Example for Typescript:
  ```json
  "mochaExplorer.files": "test/**/*.ts",
  "mochaExplorer.require": "ts-node/register"
  ```

* enabling source-maps in your transpiler's configuration and running the transpiled test sources using the
  [`source-map-support`](https://www.npmjs.com/package/source-map-support) package.
  Furthermore, you should tell Mocha Test Explorer which files to watch for changes. For example:
  ```json
  "mochaExplorer.files": "out/test/**/*.js",
  "mochaExplorer.require": "source-map-support/register",
  "mochaExplorer.watch": "out/**/*.js"
  ```
  `mochaExplorer.watch` can be a string, an array of strings or an object with the properties `files` and optionally `ignore` and `debounce`.
  Make sure that it references the source files of your tests and of the application under test.
  Watching files consumes system resources, so it shouldn't reference more files than necessary.
  For this reason, `ignore` is set to `**/node_modules/**` by default.

## Running VS Code extension tests using vscode-test

Mocha Test Explorer supports running VS Code extension tests using [`vscode-test`](https://github.com/Microsoft/vscode-test):
Install the `mocha-explorer-launcher-scripts` package and add the following settings to your project:
The published 0.4.0 launcher must be migrated to forward `MOCHA_WORKER_IPC_KEY` in `extensionTestsEnv` and use a VS Code version meeting the runtime requirement above. It invokes the bundled worker, which handles the secure connection. A launcher that does not forward the key will fail closed.
```json
"mochaExplorer.launcherScript": "node_modules/mocha-explorer-launcher-scripts/vscode-test",
"mochaExplorer.autoload": false,
"mochaExplorer.ipcRole": "server",
"mochaExplorer.env": {
  "VSCODE_VERSION": "insiders",
  "ELECTRON_RUN_AS_NODE": null
}
```
Depending on the structure of your project's tests you may have to add more settings
(e.g. `mochaExplorer.files`, `mochaExplorer.ui` or `mochaExplorer.require`).
The environment variable `VSCODE_VERSION` is passed to the `runTests()` function from the `vscode-test` package,
it specifies the version of VS Code to be used for testing. Note that this needs to be different from the version
you're using for development, so if you're using VS Code Insiders, then you must set this variable to `"stable"`.

A sample project for running `vscode-test` tests using Mocha Test Explorer is available
[here](https://github.com/hbenl/vscode-extension-samples/tree/test-explorer-integration/helloworld-test-sample).

## Running tests remotely

If you want/need to run your tests in a remote environment (e.g. in a docker container or on another machine via ssh),
you can do so by writing a "launcher script": this script will be called by Mocha Test Explorer (instead of its standard worker script)
to load and run the tests in the remote environment.
Documentation for writing launcher scripts can be found in the
[vscode-test-adapter-remoting-util](https://github.com/hbenl/vscode-test-adapter-remoting-util)
package, which also contains utility functions for writing your launcher script.
There are also example projects containing well-documented launcher scripts for running your tests
[in a docker container](https://github.com/hbenl/vscode-mocha-docker-example) or
[on another machine via ssh](https://github.com/hbenl/vscode-mocha-ssh-example).

Those legacy examples and the published Docker/SSH launcher scripts use plaintext TCP and require migration. Use the secure transport provided by this extension instead of the remoting utility's `createConnection`, `receiveConnection`, `readMessages` and `writeMessage` functions:

```js
const transport = require(process.env.MOCHA_WORKER_IPC_MODULE);
const key = process.env.MOCHA_WORKER_IPC_KEY;
const socket = await transport.createSecureConnection(port, { host, key, timeout: 5000 });
transport.readSecureMessages(socket, handleWorkerMessage);
await transport.writeSecureMessage(socket, workerArgs);
```

Use `receiveSecureConnection` when the launcher listens for the worker. Forward the key into the remote worker's environment over a protected channel and run the updated bundled worker. For Docker, `--env MOCHA_WORKER_IPC_KEY` forwards the inherited value without putting it in argv. Preserve any required path conversion. [examples/secure-launcher.js](examples/secure-launcher.js) provides a tested local proxy showing the protocol; copy it into your workspace and set `mochaExplorer.launcherScript` to its path for a local example. The environment variables are provided for every launcher, including those using child-process IPC to communicate with the extension.

Alternatively, you can use [VS Code Remote Development](https://code.visualstudio.com/docs/remote/remote-overview)
to move your workspace to the remote environment. If you do so, your tests will also be run in this environment automatically.
This is easier to set up (because you don't need to write a launcher script), but requires that your entire workspace and large
parts of VS Code run in the remote environment, which (depending on the environment) may be impractical or even impossible.

## Configuration

### Mocha command line options

You can put any command line options into a [mocha configuration file](https://mochajs.org/#configuring-mocha-nodejs)
or the legacy [`mocha.opts` file](https://mochajs.org/#mochaopts).
Mocha 12 uses stricter YAML parsing: an otherwise empty YAML config must contain `{}`.
For `mocha.opts`, this adapter will use the path `test/mocha.opts` by default but you can override that with the `mochaExplorer.optsFile` setting.

Alternatively, you can put supported options into VS Code's settings:

Property                  | Corresponding command line option
--------------------------|----------------------------------
`mochaExplorer.ui`        | `-u`, `--ui` (default: `"bdd"`)
`mochaExplorer.timeout`   | `-t`, `--timeout` (default: `2000`)
`mochaExplorer.retries`   | `--retries` (default: `0`)
`mochaExplorer.require`   | `-r`, `--require` (default: `[]`)
`mochaExplorer.delay`     | `--delay` (default: `false`)
`mochaExplorer.fullTrace` | `--full-trace` (default: `false`)
`mochaExplorer.exit`      | `--exit` (default: `false`)
`mochaExplorer.asyncOnly` | `-A`, `--async-only` (default: `false`)
`mochaExplorer.parallel`  | `-p`, `--parallel` (default: `false`)
`mochaExplorer.jobs`      | `-j`, `--jobs` (default: (number of CPU cores - 1))
`mochaExplorer.configFile`| `--config` or `--no-config` if you set it to `null`
`mochaExplorer.pkgFile`   | `--package` or `--no-package` if you set it to `null`
`mochaExplorer.optsFile`  | `--opts` (default: `"test/mocha.opts"`)

Options from VS Code's settings will override those found in a mocha configuration file.

### Custom debugger configuration

If you want to customize the configuration used for debugging your tests (e.g. to set `sourceMapPathOverrides`
or `skipFiles`), you can do so by creating a debugging configuration in your `launch.json` and setting
`mochaExplorer.debuggerConfig` to the name of your debugging configuration.
Here's the default debugging configuration used by this adapter:
```json
{
  "name": "Debug Mocha Tests",
  "type": "pwa-node",
  "request": "attach",
  "port": 9229,
  "continueOnAttach": true,
  "autoAttachChildProcesses": false,
  "resolveSourceMapLocations": [
    "!**/node_modules/**",
    "!**/.vscode/extensions/hbenl.vscode-mocha-test-adapter-*/**"
  ],
  "skipFiles": [
    "<node_internals>/**"
  ]
}
```

### Other options

Property                           | Description
-----------------------------------|---------------------------------------------------------------
`mochaExplorer.files`              | The glob(s) describing the location of your test files (relative to the workspace folder) (default: `"test/**/*.js"`). These globs will be _added to_ the globs found in a mocha configuration file
`mochaExplorer.ignore`             | Glob(s) of files to be ignored (relative to the workspace folder). These globs will be _added to_ the globs found in a mocha configuration file
`mochaExplorer.watch`              | Configure a file watcher. See the section on using transpilers for more details.
`mochaExplorer.env`                | Environment variables to be set when running the tests (e.g. `{ "NODE_ENV": "production" }`). These environment variables will be _added to_ the environment of the process running mocha. To _remove_ an environment variable, set its value to `null`
`mochaExplorer.envPath`            | Path to a dotenv file (relative to the workspace folder) containing environment variables to be set when running the tests. If you set both `mochaExplorer.env` and `mochaExplorer.envPath`, the environment variables will be merged (with those from `mochaExplorer.env` overriding those from `mochaExplorer.envPath`)
`mochaExplorer.cwd`                | The working directory where mocha is run (relative to the workspace folder)
`mochaExplorer.nodePath`           | The path to the node executable to use. By default it will attempt to find it on your PATH, if it can't find it or if this option is set to `null`, it will use the one shipped with VS Code
`mochaExplorer.nodeArgv`           | The arguments to the node executable to use
`mochaExplorer.mochaPath`          | The path to the mocha package to use (absolute or relative to the workspace folder). By default it looks for a directory `node_modules/mocha` in your workspace and uses that if it exists, otherwise or if this option is set to `null`, it uses a bundled version of mocha
`mochaExplorer.monkeyPatch`        | Apply a monkey patch to Mocha's `bdd`, `tdd` and `qunit` interfaces to get more accurate line numbers for the tests and suites (default: `true`)
`mochaExplorer.multiFileSuites`    | Ignore Mocha's idea of which file a test is located in. This is necessary for the worker to find the correct test and error locations when a suite includes tests from other files.
`mochaExplorer.debuggerPort`       | The port to use for debugging sessions (default: `9229`)
`mochaExplorer.pruneFiles`         | Only load the test files needed for the current test run (default: `false` - load all configured files)
`mochaExplorer.esmLoader`          | Use Mocha's experimental ESM module loader if it is available (default: `true`)
`mochaExplorer.globImplementation` | The glob implementation to use. `\"glob\"` (the default) is more compatible, `\"vscode\"` (the old default) may be faster.
`mochaExplorer.launcherScript`     | The path to a launcher script (relative to the workspace folder) for [running your tests remotely](https://github.com/hbenl/vscode-test-adapter-remoting-util)
`mochaExplorer.ipcRole`            | Use a TCP connection instead of Node's IPC mechanism for talking to worker processes. This is only needed with some launcher scripts.
`mochaExplorer.ipcPort`            | The TCP port that worker processes use to send their results to VS Code if `mochaExplorer.ipcRole` is set (default: `9449`)
`mochaExplorer.ipcHost`            | The TCP host used for communication with worker processes. If `mochaExplorer.ipcRole` is set to `client`, this is the address that Mocha Explorer tries to connect to; if set to `server`, this is the listening address. Null, empty or omitted values use `127.0.0.1`. To listen on all IPv4 addresses, explicitly set `0.0.0.0` and protect the connection (see Security above). (default: `localhost`)
`mochaExplorer.ipcTimeout`         | The timeout in milliseconds for establishing a TCP connection to a worker process if `mochaExplorer.ipcRole` is set (default: `5000`)
`mochaExplorer.autoload`           | Automatically (re)load the tests when source files or relevant settings are changed and/or when VS Code is started (`true`, `false`, or `"onStart"`; default: `true`)
`testExplorer.codeLens`            | Show a CodeLens above each test or suite for running or debugging the tests
`testExplorer.gutterDecoration`    | Show the state of each test in the editor using Gutter Decorations
`testExplorer.onStart`             | Retire or reset all test states whenever a test run is started
`testExplorer.onReload`            | Retire or reset all test states whenever the test tree is reloaded

## Commands

The following commands are available in VS Code's command palette, use the ID to add them to your keyboard shortcuts:

ID                                 | Command
-----------------------------------|--------------------------------------------
`mocha-explorer.enable`            | Enable Mocha Test Explorer for a workspace folder
`mocha-explorer.disable`           | Disable Mocha Test Explorer for a workspace folder
`test-explorer.reload`             | Reload tests
`test-explorer.run-all`            | Run all tests
`test-explorer.run-file`           | Run tests in current file
`test-explorer.run-test-at-cursor` | Run the test at the current cursor position
`test-explorer.cancel`             | Cancel running tests

## Troubleshooting
If the Test view doesn't show your tests or anything else doesn't work as expected, you can turn on diagnostic logging using one of the following configuration options
(note: in multi-root workspaces, these options are always taken from the first workspace folder):
* `mochaExplorer.logpanel`: Write diagnostic logs to an output panel
* `mochaExplorer.logfile`: Write diagnostic logs to the given file

Note that the logs usually contain a lot of stacktraces, but if a stacktrace starts with "[INFO] Worker: Looking for \<some path\> in Error",
then that stacktrace doesn't mean that something went wrong: such stacktraces are used to find the location of a test in a file.

There is a [bug in Node 10.6.0 - 10.9.0](https://github.com/nodejs/node/issues/21671) that breaks this adapter.
If you're using a version of Node affected by this bug, add `"mochaExplorer.nodePath": null` to your configuration as a workaround.

If you think you've found a bug, please [file a bug report](https://github.com/hbenl/vscode-mocha-test-adapter/issues) and attach the diagnostic logs.
