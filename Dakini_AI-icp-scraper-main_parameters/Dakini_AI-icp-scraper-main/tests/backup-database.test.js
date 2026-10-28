const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { after, test } = require("node:test");
const { createDatabaseBackup } = require("../backup-database");
const { createStateStore } = require("../state-store");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dakini-backup-test-"));
const sourcePath = path.join(temporaryDirectory, "state.sqlite");
const backupPath = path.join(temporaryDirectory, "backup.sqlite");

after(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("creates a consistent SQLite backup and verifies its integrity", async () => {
  const store = createStateStore(sourcePath);
  store.saveSnapshot({
    icps: [{ id: "icp-1", name: "Test ICP" }],
    sources: [],
    jobs: [],
    companies: [],
    scrapedDomains: [],
    sourceCandidates: [],
    googleConnections: [],
    discoveryState: {}
  });
  store.close();

  assert.equal(await createDatabaseBackup(sourcePath, backupPath), backupPath);
  const database = new Database(backupPath, { readonly: true });
  try {
    assert.deepEqual(database.pragma("integrity_check"), [{ integrity_check: "ok" }]);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM records").get().count, 1);
  } finally {
    database.close();
  }
});

test("refuses to overwrite a backup or use the active database as its destination", async () => {
  await assert.rejects(createDatabaseBackup(sourcePath, sourcePath), /different from the active database/);
  await assert.rejects(createDatabaseBackup(sourcePath, backupPath), /already exists/);
  await assert.rejects(
    createDatabaseBackup(path.join(temporaryDirectory, "missing.sqlite"), path.join(temporaryDirectory, "new.sqlite")),
    /database not found/
  );
});
