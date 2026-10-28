const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createStateStore } = require("../state-store");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dakini-recovery-test-"));
const databasePath = path.join(temporaryDirectory, "recovery.sqlite");
let child;
let baseUrl;

before(async () => {
  const store = createStateStore(databasePath);
  store.saveSnapshot({
    icps: [],
    sources: [],
    jobs: [{
      id: "interrupted-source-scan",
      kind: "manual_source_discovery",
      status: "running",
      searchQueries: [],
      searchesCompleted: 0,
      candidatesChecked: 0,
      candidatesDiscovered: 0,
      candidateIds: [],
      errors: [],
      startedAt: "2026-10-01T00:00:00.000Z"
    }, {
      id: "interrupted-web-discovery",
      kind: "manual_web_discovery",
      status: "running",
      searchQueries: [],
      searchesCompleted: 0,
      completedSearchQueryIndexes: [],
      discoveredCompanies: [],
      completedCompanyDomains: [],
      errors: [],
      startedAt: "2026-10-01T00:00:00.000Z"
    }],
    companies: [],
    sourceCandidates: [],
    discoveryState: {
      lastRunAt: null,
      activeSourceDiscoveryJobId: "interrupted-source-scan",
      activeJobId: null
    }
  });
  store.close();

  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const selectedPort = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(selectedPort));
    });
  });
  child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      HOST: "127.0.0.1",
      PORT: String(port),
      DAKINI_DATABASE_FILE: databasePath,
      DAKINI_STATE_FILE: "",
      APP_USERNAME: "",
      APP_PASSWORD: "",
      DISCOVERY_TIME: "23:59"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  baseUrl = `http://127.0.0.1:${port}`;

  await new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    const timeout = setTimeout(() => reject(new Error(`Recovery server timed out: ${output}${errors}`)), 15000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.includes("Dakini ICP Scraper running")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on("data", chunk => {
      errors += chunk.toString();
    });
    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", code => {
      if (child.exitCode !== null) {
        clearTimeout(timeout);
        reject(new Error(`Recovery server exited with code ${code}: ${output}${errors}`));
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

test("resumes an interrupted source-discovery job after server restart", async () => {
  let jobs;
  const deadline = Date.now() + 10000;
  do {
    const response = await fetch(`${baseUrl}/api/jobs`);
    assert.equal(response.status, 200);
    jobs = await response.json();
    if (jobs[0]?.status === "completed") break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);

  assert.equal(jobs[0].id, "interrupted-source-scan");
  assert.equal(jobs[0].status, "completed");
  assert.ok(jobs[0].completedAt);
});

test("resumes an interrupted web-discovery job after server restart", async () => {
  const deadline = Date.now() + 10000;
  let job;
  do {
    const response = await fetch(`${baseUrl}/api/jobs`);
    assert.equal(response.status, 200);
    const jobs = await response.json();
    job = jobs.find(item => item.id === "interrupted-web-discovery");
    if (job?.status === "completed") break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);

  assert.equal(job.status, "completed");
  assert.ok(job.completedAt);
  assert.ok(job.resumedAt);
});

test("the on-demand retrieval route returns an explicit result when no directory is approved", async () => {
  const response = await fetch(`${baseUrl}/api/source-retrieval/run-now`, { method: "POST" });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "No public directory sources are approved for retrieval."
  });

  const catalogResponse = await fetch(`${baseUrl}/api/public-sources`);
  const catalog = await catalogResponse.json();
  assert.deepEqual(catalog, []);
});

test("rejects approval of a removed placeholder directory", async () => {
  const addResponse = await fetch(`${baseUrl}/api/public-sources/digital-marketing-agencies-directory`, { method: "POST" });
  assert.equal(addResponse.status, 404);

  const runResponse = await fetch(`${baseUrl}/api/source-retrieval/run-now`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ includeCuratedSources: false })
  });
  assert.equal(runResponse.status, 409);
  assert.deepEqual(await runResponse.json(), {
    error: "No public directory sources are approved for retrieval."
  });
});

test("manual retrieval rejects the curated-source option when no verified curated source exists", async () => {
  const response = await fetch(`${baseUrl}/api/source-retrieval/run-now`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ includeCuratedSources: true })
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "No public directory sources are approved for retrieval."
  });
});
