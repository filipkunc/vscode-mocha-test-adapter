import { assertWorkerRuntime } from '../runtime';
import * as yargs from 'yargs';

assertWorkerRuntime();
const { loadOptions } = require('mocha/lib/cli/options.cjs');
const args = loadOptions(process.argv.slice(2));
// Preserve legacy camelCase settings and inherited configuration supported by
// previous extension versions, after Mocha parses its own CLI configuration.
process.send!(yargs.config(args).parse(args._));
