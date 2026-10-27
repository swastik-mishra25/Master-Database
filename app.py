"""
Master Spreadsheet Management System
Upgraded Streamlit Application for consolidating, deduplicating, and managing Excel and CSV spreadsheets.
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

# Custom CSS for styling
st.markdown(
    """
    <style>
    .main-header {
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
        font-size: 2.2rem;
        font-weight: 700;
        color: #1E3A8A;
        margin-bottom: 0.2rem;
    }
    .sub-header {
        font-size: 1.05rem;
        color: #4B5563;
        margin-bottom: 1.5rem;
    }
    .metric-card {
        background-color: #F8FAFC;
        border: 1px solid #E2E8F0;
        border-radius: 8px;
        padding: 16px;
        text-align: center;
        margin-bottom: 12px;
    }
    .metric-value {
        font-size: 1.8rem;
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
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 600;
    }
    .status-badge-inactive {
        background-color: #FDE8E8;
        color: #9B1C1C;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 600;
    }
    .banner-box {
        background-color: #EFF6FF;
        border-left: 5px solid #2563EB;
        padding: 12px 18px;
        border-radius: 6px;
        margin-bottom: 20px;
    }
    .stTabs [data-baseweb="tab-list"] {
        gap: 8px;
    }
    .stTabs [data-baseweb="tab"] {
        padding: 10px 20px;
        border-radius: 6px;
        font-weight: 600;
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
    if "csv_options" not in st.session_state:
        st.session_state.csv_options = {}
    if "processing_done" not in st.session_state:
        st.session_state.processing_done = False
    if "update_success_msg" not in st.session_state:
        st.session_state.update_success_msg = None
    if "master_mode" not in st.session_state:
        st.session_state.master_mode = "fresh"  # 'fresh' or 'merge'


init_session_state()
manager = get_manager()
master_summary = manager.get_summary()

# Top Header & System Status
col_h1, col_h2 = st.columns([3, 1])
with col_h1:
    st.markdown('<div class="main-header">Master Spreadsheet Management System</div>', unsafe_allow_html=True)
    st.markdown(
        '<div class="sub-header">Consolidate, align schemas, detect duplicates, and safely maintain <code>Master.xlsx</code>.</div>',
        unsafe_allow_html=True,
    )

with col_h2:
    if master_summary["exists"]:
        st.markdown(
            f"""
            <div style="text-align: right; margin-top: 8px;">
                <span class="status-badge-active">● Master.xlsx on Disk</span><br/>
                <small style="color: #64748B;">{master_summary['row_count']} rows | {master_summary['column_count']} cols</small><br/>
                <small style="color: #94A3B8;">Modified: {master_summary['last_modified']}</small>
            </div>
            """,
            unsafe_allow_html=True,
        )
    else:
        st.markdown(
            """
            <div style="text-align: right; margin-top: 8px;">
                <span class="status-badge-inactive">○ No Master.xlsx Found</span><br/>
                <small style="color: #64748B;">Will be created on first import</small>
            </div>
            """,
            unsafe_allow_html=True,
        )

# Main Navigation Tabs
tab_upload, tab_schema, tab_dup, tab_clean, tab_export, tab_master = st.tabs([
    "📁 1. Upload & Quick Clean",
    "🔀 2. Schema Alignment",
    "🔍 3. Duplicate Review",
    "⚡ 4. Clean & Reconcile",
    "💾 5. Export Reports",
    "⚙️ 6. Master Management",
])

# -------------------------------------------------------------
# TAB 1: UPLOAD & QUICK CLEAN
# -------------------------------------------------------------
with tab_upload:
    st.subheader("Upload Spreadsheet Files")
    st.write("Upload multiple Excel (`.xlsx`, `.xls`) and CSV (`.csv`) files in a single batch.")

    uploaded_files = st.file_uploader(
        "Drag and drop spreadsheet files here",
        type=["xlsx", "xls", "csv"],
        accept_multiple_files=True,
        key="file_uploader",
    )

    if uploaded_files:
        st.markdown("### Uploaded Batch Inspection")

        all_loaded: List[LoadedDataset] = []

        for up_file in uploaded_files:
            fname = up_file.name
            lower_name = fname.lower()

            with st.expander(f"📄 {fname} ({round(up_file.size / 1024, 1)} KB)", expanded=True):
                # Excel File Inspection
                if lower_name.endswith(".xlsx") or lower_name.endswith(".xls"):
                    try:
                        sheet_names = inspect_excel_sheets(up_file)
                        st.info(f"Available worksheets: **{', '.join(sheet_names)}**")

                        # Multi-select worksheets
                        default_sheets = st.session_state.sheet_selections.get(fname, sheet_names)
                        selected_sheets = st.multiselect(
                            f"Select worksheets to include from '{fname}':",
                            options=sheet_names,
                            default=[s for s in default_sheets if s in sheet_names] or sheet_names,
                            key=f"sheets_{fname}",
                        )
                        st.session_state.sheet_selections[fname] = selected_sheets

                        for s_name in selected_sheets:
                            ds = read_excel_dataset(up_file, filename=fname, sheet_name=s_name)
                            all_loaded.append(ds)
                            st.write(f"**Worksheet: `{s_name}`** — **{ds.row_count:,} rows**, {ds.column_count} columns")
                            if ds.warnings:
                                for w in ds.warnings:
                                    st.warning(w)
                            if ds.errors:
                                for e in ds.errors:
                                    st.error(e)
                            if not ds.df.empty:
                                st.dataframe(ds.df.head(3), use_container_width=True)
                    except Exception as ex:
                        st.error(f"Error inspecting Excel file {fname}: {str(ex)}")

                # CSV File Inspection
                elif lower_name.endswith(".csv"):
                    try:
                        det_enc, det_delim, det_warn = detect_csv_properties(up_file)
                        col_c1, col_c2 = st.columns(2)
                        with col_c1:
                            chosen_enc = st.selectbox(
                                f"Encoding for '{fname}':",
                                options=["utf-8", "utf-8-sig", "cp1252", "latin1", "iso-8859-1"],
                                index=0 if det_enc == "utf-8" else 1 if det_enc == "utf-8-sig" else 2,
                                key=f"enc_{fname}",
                            )
                        with col_c2:
                            delim_options = {",": "Comma (,)", ";": "Semicolon (;)", "\t": "Tab (\\t)", "|": "Pipe (|)"}
                            chosen_delim = st.selectbox(
                                f"Delimiter for '{fname}':",
                                options=list(delim_options.keys()),
                                format_func=lambda x: delim_options[x],
                                index=list(delim_options.keys()).index(det_delim) if det_delim in delim_options else 0,
                                key=f"delim_{fname}",
                            )

                        ds = read_csv_dataset(up_file, filename=fname, encoding=chosen_enc, delimiter=chosen_delim)
                        all_loaded.append(ds)
                        st.write(f"**CSV Table** — **{ds.row_count:,} rows**, {ds.column_count} columns")
                        if ds.warnings:
                            for w in ds.warnings:
                                st.warning(w)
                        if ds.errors:
                            for e in ds.errors:
                                st.error(e)
                        if not ds.df.empty:
                            st.dataframe(ds.df.head(3), use_container_width=True)
                    except Exception as ex:
                        st.error(f"Error parsing CSV file {fname}: {str(ex)}")

        st.session_state.loaded_datasets = all_loaded
        total_incoming_rows = sum(d.row_count for d in all_loaded)

        st.markdown("---")
        st.markdown("### 🚀 Processing & Consolidation Controls")

        col_mode1, col_mode2 = st.columns([1, 1])
        with col_mode1:
            master_mode_choice = st.radio(
                "Consolidation Mode:",
                options=["fresh", "merge"],
                format_func=lambda x: {
                    "fresh": "Create New Master from this upload (Replaces existing master on update)",
                    "merge": f"Merge with existing Master.xlsx on disk ({master_summary['row_count']} existing rows)",
                }[x],
                index=0,
                key="master_mode_radio",
            )
            st.session_state.master_mode = master_mode_choice

        with col_mode2:
            st.info(
                f"**Total Incoming Records:** **{total_incoming_rows:,}** rows across {len(all_loaded)} source(s).\n\n"
                f"**Master Mode:** {'Starting fresh master' if master_mode_choice == 'fresh' else 'Merging with disk master'}"
            )

        # Immediate 1-Click Auto-Consolidate Button
        if st.button(f"⚡ Auto-Consolidate & Clean All Records ({total_incoming_rows:,} rows)", type="primary", use_container_width=True):
            with st.spinner("Aligning schemas, verifying unique records, and generating Cleaned Master..."):
                wf: ConsolidationWorkflow = st.session_state.workflow
                wf.set_datasets(all_loaded)
                include_m = (master_mode_choice == "merge" and manager.exists())
                wf.build_consolidated_staging(include_existing_master=include_m)
                # Run exact duplicate detection with full entire_row comparison to strictly preserve all unique data
                wf.detect_duplicates(comparison_mode="entire_row")
                wf.apply_resolutions()
                st.session_state.processing_done = True

            st.success(f"✅ Cleaned Master successfully prepared with **{len(wf.cleaned_df):,} records**!")

        # If processed, show summary metrics & direct download buttons right here!
        wf: ConsolidationWorkflow = st.session_state.workflow
        if not wf.cleaned_df.empty:
            st.markdown("### 📊 Quick Reconciliation & Instant Downloads")
            q_c1, q_c2, q_c3 = st.columns(3)
            with q_c1:
                st.markdown(
                    f'<div class="metric-card"><div class="metric-value">{total_incoming_rows:,}</div><div class="metric-label">Incoming Rows</div></div>',
                    unsafe_allow_html=True,
                )
            with q_c2:
                st.markdown(
                    f'<div class="metric-card"><div class="metric-value" style="color: #DC2626;">-{wf.processing_summary.get("confirmed_duplicates_removed", 0)}</div><div class="metric-label">Duplicates Removed</div></div>',
                    unsafe_allow_html=True,
                )
            with q_c3:
                st.markdown(
                    f'<div class="metric-card"><div class="metric-value" style="color: #059669;">{len(wf.cleaned_df):,}</div><div class="metric-label">Cleaned Master Rows</div></div>',
                    unsafe_allow_html=True,
                )

            # Instant download buttons
            dl_col1, dl_col2, dl_col3 = st.columns(3)
            t_str = datetime.now().strftime("%Y%m%d_%H%M%S")

            with dl_col1:
                excel_buf = io.BytesIO()
                write_master_excel_workbook(
                    filepath=excel_buf,
                    cleaned_master_df=wf.cleaned_df,
                    duplicate_report_df=wf.get_duplicate_report_dataframe(),
                    processing_summary_df=wf.get_summary_dataframe(),
                    review_required_df=wf.review_df,
                )
                st.download_button(
                    label=f"⬇️ Download Cleaned Excel ({len(wf.cleaned_df):,} rows)",
                    data=excel_buf.getvalue(),
                    file_name=f"Master_Cleaned_{t_str}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    type="primary",
                    use_container_width=True,
                )

            with dl_col2:
                csv_bytes = export_dataframe_to_csv(wf.cleaned_df, delimiter=",").encode("utf-8")
                st.download_button(
                    label=f"⬇️ Download CSV ({len(wf.cleaned_df):,} rows)",
                    data=csv_bytes,
                    file_name=f"Master_Cleaned_{t_str}.csv",
                    mime="text/csv",
                    use_container_width=True,
                )

            with dl_col3:
                if st.button("💾 Save to Local Master.xlsx", type="secondary", use_container_width=True):
                    ok, msg, b_path = wf.commit_to_master()
                    if ok:
                        st.success(f"Saved to Master.xlsx on disk! {f'(Backup: {b_path.name})' if b_path else ''}")
                        st.rerun()
                    else:
                        st.error(f"Failed to save: {msg}")

    else:
        st.info("Please upload one or more Excel or CSV files above to begin.")

# -------------------------------------------------------------
# TAB 2: SCHEMA ALIGNMENT & COLUMN MAPPING
# -------------------------------------------------------------
with tab_schema:
    st.subheader("Column Mapping & Schema Alignment")
    st.write("Ensure columns from different spreadsheets are correctly aligned to canonical master headers.")

    wf: ConsolidationWorkflow = st.session_state.workflow

    if not wf.datasets and not st.session_state.loaded_datasets:
        st.warning("No files loaded yet. Please upload files in Tab 1 first.")
    else:
        if not wf.datasets and st.session_state.loaded_datasets:
            wf.set_datasets(st.session_state.loaded_datasets)

        st.markdown("#### Canonical Target Master Schema")
        canonical_cols = wf.schema_mapper.target_columns
        st.write(f"Total Canonical Columns: **{len(canonical_cols)}**")
        st.caption(", ".join(canonical_cols))

        st.markdown("---")
        st.markdown("#### Dataset Column Mappings")

        for ds in wf.datasets:
            ds_id = f"{ds.source_filename}::{ds.sheet_name}"
            mapping = wf.schema_mapper.mappings.get(ds_id, {})
            ambiguities = wf.schema_mapper.ambiguities.get(ds_id, {})

            with st.expander(f"Mapping for: {ds.source_filename} [{ds.sheet_name}]", expanded=True):
                if ambiguities:
                    st.warning(f"⚠️ Ambiguous column candidates detected in this dataset. Please verify selections below:")
                    for amb_col, candidates in ambiguities.items():
                        cand_str = ", ".join(f"'{c[0]}' ({round(c[1], 1)}% match)" for c in candidates)
                        st.write(f"- Source Column **`{amb_col}`** could match: {cand_str}")

                cols_grid = st.columns(3)
                for idx, src_col in enumerate(ds.columns):
                    col_target = mapping.get(src_col, src_col)
                    with cols_grid[idx % 3]:
                        options = list(dict.fromkeys(canonical_cols + [src_col]))
                        current_idx = options.index(col_target) if col_target in options else 0

                        new_target = st.selectbox(
                            f"`{src_col}` maps to:",
                            options=options,
                            index=current_idx,
                            key=f"map_{ds_id}_{src_col}",
                        )
                        if new_target != col_target:
                            wf.apply_column_mapping_override(ds_id, src_col, new_target)

        # Build Staging preview
        inc_m = (st.session_state.master_mode == "merge" and manager.exists())
        staging_df = wf.build_consolidated_staging(include_existing_master=inc_m)

        st.markdown("---")
        st.markdown(f"#### Consolidated Staging Preview ({len(staging_df):,} rows, {len(staging_df.columns)} columns)")
        display_cols = [c for c in staging_df.columns if c not in PROVENANCE_COLS]
        st.dataframe(staging_df[display_cols].head(10), use_container_width=True)

# -------------------------------------------------------------
# TAB 3: DUPLICATE DETECTION & REVIEW
# -------------------------------------------------------------
with tab_dup:
    st.subheader("Duplicate Detection and Resolution")
    st.write("Detect exact and probable duplicates across files and worksheets with zero false positives on blanks.")

    wf: ConsolidationWorkflow = st.session_state.workflow

    if wf.staging_df.empty:
        if st.session_state.loaded_datasets:
            inc_m = (st.session_state.master_mode == "merge" and manager.exists())
            wf.set_datasets(st.session_state.loaded_datasets)
            wf.build_consolidated_staging(include_existing_master=inc_m)

    if wf.staging_df.empty:
        st.warning("Please upload files in Tab 1 first.")
    else:
        st.markdown("#### 1. Configure Duplicate Detection")
        col_d1, col_d2 = st.columns([1, 1])

        data_columns = [c for c in wf.staging_df.columns if c not in PROVENANCE_COLS]

        with col_d1:
            comp_mode = st.radio(
                "Comparison Mode for Exact Matching:",
                options=["entire_row", "selected_columns", "common_columns"],
                format_func=lambda x: {
                    "entire_row": "Entire Row (Recommended — Compares all applicable fields; safest)",
                    "selected_columns": "Selected Columns Only (e.g., ID, Email, Phone)",
                    "common_columns": "Common Shared Columns",
                }[x],
            )

            selected_cols = []
            if comp_mode == "selected_columns":
                selected_cols = st.multiselect(
                    "Choose fields to compare for exact duplicates:",
                    options=data_columns,
                    default=[c for c in data_columns if any(k in c.lower() for k in ["id", "email", "phone", "name", "company"])][:2] or data_columns[:1],
                )

                # Low-cardinality warning check
                for sc in selected_cols:
                    if sc in wf.staging_df.columns:
                        n_uniq = wf.staging_df[sc].nunique()
                        if n_uniq <= 10 and len(wf.staging_df) > 50:
                            st.warning(f"⚠️ Column `{sc}` has only {n_uniq} unique values across {len(wf.staging_df)} rows. Differing records are automatically protected from accidental deletion.")

        with col_d2:
            enable_fuzzy = st.checkbox("Enable Probable (Fuzzy) Duplicate Detection", value=False)
            fuzzy_cols = []
            fuzzy_thresh = DEFAULT_FUZZY_THRESHOLD

            if enable_fuzzy:
                fuzzy_cols = st.multiselect(
                    "Choose text fields for fuzzy similarity matching:",
                    options=data_columns,
                    default=[c for c in data_columns if any(k in c.lower() for k in ["name", "company", "business", "address"])][:2] or data_columns[:1],
                )
                fuzzy_thresh = st.slider("Fuzzy Similarity Threshold (%):", min_value=60, max_value=98, value=int(DEFAULT_FUZZY_THRESHOLD), step=1)

        if st.button("Run Duplicate Detection 🔍", type="primary", use_container_width=True):
            with st.spinner("Analyzing records for exact and probable duplicates..."):
                exact_g, prob_g = wf.detect_duplicates(
                    comparison_mode=comp_mode,
                    selected_columns=selected_cols,
                    common_columns=data_columns,
                    enable_fuzzy=enable_fuzzy,
                    fuzzy_columns=fuzzy_cols,
                    fuzzy_threshold=float(fuzzy_thresh),
                )
            st.session_state.processing_done = False

        # Display Detection Results
        exact_groups = wf.exact_duplicate_groups
        probable_groups = wf.probable_duplicate_groups

        col_m1, col_m2 = st.columns(2)
        with col_m1:
            st.metric("Exact Duplicate Groups Found", len(exact_groups))
        with col_m2:
            st.metric("Probable Duplicate Groups Found", len(probable_groups))

        # Duplicate Review & Resolution
        all_groups = exact_groups + probable_groups
        if all_groups:
            st.markdown("---")
            st.markdown("#### 2. Duplicate Resolution Decisions")

            # Quick Bulk Actions
            col_b1, col_b2, col_b3, col_b4 = st.columns(4)
            with col_b1:
                if st.button("Keep First for All Exact"):
                    for g in exact_groups:
                        g.resolution = "keep_first"
                    st.rerun()
            with col_b2:
                if st.button("Keep Most Complete for All"):
                    for g in all_groups:
                        g.resolution = "keep_most_populated"
                    st.rerun()
            with col_b3:
                if st.button("Merge Complementary for All"):
                    for g in all_groups:
                        g.resolution = "merge_complementary"
                    st.rerun()
            with col_b4:
                if st.button("Keep Both for All Probable"):
                    for g in probable_groups:
                        g.resolution = "keep_both"
                    st.rerun()

            # Individual Group Reviews
            for g in all_groups:
                type_label = "🔴 Exact Duplicate" if g.match_type == "exact" else f"🟡 Probable Duplicate ({g.confidence}% confidence)"
                with st.expander(f"Group #{g.group_id}: {type_label} — {len(g.row_indices)} records", expanded=False):
                    st.write(f"**Explanation:** {g.explanation}")
                    if g.matching_fields:
                        st.write(f"**Matching Fields:** {', '.join(g.matching_fields)}")
                    if g.differing_fields:
                        st.write(f"**Differing Fields:** {', '.join(g.differing_fields)}")

                    # Group rows preview
                    group_df = wf.staging_df.loc[g.row_indices].copy()
                    display_grp = group_df[[c for c in group_df.columns if c not in PROVENANCE_COLS] + ["_source_file", "_source_row"]]
                    st.dataframe(display_grp, use_container_width=True)

                    res_options = [
                        "keep_first",
                        "keep_last",
                        "keep_most_populated",
                        "merge_complementary",
                        "keep_both",
                        "manual_select",
                    ]
                    res_labels = {
                        "keep_first": "Keep First Occurrence",
                        "keep_last": "Keep Last Occurrence",
                        "keep_most_populated": "Keep Most Populated Row",
                        "merge_complementary": "Merge Complementary Information (Fill blanks)",
                        "keep_both": "Keep Both Records (Not a Duplicate)",
                        "manual_select": "Manually Select Preferred Row",
                    }

                    curr_res_idx = res_options.index(g.resolution) if g.resolution in res_options else 0
                    g.resolution = st.selectbox(
                        f"Resolution for Group #{g.group_id}:",
                        options=res_options,
                        format_func=lambda x: res_labels[x],
                        index=curr_res_idx,
                        key=f"res_{g.group_id}",
                    )

                    if g.resolution == "manual_select":
                        row_choices = g.row_indices
                        g.selected_row_index = st.selectbox(
                            f"Select preferred row for Group #{g.group_id}:",
                            options=row_choices,
                            format_func=lambda idx: f"Row {idx} (from {wf.staging_df.at[idx, '_source_file']})",
                            key=f"man_{g.group_id}",
                        )

                    # Show conflicts if any
                    if g.conflicts:
                        st.warning(f"Conflicting non-empty values detected in {len(g.conflicts)} field(s):")
                        for fld, c_vals in g.conflicts.items():
                            st.write(f"- Field **`{fld}`**: {', '.join(str(v) for v in c_vals)}")

        else:
            st.success("🎉 All staged records are verified unique! Zero duplicate clusters detected.")

# -------------------------------------------------------------
# TAB 4: CLEAN & RECONCILE
# -------------------------------------------------------------
with tab_clean:
    st.subheader("Apply Resolutions & Finalize Cleaned Dataset")
    st.write("Review row count impact, finalize deduplicated records, and safely update `Master.xlsx`.")

    wf: ConsolidationWorkflow = st.session_state.workflow

    if wf.staging_df.empty:
        if st.session_state.loaded_datasets:
            inc_m = (st.session_state.master_mode == "merge" and manager.exists())
            wf.set_datasets(st.session_state.loaded_datasets)
            wf.build_consolidated_staging(include_existing_master=inc_m)

    if wf.staging_df.empty:
        st.warning("Please upload spreadsheet files in Tab 1 first.")
    else:
        col_apply1, col_apply2 = st.columns([2, 1])
        with col_apply1:
            if st.button("Apply Resolutions & Prepare Cleaned Dataset ⚡", type="primary", use_container_width=True):
                with st.spinner("Applying duplicate resolution and complementary merges..."):
                    wf.apply_resolutions()
                    st.session_state.processing_done = True
                st.success("Cleaned master dataset prepared successfully!")

        if wf.cleaned_df.empty and not wf.staging_df.empty:
            # Auto-prepare cleaned dataset so user never sees empty screen
            wf.apply_resolutions()
            st.session_state.processing_done = True

        if not wf.cleaned_df.empty:
            summary = wf.processing_summary

            st.markdown("### Before-and-After Processing Summary")
            stat_c1, stat_c2, stat_c3, stat_c4, stat_c5 = st.columns(5)
            with stat_c1:
                st.markdown(
                    f'<div class="metric-card"><div class="metric-value">{summary.get("existing_master_rows", 0):,}</div><div class="metric-label">Original Master</div></div>',
                    unsafe_allow_html=True,
                )
            with stat_c2:
                st.markdown(
                    f'<div class="metric-card"><div class="metric-value">{summary.get("incoming_rows_read", 0):,}</div><div class="metric-label">Incoming Rows</div></div>',
                    unsafe_allow_html=True,
                )
            with stat_c3:
                st.markdown(
                    f'<div class="metric-card"><div class="metric-value" style="color: #DC2626;">-{summary.get("confirmed_duplicates_removed", 0):,}</div><div class="metric-label">Duplicates Removed</div></div>',
                    unsafe_allow_html=True,
                )
            with stat_c4:
                st.markdown(
                    f'<div class="metric-card"><div class="metric-value" style="color: #059669;">+{summary.get("unique_records_added", 0):,}</div><div class="metric-label">Unique Added</div></div>',
                    unsafe_allow_html=True,
                )
            with stat_c5:
                st.markdown(
                    f'<div class="metric-card"><div class="metric-value">{summary.get("final_master_row_count", 0):,}</div><div class="metric-label">Final Master Rows</div></div>',
                    unsafe_allow_html=True,
                )

            st.markdown("---")
            st.markdown(f"#### Cleaned Master Dataset Preview ({len(wf.cleaned_df):,} rows)")
            clean_display = [c for c in wf.cleaned_df.columns if c not in PROVENANCE_COLS]
            st.dataframe(wf.cleaned_df[clean_display].head(15), use_container_width=True)

            if not wf.review_df.empty:
                st.markdown("#### Records Awaiting Review / Uncertain")
                st.warning(f"{len(wf.review_df)} record(s) flagged for review.")
                st.dataframe(wf.review_df[[c for c in wf.review_df.columns if c not in PROVENANCE_COLS]], use_container_width=True)

            # Update Master Action
            st.markdown("---")
            st.markdown("### Save Options")
            col_save1, col_save2 = st.columns(2)

            with col_save1:
                st.write("**Option A: Update Local Master.xlsx**")
                st.caption(f"Safely saves the {len(wf.cleaned_df):,} cleaned rows to `Master.xlsx` on disk with an automatic recoverable backup.")
                if st.button("💾 Update Persistent Master.xlsx", type="primary", use_container_width=True):
                    success, msg, backup = wf.commit_to_master()
                    if success:
                        st.session_state.update_success_msg = f"Master workbook updated successfully! {f'(Backup created: {backup.name})' if backup else ''}"
                        st.success(st.session_state.update_success_msg)
                        st.rerun()
                    else:
                        st.error(f"Failed to update master: {msg}")

            with col_save2:
                st.write("**Option B: Download Only**")
                st.caption("Generate and export the cleaned master without modifying the local `Master.xlsx` on disk.")
                st.info("Head to Tab 5 (Export Reports) to download the generated workbook.")

# -------------------------------------------------------------
# TAB 5: EXPORT & DOWNLOADS
# -------------------------------------------------------------
with tab_export:
    st.subheader("Download Consolidated Reports and Workbooks")
    st.write("Export the cleaned dataset with complete audit logs and processing reports.")

    wf: ConsolidationWorkflow = st.session_state.workflow

    # Ensure export_df reflects the current active upload
    if wf.cleaned_df.empty and st.session_state.loaded_datasets:
        inc_m = (st.session_state.master_mode == "merge" and manager.exists())
        wf.set_datasets(st.session_state.loaded_datasets)
        wf.build_consolidated_staging(include_existing_master=inc_m)
        wf.detect_duplicates(comparison_mode="entire_row")
        wf.apply_resolutions()

    export_df = wf.cleaned_df if not wf.cleaned_df.empty else manager.load_master()

    if export_df is None or export_df.empty:
        st.warning("No dataset available to export. Please upload files in Tab 1 or initialize a master workbook.")
    else:
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        excel_filename = f"Master_Cleaned_{timestamp_str}.xlsx"

        st.markdown(
            f"""
            <div class="banner-box">
                <strong>Active Export Dataset:</strong> <strong>{len(export_df):,} records</strong> | <strong>{len([c for c in export_df.columns if c not in PROVENANCE_COLS])} columns</strong><br/>
                <small style="color: #4B5563;">Generated from current consolidation workflow.</small>
            </div>
            """,
            unsafe_allow_html=True,
        )

        col_exp1, col_exp2 = st.columns(2)

        # Primary Excel Export
        with col_exp1:
            st.markdown("### 📘 Primary Output: Excel Workbook (.xlsx)")
            st.write("Complete workbook formatted with Openpyxl containing all 5 required worksheets:")
            st.markdown(
                """
                1. **`Cleaned_Master`**: Consolidated deduplicated dataset.
                2. **`Duplicate_Report`**: Duplicate groups, matching fields, and resolution actions.
                3. **`Processing_Summary`**: Audit metrics and row count reconciliation.
                4. **`Review_Required`**: Items requiring manual inspection or conflicts.
                5. **`Source_Trace`**: Provenance mapping back to original source files and row numbers.
                """
            )

            # Generate workbook in memory
            excel_buffer = io.BytesIO()
            write_master_excel_workbook(
                filepath=excel_buffer,
                cleaned_master_df=export_df,
                duplicate_report_df=wf.get_duplicate_report_dataframe() if not wf.cleaned_df.empty else None,
                processing_summary_df=wf.get_summary_dataframe() if not wf.cleaned_df.empty else None,
                review_required_df=wf.review_df if not wf.cleaned_df.empty else None,
            )
            excel_bytes = excel_buffer.getvalue()

            st.download_button(
                label=f"⬇️ Download {excel_filename} ({len(export_df):,} rows)",
                data=excel_bytes,
                file_name=excel_filename,
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                type="primary",
                use_container_width=True,
            )

        # Secondary CSV Export
        with col_exp2:
            st.markdown("### 📄 Optional Output: Flat CSV (.csv)")
            st.write("Cleaned master dataset exported as a single flat table with UTF-8 encoding.")
            csv_delim = st.selectbox("CSV Delimiter:", options=[",", ";", "\t", "|"], format_func=lambda x: {",": "Comma (,)", ";": "Semicolon (;)", "\t": "Tab (\\t)", "|": "Pipe (|)"}.get(x, x))
            csv_data = export_dataframe_to_csv(export_df, delimiter=csv_delim, exclude_provenance=True)

            csv_filename = f"Master_Cleaned_{timestamp_str}.csv"
            st.download_button(
                label=f"⬇️ Download Cleaned CSV ({len(export_df):,} rows)",
                data=csv_data.encode("utf-8"),
                file_name=csv_filename,
                mime="text/csv",
                use_container_width=True,
            )
            st.caption("Note: CSV exports a single flat table and does not preserve multiple sheets or cell formatting.")

# -------------------------------------------------------------
# TAB 6: MASTER FILE MANAGEMENT
# -------------------------------------------------------------
with tab_master:
    st.subheader("Master File Persistence & Backup Recovery")
    st.write("Manage the local `Master.xlsx` file, view metadata, restore from backups, or import an existing master.")

    summary = manager.get_summary()

    col_m_info1, col_m_info2 = st.columns([1, 1])
    with col_m_info1:
        st.markdown("#### Current Master Status")
        st.write(f"- **Exists:** {'Yes ✅' if summary['exists'] else 'No ❌'}")
        st.write(f"- **File Path:** `{summary['path']}`")
        st.write(f"- **Row Count:** **{summary['row_count']:,}**")
        st.write(f"- **Column Count:** {summary['column_count']}")
        st.write(f"- **File Size:** {summary['file_size_kb']} KB")
        st.write(f"- **Last Modified:** {summary['last_modified'] or 'Never'}")

        if summary["exists"]:
            master_data = manager.load_master()
            if master_data is not None:
                excel_buf = io.BytesIO()
                write_master_excel_workbook(excel_buf, master_data)
                st.download_button(
                    f"⬇️ Download Current Master.xlsx ({summary['row_count']:,} rows)",
                    data=excel_buf.getvalue(),
                    file_name="Master.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    use_container_width=True,
                )

    with col_m_info2:
        st.markdown("#### Upload Existing Master.xlsx")
        st.caption("Upload an existing Master.xlsx when moving the application to another computer.")
        upload_master = st.file_uploader("Select Master.xlsx to import:", type=["xlsx"], key="custom_master_upload")
        if upload_master is not None:
            if st.button("Import & Replace Local Master", type="primary"):
                ok, msg = manager.upload_custom_master(upload_master)
                if ok:
                    st.success(msg)
                    st.rerun()
                else:
                    st.error(msg)

    st.markdown("---")
    st.markdown("#### Backup & Recovery History")
    backups = manager.list_backups()

    if backups:
        for b in backups[:10]:
            col_b_row1, col_b_row2, col_b_row3 = st.columns([3, 1, 1])
            with col_b_row1:
                st.write(f"📁 **{b['filename']}** ({b['size_kb']} KB)")
                st.caption(f"Created: {b['created_at']}")
            with col_b_row2:
                with open(b["path"], "rb") as bf:
                    st.download_button(
                        "Download",
                        data=bf.read(),
                        file_name=b["filename"],
                        key=f"dl_{b['filename']}",
                    )
            with col_b_row3:
                if st.button("Restore", key=f"rest_{b['filename']}"):
                    ok, msg = manager.restore_backup(b["filename"])
                    if ok:
                        st.success(msg)
                        st.rerun()
                    else:
                        st.error(msg)
    else:
        st.info("No backups created yet. Backups are automatically generated whenever Master.xlsx is updated.")

    st.markdown("---")
    st.markdown("#### Danger Zone: Reset Master")
    st.caption("Resets the master workbook after creating a safety backup.")
    if st.button("⚠️ Reset Master Workbook", type="secondary"):
        ok, msg = manager.reset_master()
        if ok:
            st.warning(msg)
            st.rerun()
        else:
            st.error(msg)
