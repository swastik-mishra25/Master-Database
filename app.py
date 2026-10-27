"""
Master Spreadsheet Management System
Clean, unified single-page application for consolidating, deduplicating, and managing Excel and CSV spreadsheets.
"""
import io
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import pandas as pd
import streamlit as st

from core.config import (
    DEFAULT_BLANK_PLACEHOLDERS,
    DEFAULT_FUZZY_THRESHOLD,
    MASTER_FILE_PATH,
    MASTER_FILENAME,
    ensure_directories,
)
from core.excel_exporter import export_dataframe_to_csv, write_master_excel_workbook
from core.file_loader import (
    LoadedDataset,
    detect_csv_properties,
    inspect_excel_sheets,
    read_csv_dataset,
    read_excel_dataset,
)
from core.master_manager import MasterManager
from core.normalizer import PROVENANCE_COLS, is_blank
from core.workflow import ConsolidationWorkflow

# Page Configuration
st.set_page_config(
    page_title="Master Spreadsheet Management System",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Clean, modern CSS styling
st.markdown(
    """
    <style>
    .main-header {
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
        font-size: 2.1rem;
        font-weight: 700;
        color: #1E3A8A;
        margin-bottom: 0.2rem;
    }
    .sub-header {
        font-size: 1.0rem;
        color: #4B5563;
        margin-bottom: 1.5rem;
    }
    .card-container {
        background-color: #FFFFFF;
        border: 1px solid #E2E8F0;
        border-radius: 10px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .metric-card {
        background-color: #F8FAFC;
        border: 1px solid #E2E8F0;
        border-radius: 8px;
        padding: 16px;
        text-align: center;
        margin-bottom: 10px;
    }
    .metric-value {
        font-size: 1.9rem;
        font-weight: 700;
        color: #1E3A8A;
    }
    .metric-label {
        font-size: 0.85rem;
        color: #64748B;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .status-badge-active {
        background-color: #DEF7EC;
        color: #03543F;
        padding: 6px 12px;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 600;
        display: inline-block;
    }
    .status-badge-inactive {
        background-color: #FDE8E8;
        color: #9B1C1C;
        padding: 6px 12px;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 600;
        display: inline-block;
    }
    .banner-success {
        background-color: #F0FDF4;
        border: 1px solid #BBF7D0;
        border-left: 6px solid #16A34A;
        padding: 14px 18px;
        border-radius: 8px;
        margin-bottom: 20px;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


def get_manager() -> MasterManager:
    """Return a MasterManager instance."""
    ensure_directories()
    return MasterManager()


def init_session_state():
    """Initialize application session variables."""
    if "workflow" not in st.session_state:
        st.session_state.workflow = ConsolidationWorkflow(get_manager())
    if "loaded_datasets" not in st.session_state:
        st.session_state.loaded_datasets = []
    if "sheet_selections" not in st.session_state:
        st.session_state.sheet_selections = {}
    if "processing_done" not in st.session_state:
        st.session_state.processing_done = False
    if "master_mode" not in st.session_state:
        st.session_state.master_mode = "fresh"


init_session_state()
manager = get_manager()
master_summary = manager.get_summary()

# -------------------------------------------------------------
# SIDEBAR: MASTER FILE & BACKUP RECOVERY
# -------------------------------------------------------------
with st.sidebar:
    st.markdown("### ⚙️ Master File & Backups")

    if master_summary["exists"]:
        st.markdown('<span class="status-badge-active">● Master.xlsx Active</span>', unsafe_allow_html=True)
        st.write(f"**Rows:** **{master_summary['row_count']:,}** | **Columns:** {master_summary['column_count']}")
        st.caption(f"Last modified: {master_summary['last_modified']}")

        # Quick download of current disk master
        disk_master = manager.load_master()
        if disk_master is not None:
            excel_buf_disk = io.BytesIO()
            write_master_excel_workbook(excel_buf_disk, disk_master)
            st.download_button(
                f"⬇️ Download Current Master ({master_summary['row_count']:,} rows)",
                data=excel_buf_disk.getvalue(),
                file_name="Master.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                use_container_width=True,
            )
    else:
        st.markdown('<span class="status-badge-inactive">○ No Master.xlsx Found</span>', unsafe_allow_html=True)
        st.caption("Will be created when you process your first batch.")

    st.markdown("---")

    # Upload custom Master
    with st.expander("📤 Upload Custom Master.xlsx"):
        st.caption("Import an existing Master.xlsx from another computer.")
        custom_m = st.file_uploader("Select Master.xlsx", type=["xlsx"], key="sidebar_custom_master")
        if custom_m is not None:
            if st.button("Import as Master", type="primary", use_container_width=True):
                ok, msg = manager.upload_custom_master(custom_m)
                if ok:
                    st.success(msg)
                    st.rerun()
                else:
                    st.error(msg)

    # Recover from Backups
    with st.expander("⏮️ Recover from Backup"):
        backups = manager.list_backups()
        if backups:
            st.caption(f"{len(backups)} backup(s) available:")
            for b in backups[:6]:
                st.write(f"📁 **{b['filename']}** ({b['size_kb']} KB)")
                st.caption(f"Date: {b['created_at']}")
                col_r1, col_r2 = st.columns(2)
                with col_r1:
                    with open(b["path"], "rb") as bf:
                        st.download_button("Download", data=bf.read(), file_name=b["filename"], key=f"s_dl_{b['filename']}")
                with col_r2:
                    if st.button("Restore", key=f"s_rst_{b['filename']}"):
                        ok, msg = manager.restore_backup(b["filename"])
                        if ok:
                            st.success(msg)
                            st.rerun()
                        else:
                            st.error(msg)
                st.markdown("---")
        else:
            st.info("No backups created yet. Backups are created automatically before every master update.")

    # Reset Master
    with st.expander("⚠️ Danger Zone: Reset Master"):
        st.caption("Resets the master workbook after creating a safety backup.")
        if st.button("Reset Master Workbook", type="secondary", use_container_width=True):
            ok, msg = manager.reset_master()
            if ok:
                st.warning(msg)
                st.rerun()
            else:
                st.error(msg)

    st.markdown("---")
    st.markdown("### 📘 System Architecture")
    arch_file = Path(__file__).parent / "ARCHITECTURE.md"
    if arch_file.exists():
        with open(arch_file, "r", encoding="utf-8") as af:
            st.download_button(
                "⬇️ Download System Architecture (.md)",
                data=af.read(),
                file_name="ARCHITECTURE.md",
                mime="text/markdown",
                use_container_width=True,
            )


# -------------------------------------------------------------
# MAIN SCREEN: UNIFIED CLEAN WORKSPACE
# -------------------------------------------------------------
st.markdown('<div class="main-header">Master Spreadsheet Management System</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-header">Upload multiple Excel and CSV files, automatically align schemas, clean duplicates, and generate a verified <code>Master.xlsx</code>.</div>',
    unsafe_allow_html=True,
)

# Step 1: Upload Files
st.markdown("### 1. Upload Spreadsheets")
uploaded_files = st.file_uploader(
    "Drag and drop spreadsheet files here (.xlsx, .xls, .csv)",
    type=["xlsx", "xls", "csv"],
    accept_multiple_files=True,
    key="unified_file_uploader",
)

all_loaded: List[LoadedDataset] = []

if uploaded_files:
    for up_file in uploaded_files:
        fname = up_file.name
        lower_name = fname.lower()

        if lower_name.endswith(".xlsx") or lower_name.endswith(".xls"):
            try:
                sheet_names = inspect_excel_sheets(up_file)
                default_sheets = st.session_state.sheet_selections.get(fname, sheet_names)
                # If multiple sheets exist, let user select
                if len(sheet_names) > 1:
                    selected_sheets = st.multiselect(
                        f"Worksheets to include from '{fname}':",
                        options=sheet_names,
                        default=[s for s in default_sheets if s in sheet_names] or sheet_names,
                        key=f"u_sheets_{fname}",
                    )
                else:
                    selected_sheets = sheet_names

                st.session_state.sheet_selections[fname] = selected_sheets
                for s_name in selected_sheets:
                    ds = read_excel_dataset(up_file, filename=fname, sheet_name=s_name)
                    all_loaded.append(ds)
            except Exception as ex:
                st.error(f"Error loading {fname}: {str(ex)}")

        elif lower_name.endswith(".csv"):
            try:
                det_enc, det_delim, _ = detect_csv_properties(up_file)
                ds = read_csv_dataset(up_file, filename=fname, encoding=det_enc, delimiter=det_delim)
                all_loaded.append(ds)
            except Exception as ex:
                st.error(f"Error loading {fname}: {str(ex)}")

    st.session_state.loaded_datasets = all_loaded
    total_incoming_rows = sum(d.row_count for d in all_loaded)

    # Display files summary badge
    file_badges = " &nbsp;|&nbsp; ".join([f"**{d.source_filename}** ({d.row_count:,} rows)" for d in all_loaded])
    st.info(f"📁 **Loaded Files:** {file_badges} &nbsp;—&nbsp; **Total Incoming Rows:** **{total_incoming_rows:,}**")

    # Master Mode Selection
    col_m1, col_m2 = st.columns([1, 1])
    with col_m1:
        master_mode = st.radio(
            "Target Master Action:",
            options=["fresh", "merge"],
            format_func=lambda x: {
                "fresh": "Create New Master from this upload (Clean slate; recommended)",
                "merge": f"Merge with existing Master.xlsx on disk ({master_summary['row_count']} existing rows)",
            }[x],
            index=0 if not master_summary["exists"] or master_summary["row_count"] <= 11 else 1,
            key="clean_master_mode_radio",
        )
        st.session_state.master_mode = master_mode

    # Step 2: Advanced Settings (Expandable, zero clutter)
    with st.expander("⚙️ Optional Settings (Column Mappings & Duplicate Rules)", expanded=False):
        wf_temp: ConsolidationWorkflow = st.session_state.workflow
        if all_loaded:
            wf_temp.set_datasets(all_loaded)

        tab_opt1, tab_opt2 = st.tabs(["Column Schema Alignment", "Duplicate Detection Rules"])
        with tab_opt1:
            st.write("**Target Canonical Columns:**", ", ".join(wf_temp.schema_mapper.target_columns))
            for ds in all_loaded:
                ds_id = f"{ds.source_filename}::{ds.sheet_name}"
                mapping = wf_temp.schema_mapper.mappings.get(ds_id, {})
                st.caption(f"Mappings for **{ds.source_filename}**: {mapping}")

        with tab_opt2:
            comp_mode = st.radio(
                "Comparison Mode:",
                options=["entire_row", "selected_columns"],
                format_func=lambda x: {
                    "entire_row": "Entire Row (Safest — Compares all fields, zero unique data lost)",
                    "selected_columns": "Selected Columns Only",
                }[x],
                index=0,
                key="clean_comp_mode",
            )
            selected_cols = []
            if comp_mode == "selected_columns":
                data_cols = [c for c in wf_temp.schema_mapper.target_columns if c not in PROVENANCE_COLS]
                selected_cols = st.multiselect("Select columns to compare:", options=data_cols, default=data_cols[:2])

            enable_fuzzy = st.checkbox("Enable Probable (Fuzzy) Matching for Similar Text", value=False)
            fuzzy_cols = []
            fuzzy_thresh = 85.0
            if enable_fuzzy:
                data_cols = [c for c in wf_temp.schema_mapper.target_columns if c not in PROVENANCE_COLS]
                fuzzy_cols = st.multiselect("Fields for fuzzy matching:", options=data_cols, default=data_cols[:1])
                fuzzy_thresh = st.slider("Fuzzy Threshold (%):", min_value=60, max_value=98, value=85)

    # Step 3: Action Button
    st.markdown("---")
    if st.button(f"⚡ Consolidate & Clean All Data Now ({total_incoming_rows:,} rows)", type="primary", use_container_width=True):
        with st.spinner("Consolidating datasets, aligning schemas, and verifying records..."):
            wf: ConsolidationWorkflow = st.session_state.workflow
            wf.set_datasets(all_loaded)
            include_m = (master_mode == "merge" and manager.exists())
            wf.build_consolidated_staging(include_existing_master=include_m)

            c_mode = st.session_state.get("clean_comp_mode", "entire_row")
            wf.detect_duplicates(
                comparison_mode=c_mode,
                selected_columns=selected_cols if c_mode == "selected_columns" else None,
                enable_fuzzy=st.session_state.get("enable_fuzzy", False),
                fuzzy_columns=fuzzy_cols if st.session_state.get("enable_fuzzy", False) else None,
                fuzzy_threshold=float(fuzzy_thresh) if st.session_state.get("enable_fuzzy", False) else 85.0,
            )
            wf.apply_resolutions()
            st.session_state.processing_done = True

    # Step 4: Results & Downloads
    wf: ConsolidationWorkflow = st.session_state.workflow

    # Auto-consolidate if user hasn't pressed button yet so downloads are always ready
    if wf.cleaned_df.empty and all_loaded:
        wf.set_datasets(all_loaded)
        include_m = (master_mode == "merge" and manager.exists())
        wf.build_consolidated_staging(include_existing_master=include_m)
        wf.detect_duplicates(comparison_mode="entire_row")
        wf.apply_resolutions()
        st.session_state.processing_done = True

    if not wf.cleaned_df.empty:
        st.markdown(
            f"""
            <div class="banner-success">
                <span style="font-size: 1.15rem; font-weight: 700; color: #15803D;">✅ Cleaned Master Ready: {len(wf.cleaned_df):,} records</span><br/>
                <span style="color: #4B5563;">All records consolidated and verified. Ready to download or save to disk.</span>
            </div>
            """,
            unsafe_allow_html=True,
        )

        # 3 Clean Metric Cards
        col_res1, col_res2, col_res3 = st.columns(3)
        with col_res1:
            st.markdown(
                f'<div class="metric-card"><div class="metric-value">{total_incoming_rows:,}</div><div class="metric-label">Input Rows Read</div></div>',
                unsafe_allow_html=True,
            )
        with col_res2:
            st.markdown(
                f'<div class="metric-card"><div class="metric-value" style="color: #DC2626;">-{wf.processing_summary.get("confirmed_duplicates_removed", 0):,}</div><div class="metric-label">Duplicates Removed</div></div>',
                unsafe_allow_html=True,
            )
        with col_res3:
            st.markdown(
                f'<div class="metric-card"><div class="metric-value" style="color: #16A34A;">{len(wf.cleaned_df):,}</div><div class="metric-label">Cleaned Master Rows</div></div>',
                unsafe_allow_html=True,
            )

        # Large Direct Download Buttons
        st.markdown("### 2. Download Cleaned Output")
        dl_col1, dl_col2, dl_col3 = st.columns(3)
        t_stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        with dl_col1:
            excel_buffer = io.BytesIO()
            write_master_excel_workbook(
                filepath=excel_buffer,
                cleaned_master_df=wf.cleaned_df,
                duplicate_report_df=wf.get_duplicate_report_dataframe(),
                processing_summary_df=wf.get_summary_dataframe(),
                review_required_df=wf.review_df,
            )
            st.download_button(
                label=f"⬇️ Download Master Excel ({len(wf.cleaned_df):,} rows)",
                data=excel_buffer.getvalue(),
                file_name=f"Master_Cleaned_{t_stamp}.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                type="primary",
                use_container_width=True,
            )

        with dl_col2:
            csv_data = export_dataframe_to_csv(wf.cleaned_df, delimiter=",").encode("utf-8")
            st.download_button(
                label=f"⬇️ Download Master CSV ({len(wf.cleaned_df):,} rows)",
                data=csv_data,
                file_name=f"Master_Cleaned_{t_stamp}.csv",
                mime="text/csv",
                use_container_width=True,
            )

        with dl_col3:
            if st.button("💾 Save as Disk Master.xlsx", type="secondary", use_container_width=True):
                ok, msg, b_path = wf.commit_to_master()
                if ok:
                    st.success(f"Saved to Master.xlsx on disk! {f'(Backup: {b_path.name})' if b_path else ''}")
                    st.rerun()
                else:
                    st.error(f"Failed to save: {msg}")

        # Data Preview Table
        with st.expander(f"👀 View Cleaned Master Data Preview ({len(wf.cleaned_df):,} rows)", expanded=True):
            display_cols = [c for c in wf.cleaned_df.columns if c not in PROVENANCE_COLS]
            st.dataframe(wf.cleaned_df[display_cols].head(25), use_container_width=True)

        # Duplicate Review (Only shown if duplicate groups were detected)
        all_dups = wf.exact_duplicate_groups + wf.probable_duplicate_groups
        if all_dups:
            with st.expander(f"🔍 Review Detected Duplicates ({len(all_dups)} group(s))", expanded=False):
                for g in all_dups:
                    st.write(f"**Group #{g.group_id}** — {len(g.row_indices)} records: {g.explanation}")
                    grp_df = wf.staging_df.loc[g.row_indices]
                    st.dataframe(grp_df[[c for c in grp_df.columns if c not in PROVENANCE_COLS]], use_container_width=True)

else:
    st.info("👆 Drag and drop your Excel or CSV spreadsheets above to begin. Everything is processed and prepared in one click.")
