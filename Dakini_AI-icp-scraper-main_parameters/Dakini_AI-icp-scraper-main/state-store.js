const fs = require("node:fs");
const path = require("node:path");
let Database;
try {
  Database = require("better-sqlite3");
} catch {
  const { DatabaseSync } = require("node:sqlite");

  Database = class NodeSqliteAdapter {
    constructor(databasePath) {
      this.db = new DatabaseSync(databasePath);
    }

    pragma(cmd, options = {}) {
      const match = cmd.match(/^([a-zA-Z_]+)\s*=\s*(.+)$/);
      if (match) {
        this.db.exec(`PRAGMA ${cmd};`);
        return;
      }
      try {
        const stmt = this.db.prepare(`PRAGMA ${cmd};`);
        const row = stmt.get();
        if (options.simple && row) {
          return Object.values(row)[0];
        }
        return row ? [row] : [];
      } catch {
        return [];
      }
    }

    exec(sql) {
      this.db.exec(sql);
    }

    prepare(sql) {
      const stmt = this.db.prepare(sql);
      return {
        run: (...params) => stmt.run(...params),
        get: (...params) => stmt.get(...params) || undefined,
        all: (...params) => stmt.all(...params),
      };
    }

    transaction(fn) {
      return (...args) => {
        this.db.exec("BEGIN;");
        try {
          const result = fn(...args);
          this.db.exec("COMMIT;");
          return result;
        } catch (error) {
          try {
            this.db.exec("ROLLBACK;");
          } catch {}
          throw error;
        }
      };
    }

    close() {
      this.db.close();
    }
  };
}

const COLLECTIONS = [
  "icps",
  "sources",
  "jobs",
  "companies",
  "scrapedDomains",
  "sourceCandidates",
  "googleConnections"
];

function createStateStore(databasePath) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }

  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = FULL");
  database.pragma("busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    ) WITHOUT ROWID;
  `);

  const schemaVersion = database.pragma("user_version", { simple: true });
  if (schemaVersion > 1) {
    database.close();
    throw new Error(`Database schema ${schemaVersion} is newer than this application supports.`);
  }
  if (schemaVersion === 0) database.pragma("user_version = 1");

  const selectRecords = database.prepare("SELECT id, payload FROM records WHERE collection = ?");
  const upsertRecord = database.prepare(`
    INSERT INTO records (collection, id, payload) VALUES (?, ?, ?)
    ON CONFLICT (collection, id) DO UPDATE SET payload = excluded.payload
    WHERE records.payload <> excluded.payload
  `);
  const deleteRecord = database.prepare("DELETE FROM records WHERE collection = ? AND id = ?");
  const selectMetadata = database.prepare("SELECT payload FROM metadata WHERE key = ?");
  const upsertMetadata = database.prepare(`
    INSERT INTO metadata (key, payload) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET payload = excluded.payload
    WHERE metadata.payload <> excluded.payload
  `);

  function loadSnapshot() {
    const marker = selectMetadata.get("initialized");
    if (!marker) return null;
    const snapshot = { discoveryState: JSON.parse(selectMetadata.get("discoveryState")?.payload || "{}") };
    for (const collection of COLLECTIONS) {
      snapshot[collection] = selectRecords.all(collection).map(row => JSON.parse(row.payload));
    }
    return snapshot;
  }

  const saveSnapshot = database.transaction(snapshot => {
    for (const collection of COLLECTIONS) {
      const current = new Set();
      const records = snapshot[collection] || [];
      for (const record of records) {
        if (!record || typeof record.id !== "string" || !record.id) {
          throw new Error(`Cannot persist an invalid ${collection} record.`);
        }
        current.add(record.id);
        upsertRecord.run(collection, record.id, JSON.stringify(record));
      }
      for (const row of selectRecords.all(collection)) {
        if (!current.has(row.id)) deleteRecord.run(collection, row.id);
      }
    }
    upsertMetadata.run("discoveryState", JSON.stringify(snapshot.discoveryState || {}));
    upsertMetadata.run("initialized", "true");
  });

  return {
    loadSnapshot,
    saveSnapshot,
    healthCheck() {
      return database.prepare("SELECT 1 AS ok").get().ok === 1;
    },
    close() {
      database.close();
    }
  };
}

module.exports = { createStateStore };
