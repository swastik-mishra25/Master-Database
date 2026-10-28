const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  createLowerFitResearchTargets,
  createStaleCompanyResearchTargets
} = require("../lower-fit-research");

test("selects low-fit website records and deduplicates domains", () => {
  const result = createLowerFitResearchTargets([
    {
      id: "one",
      companyName: "One",
      sourceUrl: "https://www.example.com",
      score: { tier: "Low fit" }
    },
    {
      id: "two",
      companyName: "Duplicate",
      sourceUrl: "http://example.com/about",
      score: { tier: "Low fit" }
    },
    {
      id: "three",
      companyName: "Review",
      sourceUrl: "https://review.example",
      score: { tier: "Review" }
    }
  ]);

  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].id, "one");
  assert.equal(result.skippedDuplicateDomain, 1);
  assert.equal(result.skippedInvalidUrl, 0);
});

test("includes explicit snapshot IDs even if their scores have since changed", () => {
  const result = createLowerFitResearchTargets([
    {
      id: "previously-low",
      companyName: "Previously Low",
      sourceUrl: "https://example.com",
      score: { tier: "Review" }
    },
    {
      id: "not-requested",
      companyName: "Other",
      sourceUrl: "https://other.example",
      score: { tier: "Low fit" }
    }
  ], ["previously-low"]);

  assert.deepEqual(result.targets.map(target => target.id), ["previously-low"]);
});

test("counts invalid and non-web URLs rather than silently treating them as targets", () => {
  const result = createLowerFitResearchTargets([
    { id: "empty", score: { tier: "Low fit" } },
    { id: "file", sourceUrl: "file:///tmp/company", score: { tier: "Low fit" } },
    { id: "valid", sourceUrl: "https://company.example", score: { tier: "Low fit" } }
  ]);

  assert.equal(result.targets.length, 1);
  assert.equal(result.skippedInvalidUrl, 2);
});

test("selects stale records across fit tiers and excludes recently refreshed records", () => {
  const now = new Date("2026-10-26T00:00:00Z");
  const result = createStaleCompanyResearchTargets([
    {
      id: "old",
      companyName: "Old",
      sourceUrl: "https://old.example",
      capturedAt: "2026-06-01T00:00:00Z",
      score: { tier: "Priority" }
    },
    {
      id: "current",
      companyName: "Current",
      sourceUrl: "https://current.example",
      capturedAt: "2026-01-01T00:00:00Z",
      lastResearchedAt: "2026-10-01T00:00:00Z",
      score: { tier: "Low fit" }
    },
    {
      id: "unverified-date",
      companyName: "Undated",
      sourceUrl: "https://undated.example",
      score: { tier: "Review" }
    }
  ], { now, staleAfterDays: 90 });

  assert.deepEqual(result.targets.map(target => target.id), ["old", "unverified-date"]);
  assert.equal(result.staleAfterDays, 90);
});

test("validates stale-lead freshness settings", () => {
  assert.throws(
    () => createStaleCompanyResearchTargets([], { staleAfterDays: 0 }),
    /staleAfterDays must be an integer/
  );
});
