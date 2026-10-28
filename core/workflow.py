"""
Orchestration workflow for importing, aligning, deduplicating, and consolidating spreadsheets.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple
import pandas as pd

from .duplicate_engine import (
    DuplicateGroup,
    find_exact_duplicates,
    find_probable_duplicates,
)
from .file_loader import LoadedDataset
from .master_manager import MasterManager
from .normalizer import PROVENANCE_COLS, is_blank
from .resolver import resolve_duplicate_groups
from .schema_mapper import SchemaMapper


class ConsolidationWorkflow:
    """Manages the full end-to-end spreadsheet consolidation lifecycle."""

    def __init__(self, master_manager: Optional[MasterManager] = None):
        self.master_manager = master_manager or MasterManager()
        self.datasets: List[LoadedDataset] = []
        self.schema_mapper = SchemaMapper()
        self.staging_df: pd.DataFrame = pd.DataFrame()
        self.exact_duplicate_groups: List[DuplicateGroup] = []
        self.probable_duplicate_groups: List[DuplicateGroup] = []
        self.cleaned_df: pd.DataFrame = pd.DataFrame()
        self.review_df: pd.DataFrame = pd.DataFrame()
        self.audit_records: List[Dict[str, Any]] = []
        self.processing_summary: Dict[str, Any] = {}
        self.warnings: List[str] = []
        self.errors: List[str] = []

    def set_datasets(self, datasets: List[LoadedDataset]):
        """Register loaded datasets and prepare schema mapper."""
        self.datasets = [ds for ds in datasets if not ds.errors]
        self.warnings = []
        for ds in datasets:
            self.warnings.extend(ds.warnings)
            self.errors.extend(ds.errors)

        # Existing master columns if master exists
        existing_master = self.master_manager.load_master()
        existing_cols = [c for c in existing_master.columns if c not in PROVENANCE_COLS] if existing_master is not None else None

        self.schema_mapper.initialize_target_columns_from_datasets(self.datasets, existing_master_cols=existing_cols)

        # Propose mappings for each dataset
        for ds in self.datasets:
            ds_id = f"{ds.source_filename}::{ds.sheet_name}"
            self.schema_mapper.propose_mappings_for_dataset(ds_id, ds.columns)

    def apply_column_mapping_override(self, dataset_id: str, source_col: str, target_col: str):
        """User manual override for a specific column."""
        self.schema_mapper.set_manual_mapping(dataset_id, source_col, target_col)

    def build_consolidated_staging(self, include_existing_master: bool = True) -> pd.DataFrame:
        """
        Consolidate all datasets (and existing master if present) into a single staging DataFrame.
        """
        consolidated_cols = self.schema_mapper.get_consolidated_columns()
        rows_list: List[Dict[str, Any]] = []

        import_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # 1. Existing master rows
        if include_existing_master and self.master_manager.exists():
            master_df = self.master_manager.load_master()
            if master_df is not None and not master_df.empty:
                for idx, row in master_df.iterrows():
                    row_dict = {}
                    for c in consolidated_cols:
                        row_dict[c] = "" if is_blank(row.get(c, "")) else str(row[c])
                    row_dict["_source_file"] = row.get("_source_file", "Master.xlsx")
                    row_dict["_source_sheet"] = row.get("_source_sheet", "Master")
                    row_dict["_source_row"] = row.get("_source_row", idx + 1)
                    row_dict["_import_id"] = "EXISTING_MASTER"
                    row_dict["_is_master"] = True
                    rows_list.append(row_dict)

        # 2. Incoming datasets
        for ds in self.datasets:
            ds_id = f"{ds.source_filename}::{ds.sheet_name}"
            mapping = self.schema_mapper.mappings.get(ds_id, {})

            for r_idx, row in ds.df.iterrows():
                row_dict = {c: "" for c in consolidated_cols}
                for src_c in ds.columns:
                    tgt_c = mapping.get(src_c, src_c)
                    val = row[src_c]
                    row_dict[tgt_c] = "" if is_blank(val) else str(val)

                row_dict["_source_file"] = ds.source_filename
                row_dict["_source_sheet"] = ds.sheet_name
                row_dict["_source_row"] = r_idx + 1
                row_dict["_import_id"] = f"{ds.source_filename}_{import_timestamp}"
                row_dict["_is_master"] = False
                rows_list.append(row_dict)

        if rows_list:
            all_cols = consolidated_cols + PROVENANCE_COLS
            self.staging_df = pd.DataFrame(rows_list, columns=all_cols)
        else:
            self.staging_df = pd.DataFrame(columns=consolidated_cols + PROVENANCE_COLS)

        return self.staging_df

    def detect_duplicates(
        self,
        comparison_mode: str = "entire_row",
        selected_columns: Optional[List[str]] = None,
        common_columns: Optional[List[str]] = None,
        enable_fuzzy: bool = False,
        fuzzy_columns: Optional[List[str]] = None,
        fuzzy_threshold: float = 85.0,
    ) -> Tuple[List[DuplicateGroup], List[DuplicateGroup]]:
        """
        Run exact and optional probable duplicate detection on the staging DataFrame.
        """
        if self.staging_df.empty:
            self.exact_duplicate_groups = []
            self.probable_duplicate_groups = []
            return [], []

        # Exact duplicate detection
        exact_groups, exact_indices = find_exact_duplicates(
            df=self.staging_df,
            comparison_mode=comparison_mode,
            selected_columns=selected_columns,
            common_columns=common_columns,
        )
        self.exact_duplicate_groups = exact_groups

        # Probable duplicate detection (fuzzy matching)
        if enable_fuzzy and fuzzy_columns:
            probable_groups = find_probable_duplicates(
                df=self.staging_df,
                fuzzy_columns=fuzzy_columns,
                similarity_threshold=fuzzy_threshold,
                excluded_indices=exact_indices,
            )
            self.probable_duplicate_groups = probable_groups
        else:
            self.probable_duplicate_groups = []

        return self.exact_duplicate_groups, self.probable_duplicate_groups

    def apply_resolutions(
        self,
        manual_conflict_resolutions: Optional[Dict[int, Dict[str, Any]]] = None,
    ) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """
        Apply resolutions for exact and probable duplicates and compile report data.
        """
        all_groups = self.exact_duplicate_groups + self.probable_duplicate_groups
        cleaned_df, review_df, audit_records = resolve_duplicate_groups(
            df=self.staging_df,
            duplicate_groups=all_groups,
            manual_conflict_resolutions=manual_conflict_resolutions,
        )

        self.cleaned_df = cleaned_df
        self.review_df = review_df
        self.audit_records = audit_records

        # Compile processing summary metrics
        self._compile_summary()

        return self.cleaned_df, self.review_df

    def _compile_summary(self):
        """Calculate metrics for processing summary according to exact operational results."""
        existing_master_count = 0
        if self.master_manager.exists():
            m = self.master_manager.load_master()
            existing_master_count = len(m) if m is not None else 0

        incoming_rows = sum(ds.row_count for ds in self.datasets)
        valid_evaluated = sum(len(ds.df) for ds in self.datasets if not ds.errors)
        total_staged = len(self.staging_df)

        # Count confirmed duplicates dropped
        confirmed_removed = sum(len(a.get("removed_indices", [])) for a in self.audit_records)

        # Count incoming records that matched an existing master record
        all_groups = self.exact_duplicate_groups + self.probable_duplicate_groups
        existing_matched = 0
        records_merged = 0

        for g in all_groups:
            if g.resolution != "keep_both":
                master_indices = [i for i in g.row_indices if self.staging_df.at[i, "_import_id"] == "EXISTING_MASTER"]
                incoming_indices = [i for i in g.row_indices if self.staging_df.at[i, "_import_id"] != "EXISTING_MASTER"]
                if master_indices and incoming_indices:
                    existing_matched += len(incoming_indices)
                if g.resolution == "merge_complementary":
                    records_merged += 1

        final_rows = len(self.cleaned_df)

        # Genuinely new unique records added from incoming uploads
        if not self.cleaned_df.empty and "_import_id" in self.cleaned_df.columns:
            new_unique_added = int((self.cleaned_df["_import_id"] != "EXISTING_MASTER").sum())
        else:
            new_unique_added = final_rows if not self.master_manager.exists() else 0

        files_selected = len({ds.source_filename for ds in self.datasets})
        files_processed = len({ds.source_filename for ds in self.datasets if not ds.errors})
        failures_warnings = len(self.errors) + len(self.warnings)

        self.processing_summary = {
            "files_selected": files_selected,
            "files_processed": files_processed,
            "worksheets_processed_count": len(self.datasets),
            "uploaded_files": [ds.source_filename for ds in self.datasets],
            "worksheets_processed": [f"{ds.source_filename} [{ds.sheet_name}]" for ds in self.datasets],
            "input_rows_read": incoming_rows,
            "valid_records_evaluated": valid_evaluated,
            "existing_master_rows": existing_master_count,
            "master_rows_before": existing_master_count,
            "total_staged_rows": total_staged,
            "exact_duplicate_groups": len(self.exact_duplicate_groups),
            "probable_duplicate_groups": len(self.probable_duplicate_groups),
            "existing_records_matched": existing_matched,
            "confirmed_duplicates_removed": confirmed_removed,
            "records_updated_or_merged": records_merged,
            "records_requiring_review": len(self.review_df),
            "unique_records_added": new_unique_added,
            "new_unique_records_added": new_unique_added,
            "final_master_row_count": final_rows,
            "master_rows_after": final_rows,
            "warnings_count": len(self.warnings),
            "errors_count": len(self.errors),
            "failures_and_warnings": failures_warnings,
        }

    def get_summary_dataframe(self) -> pd.DataFrame:
        """Format processing summary into a clean two-column DataFrame for Excel export."""
        s = self.processing_summary
        metrics = [
            ("Files Selected", s.get("files_selected", 0)),
            ("Files Successfully Processed", s.get("files_processed", 0)),
            ("Worksheets Processed", s.get("worksheets_processed_count", 0)),
            ("Input Rows Read", s.get("input_rows_read", 0)),
            ("Valid Records Evaluated", s.get("valid_records_evaluated", 0)),
            ("Rows in Master Before Processing", s.get("master_rows_before", 0)),
            ("Existing Records Matched", s.get("existing_records_matched", 0)),
            ("New Unique Records Added", s.get("new_unique_records_added", 0)),
            ("Confirmed Duplicates Removed", s.get("confirmed_duplicates_removed", 0)),
            ("Records Updated or Merged", s.get("records_updated_or_merged", 0)),
            ("Potential Duplicates Awaiting Review", s.get("records_requiring_review", 0)),
            ("Final Consolidated Master Row Count", s.get("final_master_row_count", 0)),
            ("Validation Failures and Warnings", s.get("failures_and_warnings", 0)),
        ]
        return pd.DataFrame(metrics, columns=["Metric", "Value"])

    def get_file_report_dataframe(self) -> pd.DataFrame:
        """Generate a file-level report of ingestion, rows read, contributions, and status."""
        rows = []
        for ds in self.datasets:
            contributed = 0
            if not self.cleaned_df.empty and "_source_file" in self.cleaned_df.columns:
                contributed = int((
                    (self.cleaned_df["_source_file"] == ds.source_filename) &
                    (self.cleaned_df["_source_sheet"] == ds.sheet_name)
                ).sum())

            dups_identified = max(0, ds.row_count - contributed)

            status = "Success"
            if ds.errors:
                status = f"Failed: {'; '.join(ds.errors)}"
            elif ds.warnings:
                status = f"Warning: {'; '.join(ds.warnings)}"

            rows.append({
                "Filename": ds.source_filename,
                "Worksheet": ds.sheet_name,
                "Rows Read": ds.row_count,
                "New Records Contributed": contributed,
                "Duplicates Excluded": dups_identified,
                "Status": status,
            })

        return pd.DataFrame(rows) if rows else pd.DataFrame(
            columns=["Filename", "Worksheet", "Rows Read", "New Records Contributed", "Duplicates Excluded", "Status"]
        )

    def get_newly_added_records_dataframe(self) -> pd.DataFrame:
        """Return DataFrame of genuinely new unique records added in the current session."""
        if self.cleaned_df.empty:
            return pd.DataFrame()
        if "_import_id" in self.cleaned_df.columns:
            new_df = self.cleaned_df[self.cleaned_df["_import_id"] != "EXISTING_MASTER"].copy()
        else:
            new_df = self.cleaned_df.copy()
        display_cols = [c for c in new_df.columns if c not in PROVENANCE_COLS]
        return new_df[display_cols]

    def get_duplicate_report_dataframe(self) -> pd.DataFrame:
        """Format duplicate audit records into a DataFrame for Excel export."""
        rows = []
        for a in self.audit_records:
            rows.append({
                "Group_ID": a["group_id"],
                "Match_Type": a["match_type"],
                "Confidence": f"{a['confidence']}%",
                "Action_Taken": a["action"],
                "Kept_Row_Indices": ", ".join(str(i) for i in a["kept_indices"]),
                "Removed_Row_Indices": ", ".join(str(i) for i in a["removed_indices"]),
                "Explanation": a["explanation"],
                "Conflicting_Fields": ", ".join(a["conflicts"].keys()) if a.get("conflicts") else "None",
            })
        return pd.DataFrame(rows) if rows else pd.DataFrame(
            columns=["Group_ID", "Match_Type", "Confidence", "Action_Taken", "Kept_Row_Indices", "Removed_Row_Indices", "Explanation", "Conflicting_Fields"]
        )

    def commit_to_master(self) -> Tuple[bool, str, Optional[Any]]:
        """Commit the cleaned master dataset to Master.xlsx."""
        if self.cleaned_df.empty and not self.staging_df.empty:
            return False, "Cannot commit empty dataset while staged records exist.", None

        # Build extra report sheets
        extra_sheets = {
            "Duplicate_Report": self.get_duplicate_report_dataframe(),
            "Processing_Summary": self.get_summary_dataframe(),
            "Review_Required": self.review_df,
            "File_Breakdown": self.get_file_report_dataframe(),
        }

        success, msg, backup = self.master_manager.save_master(
            df=self.cleaned_df,
            create_backup=True,
            extra_sheets=extra_sheets,
        )
        return success, msg, backup
