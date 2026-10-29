const fs = require("node:fs");
const path = require("node:path");
let Database;
try {
  Database = require("better-sqlite3");
} catch {
  const { DatabaseSync } = require("node:sqlite");
  Database = class NodeSqliteBackupAdapter {
    constructor(filePath, options = {}) {
      this.db = new DatabaseSync(filePath, { readOnly: Boolean(options.readonly) });
    }
    async backup(destPath) {
      const normalized = destPath.replace(/\\/g, "/").replace(/'/g, "''");
      this.db.exec(`VACUUM INTO '${normalized}';`);
    }
    pragma(cmd) {
      try {
        const stmt = this.db.prepare(`PRAGMA ${cmd};`);
        const row = stmt.get();
        return row ? [row] : [];
      } catch {
        return [];
      }
    }
    prepare(sql) {
      const stmt = this.db.prepare(sql);
      return {
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
        run: (...args) => stmt.run(...args),
      };
    }
    close() {
      this.db.close();
    }
  };
}

async function createDatabaseBackup(sourcePath, destinationPath) {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedDestination = path.resolve(destinationPath);
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`SQLite database not found: ${resolvedSource}`);
  }
  if (resolvedSource === resolvedDestination) {
    throw new Error("Backup destination must be different from the active database.");
  }
  if (fs.existsSync(resolvedDestination)) {
    throw new Error(`Backup destination already exists: ${resolvedDestination}`);
  }

  fs.mkdirSync(path.dirname(resolvedDestination), { recursive: true });
  const database = new Database(resolvedSource, { readonly: true, fileMustExist: true });
  try {
    await database.backup(resolvedDestination);
  } finally {
    database.close();
  }

  const backup = new Database(resolvedDestination, { readonly: true, fileMustExist: true });
  try {
    const result = backup.pragma("integrity_check");
    if (result.length !== 1 || result[0].integrity_check !== "ok") {
      throw new Error(`SQLite backup integrity check failed: ${JSON.stringify(result)}`);
    }
  } finally {
    backup.close();
  }
  return resolvedDestination;
}

async function main() {
  require("dotenv").config();
  const sourcePath = path.resolve(
    process.env.DAKINI_DATABASE_FILE || path.join(__dirname, ".dakini-state.sqlite")
  );
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destinationPath = process.argv[2] || `${sourcePath}.backup-${timestamp}.sqlite`;
  const backupPath = await createDatabaseBackup(sourcePath, destinationPath);
  console.log(`SQLite backup created and integrity-checked at ${backupPath}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`SQLite backup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createDatabaseBackup };
