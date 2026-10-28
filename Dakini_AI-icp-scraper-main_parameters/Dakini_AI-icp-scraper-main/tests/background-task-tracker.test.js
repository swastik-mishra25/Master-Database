const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createBackgroundTaskTracker } = require("../background-task-tracker");

test("drains tracked work, including work added by an active task", async () => {
  const tracker = createBackgroundTaskTracker(() => {});
  let finishFirst;
  let finishSecond;
  const first = new Promise(resolve => {
    finishFirst = resolve;
  });
  const second = new Promise(resolve => {
    finishSecond = resolve;
  });

  tracker.track(first.then(() => tracker.track(second, "second task")), "first task");
  const draining = tracker.drain();
  assert.equal(tracker.size, 1);
  finishFirst();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tracker.size, 2);
  finishSecond();
  await draining;
  assert.equal(tracker.size, 0);
});

test("reports task failures and still completes draining", async () => {
  const errors = [];
  const tracker = createBackgroundTaskTracker((label, error) => {
    errors.push({ label, message: error.message });
  });

  tracker.track(Promise.reject(new Error("provider unavailable")), "discovery");
  await tracker.drain();

  assert.deepEqual(errors, [{
    label: "discovery",
    message: "provider unavailable"
  }]);
  assert.equal(tracker.size, 0);
});
