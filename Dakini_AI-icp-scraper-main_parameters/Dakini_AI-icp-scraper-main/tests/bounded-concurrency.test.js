const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runWithConcurrency } = require("../bounded-concurrency");

test("runs every item while respecting the requested concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = [];
  await runWithConcurrency(Array.from({ length: 12 }, (_, index) => index), 3, async (item, index) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, item % 3));
    results.push([item, index]);
    active -= 1;
  });

  assert.equal(maximumActive, 3);
  assert.deepEqual(results.map(([item]) => item).sort((a, b) => a - b),
    Array.from({ length: 12 }, (_, index) => index));
  assert.deepEqual(results.map(([item, index]) => item === index), Array(12).fill(true));
});

test("handles empty work and propagates worker failures", async () => {
  let called = false;
  await runWithConcurrency([], 3, async () => { called = true; });
  assert.equal(called, false);
  await assert.rejects(
    runWithConcurrency([1, 2], 2, async item => {
      if (item === 2) throw new Error("worker failed");
    }),
    /worker failed/
  );
});
