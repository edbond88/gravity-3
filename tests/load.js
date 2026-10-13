'use strict';

// Loads the app's plain browser scripts into one shared context, the way
// <script> tags share globals on the page, and returns the requested names.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(files, names, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  for (const file of files) {
    const filename = path.join(__dirname, '..', 'js', file);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  return vm.runInContext(`({ ${names.join(', ')} })`, context);
}

module.exports = { load };
