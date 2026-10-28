const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createStateStore } = require("../state-store");
const { encryptOAuthTokens } = require("../encrypted-oauth-tokens");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dakini-server-test-"));
const databaseFile = path.join(temporaryDirectory, "server.sqlite");
const googleTokenEncryptionKey = crypto.randomBytes(32).toString("hex");
const restoredGoogleSessionId = "restored-google-session";
const restoredSpreadsheetUrl = "https://docs.google.com/spreadsheets/d/restored-sheet";
let child;
let baseUrl;

before(async () => {
  const seedStore = createStateStore(databaseFile);
  seedStore.saveSnapshot({
    icps: [],
    sources: [],
    jobs: [],
    companies: [{
      id: "previously-scraped.example",
      companyName: "Previous Prospect",
      score: { score: 82, tier: "Priority" },
      legitimacy: { status: "strong_evidence", canAutoQualify: true }
    }],
    scrapedDomains: [{ id: "previously-scraped.example" }],
    sourceCandidates: [],
    googleConnections: [{
      id: restoredGoogleSessionId,
      encryptedTokens: encryptOAuthTokens({ refresh_token: "test-refresh-token" }, googleTokenEncryptionKey),
      spreadsheetId: "restored-sheet",
      spreadsheetUrl: restoredSpreadsheetUrl
    }],
    discoveryState: {}
  });
  seedStore.close();

  const serverPath = path.join(__dirname, "..", "server.js");
  child = spawn(process.execPath, ["-e", `
    const app = require(${JSON.stringify(serverPath)});
    const server = app.listen(0, "127.0.0.1", () => {
      console.log("READY:" + server.address().port);
    });
  `], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      APP_USERNAME: "test-operator",
      APP_PASSWORD: "test-password-long-enough",
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      GOOGLE_TOKEN_ENCRYPTION_KEY: googleTokenEncryptionKey,
      DAKINI_STATE_FILE: "",
      DAKINI_DATABASE_FILE: databaseFile
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  baseUrl = await new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 15000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      const match = output.match(/READY:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stderr.on("data", chunk => {
      errors += chunk.toString();
    });
    child.once("exit", code => {
      if (!baseUrl) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}: ${output}${errors}`));
      }
    });
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("exposes a database health check and security headers", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("provides state and city options for the location picker", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const response = await fetch(`${baseUrl}/api/config`, {
    headers: { authorization: `Basic ${credentials}` }
  });
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.ok(config.targetStates.includes("India"));
  assert.ok(config.targetStates.includes("Maharashtra"));
  assert.ok(config.targetStates.includes("Puducherry"));
  assert.ok(config.targetAreas.includes("Bengaluru"));
  assert.ok(config.targetAreas.includes("Mumbai"));
  const invalidGeographicRequest = await fetch(`${baseUrl}/api/geographic-discovery/run-now`, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ city: " ", category: "all" })
  });
  assert.equal(invalidGeographicRequest.status, 400);
});

test("protects the application API with HTTP Basic authentication", async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/icps`);
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get("www-authenticate"), /^Basic /);
  assert.equal((await fetch(`${baseUrl}/`)).status, 401);

  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const authenticated = await fetch(`${baseUrl}/api/icps`, {
    headers: { authorization: `Basic ${credentials}` }
  });
  assert.equal(authenticated.status, 200);
  assert.deepEqual(await authenticated.json(), []);
  const authenticatedHome = await fetch(`${baseUrl}/`, {
    headers: { authorization: `Basic ${credentials}` },
    redirect: "manual"
  });
  assert.equal(authenticatedHome.status, 302);
  assert.equal(authenticatedHome.headers.get("location"), "/platform.html");
  const removedMarketingHomepage = await fetch(`${baseUrl}/index.html`, {
    headers: { authorization: `Basic ${credentials}` }
  });
  assert.equal(removedMarketingHomepage.status, 404);
  const authenticatedUi = await fetch(`${baseUrl}/platform.html`, {
    headers: { authorization: `Basic ${credentials}` }
  });
  assert.equal(authenticatedUi.status, 200);
  const uiHtml = await authenticatedUi.text();
  assert.match(uiHtml, /Find your next voice-agent customer/);
  assert.match(uiHtml, /option value="all" selected/);
  assert.match(uiHtml, /option value="Priority">High-potential \(90\+/);
  assert.match(uiHtml, /Retrieve approved sources/);
  assert.match(uiHtml, /approvedDirectoryList/);
  assert.match(uiHtml, /includeCuratedSources/);
  assert.match(uiHtml, /downloadCsvBtn/);
  assert.match(uiHtml, /researchLowerFitBtn/);
  assert.match(uiHtml, /geographicDiscoveryForm/);
  assert.match(uiHtml, /researchStaleBtn/);
});

test("restores the encrypted Google Sheets connection from SQLite after startup", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const response = await fetch(`${baseUrl}/api/google/status`, {
    headers: {
      authorization: `Basic ${credentials}`,
      cookie: `dakini_google_session=${restoredGoogleSessionId}`
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    configured: true,
    connected: true,
    spreadsheetUrl: restoredSpreadsheetUrl
  });
});

test("clears downloaded prospects while preserving their scraped-domain history", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const options = { headers: { authorization: `Basic ${credentials}` } };
  const response = await fetch(`${baseUrl}/api/companies/clear-exported`, {
    method: "POST",
    headers: { ...options.headers, "content-type": "application/json" },
    body: JSON.stringify({ companyIds: ["previously-scraped.example"] })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { removed: 1, remaining: 0 });
  assert.deepEqual(await (await fetch(`${baseUrl}/api/companies`, options)).json(), []);

  const verificationStore = createStateStore(databaseFile);
  const snapshot = verificationStore.loadSnapshot();
  verificationStore.close();
  assert.deepEqual(snapshot.companies, []);
  assert.ok(snapshot.scrapedDomains.some(domain => domain.id === "previously-scraped.example"));
});

test("reports source-search capacity and retrieval state", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const options = { headers: { authorization: `Basic ${credentials}` } };
  const statusResponse = await fetch(`${baseUrl}/api/discovery/status`, options);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.sourceDiscoverySearchesPerRun, 50);
  assert.equal(status.dailySearchQueries, 100);
  assert.equal(status.approvedDirectorySources.length, 0);
  assert.equal(status.crawlConcurrency, 8);
  assert.equal(status.searchConcurrency, 1);

  const sourcesResponse = await fetch(`${baseUrl}/api/public-sources`, options);
  assert.equal(sourcesResponse.status, 200);
  const sources = await sourcesResponse.json();
  assert.deepEqual(sources, []);
  assert.ok(sources.every(source => source.added === false));
});

test("reports the daily qualified-prospect target and local-day progress", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const response = await fetch(`${baseUrl}/api/discovery/status`, {
    headers: { authorization: `Basic ${credentials}` }
  });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.dailyQualifiedProspectsTarget, 300);
  assert.equal(status.dailyQualifiedProspects, 0);
  assert.match(status.localDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("provides authenticated operational diagnostics without exposing stored prospect data", async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/operations/diagnostics`);
  assert.equal(unauthenticated.status, 401);

  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const response = await fetch(`${baseUrl}/api/operations/diagnostics`, {
    headers: { authorization: `Basic ${credentials}` }
  });

  assert.equal(response.status, 200);
  const diagnostics = await response.json();
  assert.equal(diagnostics.status, "ok");
  assert.equal(diagnostics.database, "ok");
  assert.equal(typeof diagnostics.uptimeSeconds, "number");
  assert.equal(diagnostics.jobs.total, 0);
  assert.deepEqual(diagnostics.jobs.recent, []);
  assert.equal("companies" in diagnostics, false);
});

test("rejects lower-fit research requests with prospect IDs missing from the portfolio", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const response = await fetch(`${baseUrl}/api/companies/research-lower-fit`, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ companyIds: ["missing-prospect"] })
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).missingCount, 1);
});

test("removes an approved source without deleting the source record", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const options = { headers: { authorization: `Basic ${credentials}` } };

  const created = await fetch(`${baseUrl}/api/sources`, {
    method: "POST",
    headers: { ...options.headers, "content-type": "application/json" },
    body: JSON.stringify({
      name: "India Digital Marketing Directory",
      url: "https://example.com/india-digital-marketing-agencies",
      approved: true
    })
  });
  assert.equal(created.status, 201);
  const createdSource = await created.json();

  const statusBefore = await fetch(`${baseUrl}/api/discovery/status`, options);
  assert.equal(statusBefore.status, 200);
  const approvedBefore = (await statusBefore.json()).approvedDirectorySources.length;

  const removed = await fetch(`${baseUrl}/api/sources/${createdSource.id}`, {
    method: "DELETE",
    headers: options.headers
  });
  assert.equal(removed.status, 200);
  const removedSource = await removed.json();
  assert.equal(removedSource.approved, false);
  assert.equal(removedSource.removed, true);

  const statusAfter = await fetch(`${baseUrl}/api/discovery/status`, options);
  assert.equal(statusAfter.status, 200);
  const approvedAfter = (await statusAfter.json()).approvedDirectorySources.length;
  assert.equal(approvedAfter, approvedBefore);

  const fetchSources = await fetch(`${baseUrl}/api/sources`, options);
  assert.equal(fetchSources.status, 200);
  const sourceList = await fetchSources.json();
  assert.ok(sourceList.some(source => source.id === createdSource.id && source.approved === false));
});

test("rejects authenticated cross-origin mutations before route execution", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const response = await fetch(`${baseUrl}/api/discovery/run-now`, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      origin: "https://attacker.example",
      "content-type": "application/json"
    },
    body: "{}"
  });
  assert.equal(response.status, 403);
});

test("rejects oversized JSON requests with a clear client error", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const response = await fetch(`${baseUrl}/api/icps`, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ payload: "x".repeat(1024 * 1024) })
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Request body exceeds the 1 MB limit." });
});

test("saves state and area targeting as ICP locations", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const response = await fetch(`${baseUrl}/api/icps`, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      name: "Pune Region",
      industries: ["Digital Marketing Agency"],
      locations: ["Maharashtra", "Pune", "Andheri East"],
      areas: ["Pune", "Andheri East"],
      useCases: ["Lead Generation"]
    })
  });

  assert.equal(response.status, 201);
  const profile = await response.json();
  assert.ok(profile.id);
  assert.equal(profile.name, "Pune Region");
  assert.deepEqual(profile.locations, ["Maharashtra", "Pune", "Andheri East"]);
  assert.equal(profile.anyLocation, false);
  assert.deepEqual(profile.areas, ["Pune", "Andheri East"]);
});

test("saves location-independent ICP targets", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const response = await fetch(`${baseUrl}/api/icps`, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      name: "Global Clinics",
      industries: ["Clinics"],
      locations: [],
      anyLocation: true,
      areas: [],
      useCases: ["Appointment Scheduling"]
    })
  });

  assert.equal(response.status, 201);
  const profile = await response.json();
  assert.deepEqual(profile.locations, []);
  assert.equal(profile.anyLocation, true);
});

test("imports India digital-marketing directory records with validation and domain deduplication", async () => {
  const credentials = Buffer.from("test-operator:test-password-long-enough").toString("base64");
  const headers = {
    authorization: `Basic ${credentials}`,
    "content-type": "application/json"
  };
  const record = {
    companyName: "Sample Digital Agency",
    sourceUrl: "https://sample-digital-agency.example",
    profileUrl: "https://clutch.co/profile/sample-digital-agency",
    location: "Pune, India",
    services: ["Search Engine Optimization", "Social Media Marketing"],
    phones: ["'+91 98765 43210", "+91-9876543210"],
    workflowEvidence: ["lead qualification"],
    score: 45,
    tier: "Review",
    components: {
      serviceFit: 35,
      operatingScale: 0,
      indiaMarketFit: 8,
      integrationReadiness: 0,
      buyingSignals: 0,
      reachability: 2
    },
    scoreBasis: "Directory-listed services and location; buying intent is not verified."
  };

  const imported = await fetch(`${baseUrl}/api/companies/import-directory`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      companies: [
        record,
        { ...record, companyName: "Duplicate Directory Entry" },
        {
          ...record,
          companyName: "sample-digital-agency",
          sourceUrl: "https://another-sample-domain.example",
          profileUrl: "https://clutch.co/profile/another-sample-domain"
        }
      ]
    })
  });
  assert.equal(imported.status, 200);
  assert.deepEqual(await imported.json(), { imported: 1, skipped: 2, total: 1 });

  const companiesResponse = await fetch(`${baseUrl}/api/companies`, { headers });
  const companies = await companiesResponse.json();
  assert.equal(companies.length, 1);
  const importedCompany = companies.find(company => company.id === "sample-digital-agency.example");
  assert.ok(importedCompany);
  assert.equal(importedCompany.location, "Pune, India");
  assert.deepEqual(importedCompany.contactPhones, ["+919876543210"]);
  assert.deepEqual(importedCompany.score.matchedUseCases, ["lead qualification"]);
  assert.match(importedCompany.qualificationNote, /Buying intent/);
  assert.equal(importedCompany.legitimacy.status, "directory_only");
  assert.equal(importedCompany.legitimacy.canAutoQualify, false);

  const invalid = await fetch(`${baseUrl}/api/companies/import-directory`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      companies: [{ ...record, profileUrl: "https://example.com/profile/sample-digital-agency" }]
    })
  });
  assert.equal(invalid.status, 400);

  const placeholderPhone = await fetch(`${baseUrl}/api/companies/import-directory`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      companies: [{
        ...record,
        companyName: "Placeholder Phone Agency",
        sourceUrl: "https://placeholder-phone.example",
        profileUrl: "https://clutch.co/profile/placeholder-phone",
        phones: ["+65 11111111"]
      }]
    })
  });
  assert.equal(placeholderPhone.status, 400);

  const verificationStore = createStateStore(databaseFile);
  const snapshot = verificationStore.loadSnapshot();
  verificationStore.close();
  assert.equal(snapshot.companies.length, 1);
  assert.ok(snapshot.companies.some(company => company.companyName === "Sample Digital Agency"));
  assert.ok(!snapshot.scrapedDomains.some(domain => domain.id === "sample-digital-agency.example"));
  assert.ok(snapshot.scrapedDomains.some(domain => domain.id === "previously-scraped.example"));
});
