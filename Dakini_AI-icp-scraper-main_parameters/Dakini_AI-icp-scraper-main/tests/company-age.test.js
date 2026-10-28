const assert = require("node:assert/strict");
const { test } = require("node:test");
const { findCompanyStartYear, getCompanyAgeYears } = require("../public/company-age");

test("extracts a stated business start year with its first-party page citation", () => {
  const result = findCompanyStartYear([{
    url: "https://example.com/about",
    sourceType: "company website",
    text: "About us | Example Agency was founded in 2008 and operates in India."
  }], 2026);

  assert.deepEqual(result, {
    startYear: 2008,
    quote: "About us | Example Agency was founded in 2008 and operates in India.",
    sourceUrl: "https://example.com/about"
  });
});

test("extracts an operating-start year when phrased as began operating", () => {
  const result = findCompanyStartYear([{
    url: "https://example.com/history",
    sourceType: "company website",
    text: "The company began operating in Mumbai, India in 1969."
  }], 2026);

  assert.equal(result.startYear, 1969);
});

test("does not use search-result or directory-only claims as founding evidence", () => {
  const result = findCompanyStartYear([
    {
      url: "https://search.example/",
      sourceType: "web search",
      text: "Example Agency founded in 2008"
    },
    {
      url: "https://directory.example/example",
      sourceType: "public directory listing",
      text: "Example Agency established in 2008"
    }
  ], 2026);

  assert.equal(result, null);
});

test("calculates age as a calendar-year estimate and rejects invalid or future years", () => {
  assert.equal(getCompanyAgeYears(1969, new Date("2026-01-01T00:00:00Z")), 57);
  assert.equal(getCompanyAgeYears(null, new Date("2026-01-01T00:00:00Z")), null);
  assert.equal(getCompanyAgeYears(2027, new Date("2026-01-01T00:00:00Z")), null);
  assert.equal(getCompanyAgeYears(1799, new Date("2026-01-01T00:00:00Z")), null);
});
