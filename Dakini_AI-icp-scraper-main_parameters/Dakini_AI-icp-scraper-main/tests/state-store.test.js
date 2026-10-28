const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { createStateStore } = require("../state-store");

const temporaryDirectories = [];
const stores = [];

function createTemporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dakini-state-test-"));
  temporaryDirectories.push(directory);
  const store = createStateStore(path.join(directory, "state.sqlite"));
  stores.push(store);
  return { directory, store };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("persists and restores all state collections and discovery metadata", () => {
  const { directory, store } = createTemporaryStore();
  const snapshot = {
    icps: [{ id: "icp-1", industries: ["digital marketing"] }],
    sources: [{ id: "source-1", approved: true }],
    jobs: [{ id: "job-1", status: "completed" }],
    companies: [{ id: "company-1", score: { score: 82 } }],
    scrapedDomains: [{ id: "example.com" }],
    sourceCandidates: [{ id: "candidate-1", status: "pending" }],
    googleConnections: [{
      id: "browser-session",
      encryptedTokens: {
        version: 1,
        iv: "iv",
        authTag: "tag",
        ciphertext: "ciphertext"
      },
      spreadsheetId: "sheet-id",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-id"
    }],
    discoveryState: { lastRunAt: "2025-01-01T00:00:00.000Z" }
  };

  store.saveSnapshot(snapshot);
  store.close();
  stores.pop();
  const reopened = createStateStore(path.join(directory, "state.sqlite"));
  stores.push(reopened);

  assert.deepEqual(reopened.loadSnapshot(), snapshot);
  assert.equal(reopened.healthCheck(), true);
});

test("rolls back invalid snapshots and removes deleted records", () => {
  const { store } = createTemporaryStore();
  store.saveSnapshot({
    icps: [{ id: "keep", name: "Original" }],
    sources: [],
    jobs: [],
    companies: [],
    sourceCandidates: [],
    discoveryState: {}
  });

  assert.throws(() => store.saveSnapshot({
    icps: [{ id: "keep", name: "Changed" }, { name: "Missing identifier" }],
    sources: [],
    jobs: [],
    companies: [],
    sourceCandidates: [],
    discoveryState: {}
  }), /invalid icps record/i);
  assert.equal(store.loadSnapshot().icps[0].name, "Original");

  store.saveSnapshot({
    icps: [],
    sources: [],
    jobs: [],
    companies: [],
    sourceCandidates: [],
    discoveryState: {}
  });
  assert.deepEqual(store.loadSnapshot().icps, []);
});
