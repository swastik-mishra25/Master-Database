const fs = require("node:fs");

const TECHBEHEMOTHS_DIRECTORY_URL = "https://techbehemoths.com/companies/digital-marketing/india";
const TECHBEHEMOTHS_PROFILE_PREFIX = "https://techbehemoths.com/company/";

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

  if (quoted) throw new Error("The CSV ends inside a quoted field.");
  if (value || record.length) {
    record.push(value.replace(/\r$/, ""));
    records.push(record);
  }

  const [headers, ...rows] = records;
  if (!headers?.length || new Set(headers).size !== headers.length) {
    throw new Error("The CSV must have a non-empty header row with unique column names.");
  }

  return rows.map((fields, index) => {
    if (fields.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has ${fields.length} values; expected ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, fieldIndex) => [header, fields[fieldIndex]]));
  });
}

function normalizedName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function loadTechBehemothsCandidates(filename) {
  const csv = fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, "");
  const rows = parseCsv(csv);
  const requiredColumns = [
    "Company Name",
    "India-listed office location",
    "Dakini AI fit score (0-100)",
    "Dakini fit level",
    "Listed digital-marketing services",
    "Company website (Clutch linked)",
    "Public phone number(s)",
    "Business start year",
    "Company-level directory profile",
    "Directory/source URL"
  ];
  const missingColumns = requiredColumns.filter(column => !Object.hasOwn(rows[0] || {}, column));
  if (missingColumns.length) {
    throw new Error(`The enriched prospect CSV is missing required columns: ${missingColumns.join(", ")}.`);
  }

  const candidates = rows.filter(row => row["Directory/source URL"] === TECHBEHEMOTHS_DIRECTORY_URL);
  if (!candidates.length) throw new Error("No TechBehemoths directory candidates were found in the enriched CSV.");

  const seenNames = new Set();
  const seenProfiles = new Set();
  return candidates.map((row, index) => {
    const rowNumber = index + 2;
    const companyName = row["Company Name"].trim();
    const location = row["India-listed office location"].trim();
    const profileUrl = row["Company-level directory profile"].trim();
    const profile = new URL(profileUrl);
    const nameKey = normalizedName(companyName);

    if (!companyName || !nameKey) throw new Error(`TechBehemoths CSV row ${rowNumber} has no valid company name.`);
    if (profile.protocol !== "https:" || profile.hostname !== "techbehemoths.com" ||
        !/^\/company\/[a-z0-9-]+\/?$/i.test(profile.pathname)) {
      throw new Error(`TechBehemoths CSV row ${rowNumber} has an invalid company profile URL.`);
    }
    if (!/\bIndia\b/i.test(location)) {
      throw new Error(`TechBehemoths CSV row ${rowNumber} has no India-listed location.`);
    }
    if (row["Dakini AI fit score (0-100)"] !== "23" ||
        row["Dakini fit level"] !== "Low fit" ||
        row["Company website (Clutch linked)"] !== "" ||
        row["Public phone number(s)"] !== "" ||
        row["Business start year"] !== "") {
      throw new Error(`TechBehemoths CSV row ${rowNumber} contains unsupported score or contact details.`);
    }
    if (seenNames.has(nameKey) || seenProfiles.has(profile.href.replace(/\/$/, "").toLowerCase())) {
      throw new Error(`TechBehemoths CSV row ${rowNumber} duplicates a company name or profile URL.`);
    }

    seenNames.add(nameKey);
    seenProfiles.add(profile.href.replace(/\/$/, "").toLowerCase());
    const services = row["Listed digital-marketing services"]
      .split(";")
      .map(service => service.trim())
      .filter(Boolean);
    if (!services.length) throw new Error(`TechBehemoths CSV row ${rowNumber} has no listed services.`);

    return {
      companyName,
      location,
      profileUrl: profile.href,
      services
    };
  });
}

module.exports = {
  TECHBEHEMOTHS_DIRECTORY_URL,
  loadTechBehemothsCandidates
};
