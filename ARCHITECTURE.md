# Architecture Specification: Master Spreadsheet Management System

## 1. System Overview & Design Philosophy

The **Master Spreadsheet Management System** is a lightweight, local-first data consolidation, prospect research integration, and deduplication platform built in Python.

### Core Design Principles:
- **Single Source of Truth**: `Master.xlsx` serves as the primary master spreadsheet, maintained locally without requiring external cloud databases (PostgreSQL, MySQL, Redis).
- **Deep Scraper & Source Integration**: Integrates directly with the **Dakini AI ICP Scraper** (Node.js/Express, `.dakini-state.sqlite`) to ingest verified leads, public phone numbers, emails, and ICP fit scores.
- **Dynamic Real-Time Synchronization**: Watches lead discovery in real time and automatically pushes genuinely new or updated records into `Master.xlsx` without manual file exporting.
- **Unified Process Coordination**: Orchestrates the lifecycles of both the Python consolidation engine and the Node.js scraper so they launch, operate, and shut down together.
- **Data Preservation & Complementary Merging**: Safe normalization, blank safeguards, and complementary merging prevent accidental data loss. Missing fields in existing master rows are enriched without deleting custom columns.
- **Zero-Clutter Multi-Sheet Reporting**: Primary output is a formatted `.xlsx` workbook containing only non-empty, populated tabs (`Cleaned_Master`, `Processing_Summary`, `Source_Trace`, and conditional audit sheets).
- **Atomic Operations & Instant Recovery**: Safe atomic writes and automatic timestamped backups before updates ensure zero data corruption.
- **GitHub & Privacy Safeguards**: Strict `.gitignore` rules protect all Excel spreadsheets, backups, scrapers, and SQLite databases from being uploaded to public version control.

---

## 2. High-Level Architecture Diagram

```mermaid
graph TD
    subgraph UI_Layer ["Presentation Layer (Streamlit)"]
        UI["app.py (Single-Page Workspace, Dakini Controller & Sidebar)"]
    end

    subgraph Process_Coordinator ["Process & Lifecycle Coordination"]
        ORCH["Unified Runner (run_integrated_system.py)"]
        SMAN["Scraper Manager (core/scraper_manager.py)"]
    end

    subgraph External_Systems ["Scraper & Discovery Engines"]
        DAKINI["Dakini AI ICP Scraper (Node.js/Express :3000)"]
        DAKINI_DB[("Dakini SQLite (.dakini-state.sqlite)")]
        DAKINI_CSV["Enriched Prospect CSVs"]
    end

    subgraph Sync_Layer ["Dynamic Real-Time Synchronization"]
        SYNC["DakiniSyncEngine (core/sync_engine.py)"]
        DAEMON["sync_daemon.py (Continuous Background Watcher)"]
        SYNC_STATE[("data/.dakini_sync_state.json")]
    end

    subgraph Orchestration ["Orchestration Layer"]
        WF["ConsolidationWorkflow (core/workflow.py)"]
    end

    subgraph Engines ["Core Processing Engines"]
        FL["File Loader & Sniffer (core/file_loader.py)"]
        CONN["Dakini Connector (core/connectors/dakini_connector.py)"]
        SM["Schema Mapper & Synonyms (core/schema_mapper.py)"]
        NORM["Safe Normalizer (core/normalizer.py)"]
        DEDUP["Duplicate Detection Engine (core/duplicate_engine.py)"]
        RES["Resolution & Merge Engine (core/resolver.py)"]
        EXP["Excel & CSV Exporter (core/excel_exporter.py)"]
        MM["Master Manager (core/master_manager.py)"]
    end

    subgraph Storage ["Local File System Persistence (Git-Ignored)"]
        DISK_MASTER[("data/Master.xlsx")]
        BACKUPS[("backups/Master_backup_*.xlsx")]
        TEMP[("temp/temp_*.xlsx")]
    end

    ORCH --> UI
    ORCH --> SMAN
    ORCH --> DAKINI
    ORCH --> SYNC

    SMAN --> DAKINI
    DAKINI --> DAKINI_DB
    DAKINI --> DAKINI_CSV

    SYNC --> DAKINI_DB
    SYNC --> DAKINI_CSV
    SYNC --> SYNC_STATE
    SYNC --> WF

    DAEMON --> SYNC

    UI --> WF
    UI --> SMAN
    UI --> SYNC
    WF --> FL
    WF --> CONN
    WF --> SM
    WF --> NORM
    WF --> DEDUP
    WF --> RES
    WF --> EXP
    WF --> MM

    MM --> DISK_MASTER
    MM --> BACKUPS
    MM --> TEMP
    EXP --> UI
    EXP --> DISK_MASTER
```

---

## 3. End-to-End Pipeline & Execution Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Runner as Integrated Runner (run_integrated_system.py)
    participant Scraper as Dakini Scraper (Node.js :3000)
    participant Sync as Sync Engine (core/sync_engine.py)
    participant Mapper as Schema Mapper (schema_mapper.py)
    participant Engine as Duplicate Engine (duplicate_engine.py)
    participant Resolver as Resolution Engine (resolver.py)
    participant Exporter as Excel Exporter (excel_exporter.py)
    participant Master as Master Manager (master_manager.py)

    User->>Runner: python run_integrated_system.py
    Runner->>Scraper: Spawn Node.js scraper process (port 3000)
    Runner->>Sync: Start dynamic background sync watcher (15s polling)
    Runner->>User: Launch Streamlit Web UI (http://localhost:8501)

    Note over User,Scraper: User initiates search or automated crawl runs
    Scraper->>Scraper: Crawl company websites & directories
    Scraper->>Scraper: Extract public contacts, verify signals & score ICP (0-100)
    Scraper->>Scraper: Persist to .dakini-state.sqlite (WAL mode)

    Sync->>Sync: Detect database signature / WAL change
    Sync->>Mapper: Extract leads and map synonyms (Public Phone, Website, Fit Score)
    Sync->>Engine: Detect duplicates against current data/Master.xlsx
    Sync->>Resolver: Apply complementary merge (backfill missing fields)
    Sync->>Master: Create timestamped backup in backups/
    Sync->>Exporter: Generate populated sheets (Cleaned_Master, Processing_Summary, Source_Trace)
    Exporter->>Master: Atomic replace data/Master.xlsx
    Sync-->>User: Terminal log: "Update Complete: +N new leads, N merged"

    User->>Runner: Press Ctrl+C
    Runner->>Scraper: Graceful SIGINT shutdown (PID terminated)
    Runner->>Sync: Stop sync thread
    Runner->>User: Coordinated exit; zero orphaned processes
```

---

## 4. Component Specification & Responsibilities

### 4.1 Process Coordinator & Scraper Manager (`core/scraper_manager.py`)
- **Class**: `ScraperManager`
- **Responsibilities**:
  - Manages the lifecycle of the Dakini AI scraper process (`node server.js`).
  - Tracks child process PIDs and stores them in `data/.dakini_scraper.pid`.
  - Performs non-blocking HTTP health probes on `http://127.0.0.1:3000/api/health`.
  - Redirects background scraper output to `data/dakini_scraper.log`.
  - Registers OS termination hooks (`atexit`, `signal`) so stopping the Python application immediately terminates the Node.js scraper process.

### 4.2 Dynamic Synchronization Engine (`core/sync_engine.py` & `sync_daemon.py`)
- **Class**: `DakiniSyncEngine`
- **Responsibilities**:
  - Detects state modifications in `.dakini-state.sqlite` and enriched CSVs using SHA-256 signatures and file stats.
  - Maintains persistent sync metadata in `data/.dakini_sync_state.json`.
  - Calculates delta records (genuinely new prospects vs. updated existing leads).
  - Invokes `ConsolidationWorkflow` to deduplicate and complementary-merge new data into `data/Master.xlsx`.
  - Provides `sync_daemon.py` for continuous, headless 24/7 background execution with configurable polling intervals.

### 4.3 Ingestion & Dakini Connector (`core/connectors/dakini_connector.py`)
- **Class**: `DakiniConnector`
- **Responsibilities**:
  - Scans workspace subdirectories (`Dakini_AI-icp-scraper-main_parameters/`) for active databases and CSVs.
  - Reads Dakini SQLite databases using safe read-only URI mode (`mode=ro`), preventing file lock conflicts while the crawler is actively writing.
  - Supports both columnar tables and document-based `records` tables (`collection = 'companies'`).
  - Extracts and flattens prospect attributes: company name, domain, website, public phone numbers, emails, fit score (0–100), fit tier, and workflow evidence.
  - Supports score threshold filtering (e.g. `90+ High Potential`, `45+ Research`).

### 4.4 Schema Alignment & Synonym Engine (`core/schema_mapper.py`)
- **Class**: `SchemaMapper`
- **Responsibilities**:
  - Standardizes tabular headers (lowercase, strips punctuation, normalizes spacing).
  - Semantic synonym dictionary covering standard business and Dakini prospect attributes:
    - `Public phone number(s)` / `Public phone` ↔ `Phone`
    - `Public business email` / `Public email` ↔ `Email`
    - `Dakini AI fit score (0-100)` / `Fit Score` ↔ `Score`
    - `Dakini fit level` / `Tier` ↔ `Status`
    - `Company website (Clutch linked)` ↔ `Website`
    - `India-listed office location` ↔ `Location` / `City`
    - `Dakini workflow evidence` / `Score basis` ↔ `Notes` / `Evidence`
    - `Business start year` / `Company age` ↔ `Age`

### 4.5 Safe Normalizer (`core/normalizer.py`)
- **Features**:
  - Trims whitespace, condenses multiple spaces, and normalizes casing.
  - Recognizes standard null/blank placeholders (`""`, `nan`, `none`, `null`, `n/a`, `-`).
  - Normalizes dates into standard `YYYY-MM-DD` strings if unambiguous.
  - Maintains shadow DataFrames for comparison while **preserving original cell values for display and export**.

### 4.6 Duplicate Detection Engine (`core/duplicate_engine.py`)
- **Supported Modes**:
  1. **Entire Row**: Compares all applicable columns (safest mode; default).
  2. **Selected Columns**: Compares user-selected fields (e.g., Company Name, Domain).
  3. **Common Columns**: Compares fields shared across all datasets.
  4. **Probable Matching**: Optional `RapidFuzz` token similarity matching with configurable threshold (60%–98%).
- **Critical Safeguards**:
  - **Blank Protection**: Missing or blank values never match other blanks as duplicates.
  - **Core Identifier Shielding**: Rows differing in core identifiers are automatically protected with `keep_both`.
  - **Low-Cardinality Protection**: Non-unique fields with large clusters are flagged for review rather than auto-deleted.

### 4.7 Duplicate Resolution & Merge Engine (`core/resolver.py`)
- **Resolution Actions**:
  - `merge_complementary`: Fills blank/empty fields in the preferred row using valid non-empty data from matching duplicate rows. Conflicting non-empty values are preserved without silent overwriting.
  - `keep_first` / `keep_last` / `keep_most_populated` / `keep_both`.

### 4.8 Master Lifecycle Manager (`core/master_manager.py`)
- **Class**: `MasterManager`
- **Persistent Location**: `data/Master.xlsx`
- **Backup Location**: `backups/Master_backup_YYYYMMDD_HHMMSS_*.xlsx`
- **Features**:
  - Creates timestamped safety backups before every update.
  - Same-directory atomic file replacement (`temp_*.xlsx` ➔ `Master.xlsx`) preventing file corruption.
  - Windows file lock detection (provides clear notifications if `Master.xlsx` is open in Excel).
  - Complete backup history with one-click restoration.

### 4.9 Clean Multi-Sheet Excel Exporter (`core/excel_exporter.py`)
- **Clean Tab Architecture (No Blank Sheets)**:
  1. `Cleaned_Master`: Primary consolidated dataset with frozen header row (`A2`), autofilters, and styled headers.
  2. `Processing_Summary`: Always-populated operational metrics table (Consolidated records, active data columns, contributing sources, duplicate status, last updated timestamp).
  3. `Source_Trace`: Row-by-row provenance mapping each master row back to original file, sheet, or scrape job.
  4. `Duplicate_Report`: **Conditionally created**; only appears when duplicate groups were identified and resolved. Omitted when 0 duplicates exist.
  5. `Review_Required`: **Conditionally created**; only appears when ambiguous matches or manual conflict items exist. Omitted when clean.
- **Formula Injection Safeguard**: Values starting with formula triggers (`=`, `+`, `-`, `@`) are escaped with a leading quote (`'`).

### 4.10 Unified Runner & Presentation Layer (`run_integrated_system.py` & `app.py`)
- **`run_integrated_system.py`**:
  - Unified entry point that launches Dakini Scraper, Dynamic Sync Watcher, and Streamlit UI in one coordinated process tree.
  - Handles `SIGINT` / `SIGTERM` to gracefully stop all systems together.
- **`app.py`**:
  - Streamlit dashboard with drag-and-drop file ingestion zone.
  - Dedicated **"🤖 Dakini AI ICP Scraper Connector"** tab with live process status badge (`● Online` / `○ Offline`), launch/stop buttons, database inspection, and one-click manual sync.

---

## 5. Directory Structure & File Layout

```
d:/Master Database/
│
├── core/
│   ├── __init__.py           # Package exports
│   ├── config.py             # Directory paths and global constants
│   ├── file_loader.py        # Safe ingestion of .xlsx, .xls, .csv
│   ├── schema_mapper.py      # Semantic synonyms and schema alignment
│   ├── normalizer.py         # Whitespace, blank, and date normalization
│   ├── duplicate_engine.py   # Exact and fuzzy duplicate detection
│   ├── resolver.py           # Resolution strategies and complementary merging
│   ├── master_manager.py     # Master persistence, atomic writes, backups
│   ├── excel_exporter.py     # Openpyxl multi-sheet workbook generator (clean tabs)
│   ├── workflow.py           # End-to-end orchestration pipeline
│   ├── scraper_manager.py    # Process lifecycle coordinator for Dakini Scraper
│   ├── sync_engine.py        # Dynamic real-time change detection & sync engine
│   └── connectors/
│       ├── __init__.py       # Connectors package exports
│       └── dakini_connector.py # SQLite and CSV reader for Dakini prospect research
│
├── data/                     # [GIT-IGNORED] Persistent data storage
│   ├── Master.xlsx           # Persistent master workbook
│   ├── .dakini_sync_state.json # Dynamic sync change detection state
│   └── .dakini_scraper.pid   # Background scraper PID tracking
│
├── backups/                  # [GIT-IGNORED] Recoverable timestamped backups
│   └── Master_backup_YYYYMMDD_HHMMSS_*.xlsx
│
├── temp/                     # [GIT-IGNORED] Temporary staging files
│
├── Dakini_AI-icp-scraper-main_parameters/ # Integrated Dakini AI Scraper Project
│   └── Dakini_AI-icp-scraper-main/
│       ├── server.js         # Node.js/Express prospect research server
│       ├── state-store.js    # SQLite storage with node:sqlite native fallback
│       ├── backup-database.js# SQLite backup utility
│       ├── package.json      # Node dependencies (node >= 22 / node 24 supported)
│       └── .dakini-state.sqlite # [GIT-IGNORED] Live crawl database
│
├── sample_data/              # Test datasets for demonstration
│   ├── companies_batch1.xlsx
│   ├── customers.csv
│   └── partners_semicolon.csv
│
├── tests/                    # Automated test suite
│   ├── test_acceptance_criteria.py
│   ├── test_dakini_connector.py
│   └── test_sync_engine.py
│
├── .gitignore                # Complete exclusion of Excel, SQLite, backups, and logs
├── app.py                    # Interactive Streamlit web application
├── run_integrated_system.py  # Unified launcher for Scraper + Sync + Master Database
├── sync_daemon.py            # Standalone continuous background sync daemon
├── consolidate_dakini_to_master.py # Direct CLI consolidation script
├── requirements.txt          # Python dependencies
├── ARCHITECTURE.md           # Architecture specification document
└── README.md                 # User guide and operational manual
```

---

## 6. Verification & Test Coverage Summary

| Test Suite | Module | Test Scope | Status |
| :--- | :--- | :--- | :---: |
| **Acceptance Criteria** | `tests/test_acceptance_criteria.py` | 20 unit tests covering Excel ingestion, deduplication, complementary merge, backups, and formula safety | **PASS** |
| **Dakini Connector** | `tests/test_dakini_connector.py` | SQLite read-only extraction, schema alignment, score filtering, and complementary merge into Master | **PASS** |
| **Sync Engine** | `tests/test_sync_engine.py` | Delta calculation, hash signature change detection, and incremental updates | **PASS** |
| **Dakini State Store** | `tests/state-store.test.js` | SQLite snapshots, rollbacks, and native `node:sqlite` execution | **PASS** |
| **Dakini Backup** | `tests/backup-database.test.js` | Online vacuum backup and integrity checks | **PASS** |
