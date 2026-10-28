(function (root) {
  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function joinValues(values, separator = ", ") {
    return Array.isArray(values) ? values.join(separator) : "";
  }

  function normalizePublicPhones(values) {
    const normalize = root.normalizePhoneNumbers ||
      (typeof require === "function" ? require("./phone-numbers").normalizePhoneNumbers : null);
    return normalize ? normalize(values) : [];
  }

  function companyAgeYears(company) {
    const calculate = root.getCompanyAgeYears ||
      (typeof require === "function" ? require("./company-age").getCompanyAgeYears : null);
    return calculate ? calculate(company.companyStartYear) : "";
  }

  function sourceReferenceType(company) {
    const sourceUrl = company.directoryUrl || company.sourceUrl;
    try {
      const url = new URL(sourceUrl);
      if (/(^|\.)bing\.com$/i.test(url.hostname) && url.pathname.toLowerCase() === "/search") {
        return "Search-results page (discovery only; not a direct company listing)";
      }
    } catch {
      return company.directoryUrl ? "Directory/discovery source" : "Company website";
    }
    return company.directoryUrl ? "Directory/discovery source" : "Company website";
  }

  function evidenceBasis(company) {
    const pages = Array.isArray(company.pagesScanned) ? company.pagesScanned : [];
    const evidenceCount = Array.isArray(company.evidence)
      ? company.evidence.filter(item => item.quote && item.field !== "roleEmail" && item.field !== "phone").length
      : 0;
    if (pages.length && pages.every(page => page.sourceType === "public directory listing")) {
      return "Directory listing only; company operations not independently checked";
    }
    return evidenceCount
      ? `${evidenceCount} quoted signal(s); source statements not independently verified`
      : "Limited cited evidence; source review recommended";
  }

  function sourceExcerpts(company) {
    return joinValues((company.evidence || [])
      .filter(item => item.quote && item.field !== "roleEmail" && item.field !== "phone")
      .map(item => `${item.field}: ${item.quote}${item.source_url ? ` (${item.source_url})` : ""}`), " | ");
  }

  function websiteWorkflowAudit(company) {
    const audit = company.websiteWorkflowAudit;
    if (!audit?.workflows) return "";
    return Object.entries(audit.workflows)
      .map(([workflow, status]) => `${workflow}: ${status}`)
      .concat(`scanned pages: ${audit.scannedPages ?? 0}`)
      .join(" | ");
  }

  function createProspectCsv(companies) {
    const columns = [
      ["Company", company => company.companyName],
      ["Industry", company => company.industry],
      ["Business start year (first-party evidence)", company => company.companyStartYear ?? ""],
      ["Company age (calendar-year estimate)", company => companyAgeYears(company)],
      ["Start-year source", company => company.evidence?.find(item => item.field === "companyStartYear")?.source_url || ""],
      ["India office (city-level)", company => company.location],
      ["Heuristic fit score (not purchase probability)", company => company.score?.score],
      ["Fit level", company => company.score?.tier],
      ["Legitimacy evidence status", company => company.legitimacy?.status ||
        (company.pagesScanned?.some(page => page.sourceType === "public directory listing") ? "directory_only" : "not_assessed")],
      ["Legitimacy evidence score (not legal verification)", company => company.legitimacy?.score ?? ""],
      ["Legitimacy review notes", company => joinValues(company.legitimacy?.reasons)],
      ["Detected workflow signal", company => joinValues(company.score?.matchedUseCases) || joinValues(company.detectedUseCases)],
      ["Public website workflow check (not proof of a gap)", websiteWorkflowAudit],
      ["Public emails", company => joinValues(company.contactEmails)],
      ["Public phone number(s)", company => joinValues(normalizePublicPhones(company.contactPhones))],
      ["Company website", company => company.sourceUrl],
      ["Discovery/source reference", company => company.directoryUrl || company.sourceUrl],
      ["Source reference type", sourceReferenceType],
      ["Evidence basis", evidenceBasis],
      ["Data checked", company => company.capturedAt || ""],
      ["Pages scanned", company => company.pagesScanned?.length ?? 0],
      ["Source excerpts", sourceExcerpts],
      ["Data quality note", company => company.qualificationNote || ""],
      ["Extracted company activities (not verified)", company => joinValues(company.companyActivities, " ")],
      ["Potential Dakini fit (suggested, not confirmed)", company => joinValues(company.dakiniRecommendations, " ")],
      ["Qualification note", company => company.score?.exclusionReason || ""]
    ];
    return [
      columns.map(([header]) => csvCell(header)).join(","),
      ...companies.map(company => columns
        .map(([, value]) => csvCell(value(company)))
        .join(","))
    ].join("\r\n");
  }

  root.createProspectCsv = createProspectCsv;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createProspectCsv };
  }
})(globalThis);
