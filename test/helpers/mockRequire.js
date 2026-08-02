// Lightweight require()-cache-based mocking for plain CommonJS, without
// Node's --experimental-test-module-mocks flag (still unstable/awkward with
// CJS as of Node 22). Node's module loader checks require.cache[resolvedPath]
// before reading/compiling anything, so seeding that cache with a fake module
// object is enough to intercept any require() of that path.
const Module = require("module");

// Swaps a module's cached exports for a fake. Returns a restore() function.
function mockModule(modulePath, fakeExports) {
  const resolvedPath = require.resolve(modulePath);
  const previous = require.cache[resolvedPath];
  const fakeModule = new Module(resolvedPath);
  fakeModule.exports = fakeExports;
  fakeModule.loaded = true;
  require.cache[resolvedPath] = fakeModule;
  return function restore() {
    if (previous) require.cache[resolvedPath] = previous;
    else delete require.cache[resolvedPath];
  };
}

// Forces modulePath to be re-executed from scratch on the next require(),
// so it re-runs its own top-level require() calls against whatever is
// currently in the cache (i.e. picks up mocks set up after it was first
// loaded by an earlier test).
function freshRequire(modulePath) {
  const resolvedPath = require.resolve(modulePath);
  delete require.cache[resolvedPath];
  return require(resolvedPath);
}

module.exports = { mockModule, freshRequire };
