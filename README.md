# Master Spreadsheet Management System

A lightweight, reliable desktop application to manage, consolidate, compare, and clean multiple Excel (`.xlsx`, `.xls`) and CSV (`.csv`) spreadsheets into a persistent `Master.xlsx` workbook.

---

## 1. Key Objectives & Scope Boundary

- **Consolidate Spreadsheets**: Merge multiple Excel workbooks, specific worksheets, and CSV datasets in a single batch.
- **Maintain a Single Source of Truth**: Safely maintain `Master.xlsx` without using external databases or heavy servers.
- **Safe Deduplication**: Detect exact duplicates (entire row, selected columns, common columns) and probable duplicates (configurable RapidFuzz matching) with safeguards against false matches on blank cells.
- **Preserve Valuable Data**: Never discard useful columns, allow complementary merges (filling missing values across duplicate rows), and flag non-empty conflicts for user resolution.
- **Multi-Sheet Report Generation**: Produce downloadable Excel workbooks with `Cleaned_Master`, `Duplicate_Report`, `Processing_Summary`, `Review_Required`, and `Source_Trace`.
- **Zero Lock-in**: Optional flat CSV export with custom delimiters (comma, semicolon, tab) and UTF-8 encoding.

---

## 2. Minimal Technology Stack

- **Python 3.10+** (Core processing and data normalization)
- **Streamlit** (Clean, responsive web UI for upload, preview, duplicate review, and downloads)
- **Pandas** (Tabular data consolidation, column mapping, and manipulation)
- **Openpyxl** (Multi-sheet Excel workbook generation with frozen headers, autofilters, and styling)
- **RapidFuzz** (Fast C++ approximate text matching for probable duplicates)
- **xlrd** (Support for legacy `.xls` workbooks)

---

## 3. System Architecture

```
Master Database/
│
├── core/
│   ├── __init__.py           # Package exports
│   ├── config.py             # Paths, defaults, directory structure
│   ├── file_loader.py        # Safe ingestion of .xlsx, .xls, .csv, encodings, and delimiters
│   ├── schema_mapper.py      # Semantic synonyms, fuzzy header alignment, ambiguous resolution
│   ├── normalizer.py         # Blank detection, whitespace/case cleaning, date normalization, preserving strings/zeros
│   ├── duplicate_engine.py   # Exact and probable duplicate detection algorithms
│   ├── resolver.py           # Resolution strategies (first, last, most populated, manual, merge complementary)
│   ├── master_manager.py     # Persistent Master.xlsx lifecycle, atomic writes, backups, restore
│   ├── excel_exporter.py     # Openpyxl multi-sheet workbook generation & formula injection prevention
│   └── workflow.py           # End-to-end orchestration pipeline
│
├── data/
│   └── Master.xlsx           # The persistent master workbook (created on first import)
│
├── backups/                  # Timestamped, recoverable backups before each master update
│   └── Master_backup_YYYYMMDD_HHMMSS_*.xlsx
│
├── sample_data/              # Test datasets for demonstration
│   ├── companies_batch1.xlsx # Multi-sheet Excel workbook
│   ├── customers.csv         # CSV with alternative column headers (synonyms)
│   └── partners_semicolon.csv# Semicolon-delimited CSV with quoted multiline text
│
├── tests/
│   └── test_acceptance_criteria.py # 19 automated acceptance criteria tests
│
├── app.py                    # Interactive Streamlit application
├── requirements.txt          # Minimal Python dependencies
└── test_e2e_pipeline.py      # Automated end-to-end verification pipeline
```

---

## 4. Quick Start & Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Launch the Application

```bash
streamlit run app.py
```

The application will open in your browser at `http://localhost:8501`.

---

## 5. Clean, Unified User Interface

The application has been overhauled into a **single, zero-confusion workspace**:

1. **📁 1. Upload Spreadsheets**
   - Drag and drop `.xlsx`, `.xls`, and `.csv` files into one unified drop zone.
   - Live badges display file names, detected worksheets, and total incoming rows.
   - Simple Master Mode selector:
     - 🔘 *Create New Master from this upload* (Clean slate; recommended)
     - 🔘 *Merge with existing Master.xlsx on disk*

2. **⚙️ Optional Settings (Collapsed by default)**
   - *Column Schema Alignment*: View or adjust automatic semantic synonym mappings if desired.
   - *Duplicate Detection Rules*: Defaults to `Entire Row` (safest; zero data loss). Optional toggles for selected columns and fuzzy matching.

3. **🚀 1-Click Processing & Reconciliation**
   - Click **`⚡ Consolidate & Clean All Data Now`** to immediately align schemas, verify unique records, and generate the cleaned master.
   - Three clean summary cards: **Input Rows Read**, **Duplicates Removed**, and **Cleaned Master Rows**.
   - If duplicates are found, an expandable review section lets you inspect matching rows and resolution actions.
   - Interactive preview table showing the final cleaned records.

4. **💾 Instant Downloads & Save**
   - **`⬇️ Download Master Excel`**: Formatted `.xlsx` with all 5 required worksheets (`Cleaned_Master`, `Duplicate_Report`, `Processing_Summary`, `Review_Required`, `Source_Trace`).
   - **`⬇️ Download Master CSV`**: UTF-8 flat table.
   - **`💾 Save as Disk Master.xlsx`**: Commits the dataset to disk with automatic timestamped backup.

5. **⚙️ Sidebar: Master File & Backup Recovery**
   - Keeps administrative tools accessible yet completely out of the way of your workflow.
   - View current `Master.xlsx` status on disk, download it, upload custom masters, restore from backups, or reset.

---

## 6. Testing & Quality Assurance

Run the automated test suite covering all 19 acceptance criteria:

```bash
python -m unittest tests/test_acceptance_criteria.py
```

Run the end-to-end sample data pipeline:

```bash
python test_e2e_pipeline.py
```
