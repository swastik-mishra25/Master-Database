const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createGracefulShutdown } = require("../graceful-shutdown");

test("stops ingress, drains work, persists, and closes state in order", async () => {
  const steps = [];
  const shutdown = createGracefulShutdown({
    stopSchedulers: () => steps.push("stop-schedulers"),
    closeEventStreams: () => steps.push("close-event-streams"),
    closeServer: async () => steps.push("close-server"),
    drainTasks: async () => steps.push("drain-tasks"),
    persistState: () => steps.push("persist-state"),
    closeStateStore: () => steps.push("close-state-store"),
    log: message => steps.push(message)
  });

  const first = shutdown("SIGTERM");
  const second = shutdown("SIGINT");
  assert.equal(first, second);
  await first;

  assert.deepEqual(steps, [
    "stop-schedulers",
    "close-event-streams",
    "Received SIGTERM; stopping new requests and draining background work.",
    "close-server",
    "drain-tasks",
    "persist-state",
    "close-state-store",
    "Shutdown complete; state persisted and database closed."
  ]);
});

test("does not close the state store when server draining fails", async () => {
  const closed = [];
  const shutdown = createGracefulShutdown({
    stopSchedulers: () => {},
    closeEventStreams: () => {},
    closeServer: async () => {
      throw new Error("listener close failed");
    },
    drainTasks: async () => {},
    persistState: () => closed.push("persisted"),
    closeStateStore: () => closed.push("closed"),
    log: () => {}
  });

  await assert.rejects(shutdown("SIGTERM"), /listener close failed/);
  assert.deepEqual(closed, []);
});
