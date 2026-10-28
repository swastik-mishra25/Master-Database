function createLowerFitResearchTargets(companies, requestedIds) {
  const requested = requestedIds ? new Set(requestedIds) : null;
  const domains = new Set();
  const targets = [];
  let skippedInvalidUrl = 0;
  let skippedDuplicateDomain = 0;

  for (const company of companies) {
    if (requested ? !requested.has(company.id) : company.score?.tier !== "Low fit") {
      continue;
    }

    let url;
    try {
      url = new URL(company.sourceUrl);
    } catch {
      skippedInvalidUrl += 1;
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      skippedInvalidUrl += 1;
      continue;
    }

    const domain = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (domains.has(domain)) {
      skippedDuplicateDomain += 1;
      continue;
    }
    domains.add(domain);
    targets.push({
      id: company.id,
      companyName: company.companyName,
      sourceUrl: url.toString(),
      directoryUrl: company.directoryUrl || ""
    });
  }

  return { targets, skippedInvalidUrl, skippedDuplicateDomain };
}

function createStaleCompanyResearchTargets(companies, {
  now = new Date(),
  staleAfterDays = 90
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("now must be a valid Date.");
  }
  if (!Number.isInteger(staleAfterDays) || staleAfterDays < 1 || staleAfterDays > 3650) {
    throw new RangeError("staleAfterDays must be an integer between 1 and 3650.");
  }
  const records = [...companies];
  const staleBefore = now.getTime() - staleAfterDays * 24 * 60 * 60 * 1000;
  const staleIds = records
    .filter(company => {
      const lastCheckedAt = Date.parse(company.lastResearchedAt || company.capturedAt || "");
      return !Number.isFinite(lastCheckedAt) || lastCheckedAt <= staleBefore;
    })
    .map(company => company.id);
  return {
    ...createLowerFitResearchTargets(records, staleIds),
    staleAfterDays
  };
}

module.exports = { createLowerFitResearchTargets, createStaleCompanyResearchTargets };
