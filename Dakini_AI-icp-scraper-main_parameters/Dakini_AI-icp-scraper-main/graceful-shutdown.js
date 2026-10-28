function createGracefulShutdown({
  stopSchedulers,
  closeEventStreams,
  closeServer,
  drainTasks,
  persistState,
  closeStateStore,
  log
}) {
  let shutdownPromise = null;

  return function shutdown(signal) {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = Promise.resolve().then(async () => {
      stopSchedulers();
      closeEventStreams();
      log(`Received ${signal}; stopping new requests and draining background work.`);
      await closeServer();
      await drainTasks();
      persistState();
      closeStateStore();
      log("Shutdown complete; state persisted and database closed.");
    });
    return shutdownPromise;
  };
}

module.exports = { createGracefulShutdown };
