"""
One-click CLI script to consolidate Dakini AI ICP Scraper prospects directly into data/Master.xlsx.
"""
from pathlib import Path
import pandas as pd

from core.config import MASTER_FILE_PATH, ensure_directories
from core.connectors.dakini_connector import DakiniConnector, load_dakini_dataset
from core.master_manager import MasterManager
from core.workflow import ConsolidationWorkflow


def consolidate_dakini():
    ensure_directories()
    manager = MasterManager()

    # 1. Find Dakini datasets
    workspace_root = Path(__file__).resolve().parent
    detected_files = DakiniConnector.find_local_dakini_files(workspace_root)
    if not detected_files:
        print("❌ No Dakini database (.sqlite) or CSV dataset found in workspace.")
        return False

    target_file = detected_files[0]
    print(f"📁 Selected Dakini source: {target_file.name}")
    print(f"   Location: {target_file}")

    # 2. Load dataset
    ds = load_dakini_dataset(target_file)
    print(f"📊 Extracted {ds.row_count:,} prospects from Dakini source.")

    # 3. Setup consolidation workflow
    existing_master_rows = 0
    if manager.exists():
        existing_df = manager.load_master()
        if existing_df is not None:
            existing_master_rows = len(existing_df)
    print(f"📋 Current Master.xlsx on disk: {existing_master_rows:,} rows")

    workflow = ConsolidationWorkflow(manager)
    workflow.set_datasets([ds])

    # 4. Build staging and deduplicate
    print("🔄 Aligning schemas and building staging records...")
    staging_df = workflow.build_consolidated_staging(include_existing_master=True)
    print(f"   Total staging rows (Master + Dakini): {len(staging_df):,}")

    # Detect duplicates against Master by Company Name
    print("🔍 Detecting duplicate records...")
    exact_groups, probable_groups = workflow.detect_duplicates(
        comparison_mode="selected_columns",
        selected_columns=["Company Name"],
        enable_fuzzy=False,
    )
    print(f"   Found {len(exact_groups):,} duplicate groups.")

    # Apply resolutions
    print("✨ Resolving duplicates with safe merging...")
    cleaned_df, review_df = workflow.apply_resolutions()
    summary = workflow.processing_summary

    # 5. Commit to Master.xlsx with automatic backup
    print(f"💾 Saving cleaned master ({len(cleaned_df):,} total rows) to data/Master.xlsx...")
    extra_sheets = {}
    try:
        extra_sheets["Processing_Summary"] = workflow.get_summary_dataframe()
    except Exception:
        pass

    success, msg, backup_path = manager.save_master(cleaned_df, create_backup=True, extra_sheets=extra_sheets)
    if not success:
        print(f"❌ Failed to save Master: {msg}")
        return False

    backup_name = backup_path.name if backup_path else "Initial Master created"

    print("\n" + "=" * 60)
    print("✅ CONSOLIDATION COMPLETE!")
    print("=" * 60)
    print(f"• Previous Master Rows: {existing_master_rows:,}")
    print(f"• Dakini Prospects Processed: {ds.row_count:,}")
    print(f"• Duplicates Removed: {summary.get('confirmed_duplicates_removed', 0):,}")
    print(f"• Final Master Rows: {len(cleaned_df):,}")
    print(f"• Backup Created: {backup_name}")
    print("=" * 60 + "\n")
    return True


if __name__ == "__main__":
    consolidate_dakini()
