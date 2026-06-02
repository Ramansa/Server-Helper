function createMutex() {
  let current = Promise.resolve();
  return async function withLock(fn) {
    const run = current.then(fn, fn);
    current = run.catch(() => {});
    return run;
  };
}

module.exports = { createMutex };
