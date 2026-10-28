function selectRecoverableAutomationJobs(jobs) {
  return [...jobs]
    .filter(job =>
      job.status === "interrupted" &&
      (job.directoryRetrieval ||
        job.kind === "daily_public_directory_retrieval" ||
        job.kind === "manual_public_directory_retrieval" ||
        job.kind === "daily_source_discovery" ||
        job.kind === "manual_source_discovery" ||
        job.kind === "daily_web_discovery" ||
        job.kind === "manual_web_discovery" ||
        job.kind === "engine_web_discovery" ||
        job.kind === "lower_fit_research" ||
        job.kind === "stale_lead_research")
    )
    .sort((a, b) => (a.startedAt || "").localeCompare(b.startedAt || ""));
}

module.exports = { selectRecoverableAutomationJobs };
