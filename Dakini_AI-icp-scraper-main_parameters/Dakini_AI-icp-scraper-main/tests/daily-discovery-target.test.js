const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  DAILY_QUALIFIED_PROSPECT_TARGET,
  countDailyQualifiedProspects,
  dateKeyInTimeZone
} = require("../daily-discovery-target");

test("sets the daily qualified prospect target to 300", () => {
  assert.equal(DAILY_QUALIFIED_PROSPECT_TARGET, 300);
});

test("counts only today's newly captured, auto-qualifiable Priority prospects", () => {
  const companies = new Map([
    ["priority", {
      capturedAt: "2026-10-23T04:00:00.000Z",
      legitimacy: { canAutoQualify: true },
      score: { tier: "Priority", score: 95 }
    }],
    ["review", {
      capturedAt: "2026-10-23T12:00:00.000Z",
      legitimacy: { canAutoQualify: true },
      score: { tier: "Review", score: 70 }
    }],
    ["below-threshold", {
      capturedAt: "2026-10-23T13:00:00.000Z",
      legitimacy: { canAutoQualify: true },
      score: { tier: "Priority", score: 89 }
    }],
    ["needs-review", {
      capturedAt: "2026-10-23T12:00:00.000Z",
      legitimacy: { canAutoQualify: false },
      score: { tier: "Priority", score: 100 }
    }],
    ["low-fit", {
      capturedAt: "2026-10-23T12:00:00.000Z",
      legitimacy: { canAutoQualify: true },
      score: { tier: "Low fit" }
    }],
    ["yesterday", {
      capturedAt: "2026-10-22T18:29:59.000Z",
      legitimacy: { canAutoQualify: true },
      score: { tier: "Priority", score: 89 }
    }]
  ]);

  assert.equal(countDailyQualifiedProspects(
    companies,
    new Date("2026-10-23T12:00:00.000Z"),
    "Asia/Kolkata"
  ), 1);
});

test("uses the configured local day boundary", () => {
  assert.equal(dateKeyInTimeZone("2026-10-22T18:30:00.000Z", "Asia/Kolkata"), "2026-10-23");
  assert.equal(dateKeyInTimeZone("2026-10-22T18:29:59.000Z", "Asia/Kolkata"), "2026-10-22");
});
