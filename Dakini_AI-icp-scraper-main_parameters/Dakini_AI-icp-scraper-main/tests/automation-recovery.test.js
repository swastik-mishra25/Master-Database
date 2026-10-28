const assert = require("node:assert/strict");
const { test } = require("node:test");
const { selectRecoverableAutomationJobs } = require("../automation-recovery");

test("selects interrupted source discovery and directory retrieval jobs in creation order", () => {
  const jobs = [
    { id: "manual-web", kind: "manual_web_discovery", status: "interrupted", startedAt: "2026-02-05" },
    { id: "daily-web", kind: "daily_web_discovery", status: "interrupted", startedAt: "2026-02-06" },
    { id: "retrieval-late", directoryRetrieval: true, status: "interrupted", startedAt: "2026-02-02" },
    { id: "source-scan", kind: "daily_source_discovery", status: "interrupted", startedAt: "2026-02-01" },
    { id: "running-retrieval", directoryRetrieval: true, status: "running" },
    { id: "manual-directory", kind: "manual_public_directory_retrieval", status: "interrupted", startedAt: "2026-02-03" },
    { id: "engine-web", kind: "engine_web_discovery", status: "interrupted", startedAt: "2026-02-07" },
    { id: "lower-fit", kind: "lower_fit_research", status: "interrupted", startedAt: "2026-02-08" },
    { id: "stale-leads", kind: "stale_lead_research", status: "interrupted", startedAt: "2026-02-09" }
  ];

  assert.deepEqual(
    selectRecoverableAutomationJobs(jobs).map(job => job.id),
    ["source-scan", "retrieval-late", "manual-directory", "manual-web", "daily-web", "engine-web", "lower-fit", "stale-leads"]
  );
});

test("does not classify completed or ordinary company crawl jobs as recoverable automation", () => {
  const jobs = [
    { kind: "daily_source_discovery", status: "completed" },
    { kind: "manual_crawl", status: "interrupted" },
    { kind: "daily_public_directory_retrieval", status: "completed" }
  ];
  assert.deepEqual(selectRecoverableAutomationJobs(jobs), []);
});
