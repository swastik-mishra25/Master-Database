const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { normalizePhoneNumber } = require("../public/phone-numbers");

function parseCsv(text) {
  const records = [];
  let record = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value === "") {
      quoted = true;
    } else if (character === ",") {
      record.push(value);
      value = "";
    } else if (character === "\n") {
      record.push(value.replace(/\r$/, ""));
      if (record.some(field => field !== "")) records.push(record);
      record = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (value || record.length) {
    record.push(value.replace(/\r$/, ""));
    records.push(record);
  }
  const [headers, ...rows] = records;
  return rows.map(fields => Object.fromEntries(headers.map((header, index) => [header, fields[index] || ""])));
}

function readCsv(filename) {
  return parseCsv(fs.readFileSync(path.join(__dirname, "..", filename), "utf8").replace(/^\uFEFF/, ""));
}

function normalizedCompanyName(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

test("curated agency CSVs contain unique company records with company-level source URLs", () => {
  const baseRows = readCsv("indian-digital-marketing-agencies.csv");
  const enrichedRows = readCsv("indian-digital-marketing-agencies-enriched.csv");
  const names = rows => rows.map(row => normalizedCompanyName(row["Company Name"]));

  assert.equal(baseRows.length, 811);
  assert.equal(enrichedRows.length, 811);
  assert.equal(new Set(names(baseRows)).size, baseRows.length);
  assert.equal(new Set(names(enrichedRows)).size, enrichedRows.length);
  assert.deepEqual([...names(baseRows)].sort(), [...names(enrichedRows)].sort());
  assert.ok(baseRows.every(row => !/bing\.com\/search/i.test(row["Directory/source URL"])));
  assert.ok(enrichedRows.every(row => !/bing\.com\/search/i.test(row["Phone source"])));
  const wikipediaCandidate = enrichedRows.find(row => row["Company Name"] === "MullenLowe Lintas Group");
  assert.ok(wikipediaCandidate);
  assert.match(wikipediaCandidate["Address source"], /^https:\/\/en\.wikipedia\.org\/wiki\//);
  assert.equal(wikipediaCandidate["Public phone number(s)"], "");
  assert.equal(wikipediaCandidate["Phone source"], "");
  assert.equal(wikipediaCandidate["Business start year"], "1969");
  assert.equal(wikipediaCandidate["Company age (calendar-year estimate; as of 2026)"], "57");
  assert.match(wikipediaCandidate["Start-year source"], /^https:\/\/en\.wikipedia\.org\/wiki\//);
  const baseWikipediaCandidate = baseRows.find(row => row["Company Name"] === "MullenLowe Lintas Group");
  assert.equal(baseWikipediaCandidate["Business start year"], "1969");

  const techBehemothsCandidates = enrichedRows.filter(row =>
    row["Directory/source URL"] === "https://techbehemoths.com/companies/digital-marketing/india"
  );
  assert.equal(techBehemothsCandidates.length, 359);
  assert.ok(techBehemothsCandidates.every(row =>
    row["Company-level directory profile"].startsWith("https://techbehemoths.com/company/") &&
    row["India-listed office location"].includes("India") &&
    row["Dakini fit level"] === "Low fit" &&
    row["Dakini AI fit score (0-100)"] === "23" &&
    row["Public phone number(s)"] === "" &&
    row["Company website (Clutch linked)"] === "" &&
    row["Business start year"] === "" &&
    row["Phone source"] === ""
  ));
});

test("enriched phone fields contain normalized, sourced numbers or remain blank", () => {
  const rows = readCsv("indian-digital-marketing-agencies-enriched.csv");
  const phoneHeader = "Public phone number(s)";
  assert.ok(rows.length > 0);

  for (const row of rows) {
    const numbers = row[phoneHeader].split("; ").filter(Boolean);
    assert.equal(new Set(numbers).size, numbers.length, row["Company Name"]);
    for (const number of numbers) {
      assert.equal(normalizePhoneNumber(number), number, row["Company Name"]);
    }
    assert.equal(Boolean(row["Phone source"]), numbers.length > 0, row["Company Name"]);
  }
});
