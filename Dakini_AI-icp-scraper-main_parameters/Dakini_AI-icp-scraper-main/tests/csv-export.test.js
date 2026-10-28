const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createProspectCsv } = require("../public/csv-export");

test("exports industry-specific prospect details as spreadsheet-compatible CSV", () => {
  const estimatedAge = new Date().getFullYear() - 2008;
  const csv = createProspectCsv([{
    companyName: 'Retail, "North"',
    industry: "Retail and ecommerce",
    location: "Mumbai, India",
    companyStartYear: 2008,
    score: { score: 82, tier: "Priority", matchedUseCases: ["Customer support"] },
    legitimacy: {
      status: "strong_evidence",
      score: 85,
      reasons: ["Company name matches its website."]
    },
    contactEmails: ["hello@example.com"],
    contactPhones: ["+91 1234567890"],
    sourceUrl: "https://example.com",
    directoryUrl: "https://directory.example.com",
    capturedAt: "2026-10-05T12:00:00.000Z",
    pagesScanned: [{ url: "https://example.com", sourceType: "company website" }],
    evidence: [{
      field: "industry",
      quote: "The company provides marketing services.",
      source_url: "https://example.com/services"
    }, {
      field: "companyStartYear",
      value: 2008,
      quote: "Retail North was founded in 2008.",
      source_url: "https://example.com/about"
    }],
    companyActivities: ["Online retail"],
    dakiniRecommendations: ["Order support"]
  }]);

  assert.match(csv, /^"Company","Industry","Business start year \(first-party evidence\)","Company age \(calendar-year estimate\)","Start-year source"/);
  assert.ok(csv.includes(`"Retail and ecommerce","2008","${estimatedAge}","https://example.com/about","Mumbai, India","82","Priority"`));
  assert.match(csv, /"Mumbai, India"/);
  assert.match(csv, /"Retail, ""North"""/);
  assert.ok(csv.includes(`"2008","${estimatedAge}","https://example.com/about"`));
  assert.match(csv, /"https:\/\/directory\.example\.com"/);
  assert.match(csv, /"2 quoted signal\(s\); source statements not independently verified"/);
  assert.match(csv, /"2026-10-05T12:00:00\.000Z","1"/);
  assert.match(csv, /industry: The company provides marketing services\. \(https:\/\/example\.com\/services\)/);
  assert.match(csv, /"Potential Dakini fit \(suggested, not confirmed\)"/);
  assert.match(csv, /"strong_evidence","85","Company name matches its website\."/);
});

test("labels directory-only records without implying company verification", () => {
  const csv = createProspectCsv([{
    companyName: "Directory prospect",
    score: { score: 10, tier: "Low fit" },
    pagesScanned: [{ sourceType: "public directory listing" }],
    evidence: [{ quote: "Listed in directory.", source_url: "https://directory.example.com" }]
  }]);

  assert.match(csv, /"Directory listing only; company operations not independently checked"/);
});

test("labels Bing search URLs as discovery references rather than company listings", () => {
  const csv = createProspectCsv([{
    companyName: "Search result prospect",
    score: { score: 10, tier: "Low fit" },
    sourceUrl: "https://company.example",
    directoryUrl: "https://www.bing.com/search?q=company+directory"
  }]);

  assert.match(csv, /"https:\/\/www\.bing\.com\/search\?q=company\+directory"/);
  assert.match(csv, /"Search-results page \(discovery only; not a direct company listing\)"/);
});

test("exports website workflow observations without presenting them as proof of a gap", () => {
  const csv = createProspectCsv([{
    companyName: "Clinic prospect",
    score: { score: 58, tier: "Research" },
    websiteWorkflowAudit: {
      scannedPages: 3,
      workflows: {
        enquiryForm: "found",
        bookingWorkflow: "not_detected",
        faqs: "found",
        customerSupport: "not_detected"
      }
    }
  }]);

  assert.match(csv, /"Public website workflow check \(not proof of a gap\)"/);
  assert.match(csv, /enquiryForm: found \| bookingWorkflow: not_detected/);
  assert.match(csv, /scanned pages: 3/);
});

test("neutralizes spreadsheet formulas in untrusted company text", () => {
  const csv = createProspectCsv([{
    companyName: "=HYPERLINK(\"https://attacker.example\")",
    industry: "Healthcare",
    score: { score: 10, tier: "Low fit" }
  }]);

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/attacker\.example""\)"/);
});
