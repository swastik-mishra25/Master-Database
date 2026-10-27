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

## 5. User Interface Walkthrough

The application features 6 specialized tabs:

1. **📁 1. Upload & Quick Clean**
   - Drag and drop `.xlsx`, `.xls`, and `.csv` files in the same batch.
   - For Excel: detects and displays sheet names; select individual worksheets.
   - For CSV: automatically detects encoding (UTF-8, Latin1, CP1252) and delimiters (comma, semicolon, tab, pipe) with manual override options.
   - **Master Mode Toggle**: Choose between creating a fresh master workbook from the uploaded batch or merging with the existing master on disk.
   - **⚡ 1-Click Auto-Consolidate**: Instantly consolidates all uploaded records (e.g., 1,368 rows), runs safe duplicate detection, and generates direct download buttons right on the upload page with zero row loss.
   - Displays row counts, column counts, warnings, and table previews.

2. **🔀 2. Schema Alignment**
   - Automatically maps equivalent column names using semantic synonym groups (e.g. `Company Name` ↔ `Business Name`, `Phone` ↔ `Contact Number`, `Email` ↔ `Email Address`).
   - Flags ambiguous column candidates for user confirmation.
   - Preserves unique/unmapped columns separately.
   - Displays real-time preview of consolidated staging data.

3. **🔍 3. Duplicate Review**
   - **Exact Matching**: Compare by entire row, selected fields (e.g., Email or Phone), or common shared columns.
   - **Probable Matching**: Optional RapidFuzz similarity matching with a configurable threshold (60% - 98%).
   - **Blank Safeguard**: Blank cells matching blank cells **never** trigger duplicate matches.
   - **Side-by-Side Review**: Inspect matching fields, differing fields, and confidence scores.
   - **Resolution Actions**:
     - *Keep First Occurrence*
     - *Keep Last Occurrence*
     - *Keep Most Populated Row*
     - *Merge Complementary Information* (fills missing fields across rows)
     - *Keep Both Records* (mark not duplicate)
     - *Manually Select Preferred Row*

4. **⚡ 4. Clean & Update**
   - Displays clear before-and-after row count reconciliation:
     - Original Master Rows
     - Incoming Rows
     - Duplicates Removed
     - Unique Records Added
     - Final Master Row Count
   - **Option A (Update Master.xlsx)**: Creates a timestamped backup in `backups/` and performs an atomic write to `data/Master.xlsx`.
   - **Option B (Download Only)**: Prepares the cleaned data without altering local storage.

5. **💾 5. Export Reports**
   - **Excel Workbook (`.xlsx`)**: Includes all 5 required worksheets:
     - `Cleaned_Master` (Consolidated clean data, frozen headers, autofilters, cell formatting)
     - `Duplicate_Report` (Audit log of all duplicate groups and actions taken)
     - `Processing_Summary` (Metrics and reconciliation table)
     - `Review_Required` (Uncertain matches, probable duplicates, and conflicts)
     - `Source_Trace` (Maps each master row back to original file, sheet, and row)
   - **CSV Export (`.csv`)**: Cleaned master dataset with configurable delimiter and UTF-8 encoding.
   - **Formula Injection Safeguard**: Values starting with `=`, `+`, `-`, or `@` are safely escaped.

6. **⚙️ 6. Master Management**
   - View current master metadata (row count, columns, file size, last modified).
   - Upload an existing `Master.xlsx` when migrating between machines.
   - One-click restore from any timestamped backup in `backups/`.
   - Reset master with explicit confirmation.

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
