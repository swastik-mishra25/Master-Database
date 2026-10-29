# Master Spreadsheet Management System & Dakini AI Integration

A lightweight, local-first data consolidation platform and prospect research integration system that unifies multi-format spreadsheets (`.xlsx`, `.xls`, `.csv`) and live **Dakini AI ICP Scraper** leads into a verified, deduplicated `Master.xlsx` workbook.

---

## 1. Key Objectives & Capabilities

- **Consolidate Multi-Format Spreadsheets**: Ingest and align multiple Excel workbooks, specific worksheets, and CSV datasets in a single batch.
- **Dakini AI Prospect Research Integration**: Automatically ingests prospect research from the **Dakini AI ICP Scraper** (company website, public business emails, phone numbers, location, and 0–100 ICP fit scores).
- **Dynamic Real-Time Synchronization**: Monitors the scraper database (`.dakini-state.sqlite`) or enriched CSVs and automatically pushes new or updated leads into `Master.xlsx`.
- **Unified Process Lifecycle Coordination**: A single command runs both the Node.js scraper and the Python Master Database together—stopping the system stops all processes cleanly.
- **Safe Deduplication & Complementary Merging**: Detects duplicates across files and systems, backfilling missing contact fields in existing master rows without overwriting custom columns.
- **Clean Multi-Sheet Reporting**: Generates formatted Excel workbooks containing only populated, non-empty tabs (`Cleaned_Master`, `Processing_Summary`, `Source_Trace`, and conditional audit sheets).
- **GitHub & Privacy Protection**: Automatic `.gitignore` rules prevent client spreadsheets, prospect records, backups, and local SQLite databases from being uploaded to GitHub.
- **Atomic Operations & Instant Recovery**: Safe atomic writes and automatic timestamped backups before updates ensure zero data corruption.

---

## 2. Minimal Technology Stack

- **Python 3.10+**: Core data consolidation, normalization, and deduplication (`pandas`, `openpyxl`, `rapidfuzz`, `xlrd`).
- **Streamlit**: Unified desktop web interface with live process controls and reconciliations.
- **Node.js 22+ / 24**: Powering the integrated **Dakini AI ICP Scraper** (`express`, `cheerio`, `undici`, `zod`, native `node:sqlite`).

---

## 3. Directory Structure

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

## 4. Quick Start & Operational Workflows

### Setup Prerequisites (First Time Only)

1. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
2. **Install Scraper Node.js dependencies**:
   ```bash
   cd "Dakini_AI-icp-scraper-main_parameters/Dakini_AI-icp-scraper-main"
   npm install
   cd ../..
   ```

---

### Workflow 1: The Unified 1-Command Experience *(Recommended)*

To run the entire system with full process coordination, open your terminal and run:

```powershell
python run_integrated_system.py
```
*(To run Dakini in live web discovery mode with external crawling, add `--live`: `python run_integrated_system.py --live`)*

**What this automatically does:**
1. Starts the **Dakini Scraper** on `http://localhost:3000`.
2. Starts the **Dynamic Sync Engine** in the background (watching for new/changed leads every 15s).
3. Launches the **Master Database Web App** on `http://localhost:8501`.
4. **Coordinated Shutdown**: When you press **`Ctrl + C`**, all components shut down cleanly together.

---

### Workflow 2: Interactive Web App Dashboard

If you prefer operating through the browser:
```powershell
streamlit run app.py
```
* **Spreadsheet Uploads**: Drag and drop `.xlsx`, `.xls`, or `.csv` files into Step 1.
* **Scraper Controls**: Open the **"🤖 Dakini AI ICP Scraper Connector"** tab to view live scraper status (`● Online` / `○ Offline`), launch/stop the scraper with 1 click, or click **"🔄 Sync Unique Leads Now"**.
* **Consolidation**: Click **"⚡ Consolidate & Clean All Data Now"** to deduplicate and commit to `Master.xlsx`.

---

### Workflow 3: Standalone Background Sync Watcher

If you are running the Dakini crawler in one terminal and want real-time streaming into `Master.xlsx` in another:
```powershell
python sync_daemon.py --interval 15
```
* Polls every 15 seconds.
* When Dakini discovers or updates leads, the daemon automatically merges unique records into `data/Master.xlsx` with live terminal notifications.

---

### Workflow 4: Direct CLI Consolidation

To perform an instant one-off merge of Dakini prospects into `Master.xlsx`:
```powershell
python consolidate_dakini_to_master.py
```

---

## 5. Clean Multi-Sheet Excel Structure

When you open [`data/Master.xlsx`](file:///d:/Master%20Database/data/Master.xlsx), the workbook contains only clean, populated worksheets:

| Sheet Name | Description | Visibility Rule |
| :--- | :--- | :--- |
| **`Cleaned_Master`** | Primary consolidated dataset with frozen headers and autofilters. | Always Present |
| **`Processing_Summary`** | Operational statistics (total records, sources processed, timestamp, duplicate counts). | Always Present |
| **`Source_Trace`** | Data provenance tracing each master row back to original file, sheet, or scrape job. | Always Present |
| **`Duplicate_Report`** | Audit log detailing duplicate groups, matching fields, and resolution actions. | **Included ONLY when duplicates exist** |
| **`Review_Required`** | Flagged ambiguous records or conflicts requiring manual user review. | **Included ONLY when review items exist** |

> **Note on Windows File Locks**: If `Master.xlsx` is currently open in Microsoft Excel, Windows locks the file exclusively. Close Excel before running a sync to permit writing updates.

---

## 6. GitHub & Privacy Protection

The workspace includes a strict `.gitignore` that guarantees confidential prospect data is never committed or pushed to GitHub:
* All Excel files (`*.xlsx`, `*.xls`, `*.xlsm`, `*.csv`)
* Master files (`data/Master.xlsx`, `backups/`, `temp/`)
* SQLite databases (`*.sqlite`, `*.sqlite-wal`, `.dakini-state.sqlite*`)
* Runtime logs and PIDs (`data/*.log`, `data/*.pid`, `.dakini_sync_state.json`)

To ensure any previously tracked files are purged from the Git index without deleting them from disk, run:
```powershell
git rm --cached -r data/*.xlsx backups/*.xlsx data/.dakini_sync_state.json
git add .gitignore
git commit -m "Ignore all Excel sheets, backups, and local SQLite data from GitHub"
```

---

## 7. Testing & Quality Assurance

Run the automated Python test suites:
```powershell
python -m unittest tests/test_acceptance_criteria.py
python -m unittest tests/test_dakini_connector.py
python -m unittest tests/test_sync_engine.py
```

Run the Dakini Node.js core test suites:
```powershell
cd "Dakini_AI-icp-scraper-main_parameters/Dakini_AI-icp-scraper-main"
node --test tests/state-store.test.js tests/backup-database.test.js
```
