const assert = require("node:assert/strict");
const { test } = require("node:test");
const { pauseEngineState } = require("../engine-state");

test("pausing during a cycle keeps the running state until that cycle finishes", () => {
  const engine = {
    enabled: true,
    status: "running",
    currentActivity: "Cycle in progress"
  };

  assert.equal(pauseEngineState(engine), engine);
  assert.equal(engine.enabled, false);
  assert.equal(engine.status, "running");
  assert.equal(engine.currentActivity, "Finishing current cycle · paused");
});

test("pausing an idle engine updates it to the paused state", () => {
  const engine = {
    enabled: true,
    status: "idle",
    currentActivity: "Scheduled for tomorrow"
  };

  pauseEngineState(engine);

  assert.equal(engine.enabled, false);
  assert.equal(engine.status, "paused");
  assert.equal(engine.currentActivity, "Engine paused by operator");
});
