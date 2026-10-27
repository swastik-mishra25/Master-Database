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
                        row_dict[c] = row[c] if c in row else ""
                    row_dict["_source_file"] = row.get("_source_file", "Master.xlsx")
                    row_dict["_source_sheet"] = row.get("_source_sheet", "Master")
                    row_dict["_source_row"] = row.get("_source_row", idx + 1)
                    row_dict["_import_id"] = row.get("_import_id", "EXISTING_MASTER")
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
                    row_dict[tgt_c] = val

                row_dict["_source_file"] = ds.source_filename
                row_dict["_source_sheet"] = ds.sheet_name
                row_dict["_source_row"] = r_idx + 1
                row_dict["_import_id"] = f"{ds.source_filename}_{import_timestamp}"
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
        """Calculate metrics for processing summary."""
        existing_master_count = 0
        if self.master_manager.exists():
            m = self.master_manager.load_master()
            existing_master_count = len(m) if m is not None else 0

        incoming_rows = sum(ds.row_count for ds in self.datasets)
        total_staged = len(self.staging_df)

        exact_dups_count = sum(len(g.row_indices) - 1 for g in self.exact_duplicate_groups if g.resolution != "keep_both")
        probable_dups_count = sum(len(g.row_indices) - 1 for g in self.probable_duplicate_groups if g.resolution != "keep_both")
        total_removed = exact_dups_count + probable_dups_count

        final_rows = len(self.cleaned_df)
        unique_added = max(0, final_rows - existing_master_count)

        self.processing_summary = {
            "uploaded_files": [ds.source_filename for ds in self.datasets],
            "worksheets_processed": [f"{ds.source_filename} [{ds.sheet_name}]" for ds in self.datasets],
            "incoming_rows_read": incoming_rows,
            "existing_master_rows": existing_master_count,
            "total_staged_rows": total_staged,
            "exact_duplicate_groups": len(self.exact_duplicate_groups),
            "probable_duplicate_groups": len(self.probable_duplicate_groups),
            "confirmed_duplicates_removed": total_removed,
            "records_requiring_review": len(self.review_df),
            "unique_records_added": unique_added,
            "final_master_row_count": final_rows,
            "warnings_count": len(self.warnings),
            "errors_count": len(self.errors),
        }

    def get_summary_dataframe(self) -> pd.DataFrame:
        """Format processing summary into a clean two-column DataFrame for Excel export."""
        s = self.processing_summary
        metrics = [
            ("Uploaded Files", ", ".join(s.get("uploaded_files", []))),
            ("Worksheets Processed", ", ".join(s.get("worksheets_processed", []))),
            ("Incoming Rows Read", s.get("incoming_rows_read", 0)),
            ("Existing Master Rows", s.get("existing_master_rows", 0)),
            ("Total Staged Records", s.get("total_staged_rows", 0)),
            ("Exact Duplicate Groups Found", s.get("exact_duplicate_groups", 0)),
            ("Probable Duplicate Groups Found", s.get("probable_duplicate_groups", 0)),
            ("Confirmed Duplicates Removed", s.get("confirmed_duplicates_removed", 0)),
            ("Records Requiring Review", s.get("records_requiring_review", 0)),
            ("Unique Records Added", s.get("unique_records_added", 0)),
            ("Final Consolidated Master Row Count", s.get("final_master_row_count", 0)),
            ("Validation Warnings", len(self.warnings)),
            ("Validation Errors", len(self.errors)),
        ]
        return pd.DataFrame(metrics, columns=["Metric", "Value"])

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
        }

        success, msg, backup = self.master_manager.save_master(
            df=self.cleaned_df,
            create_backup=True,
            extra_sheets=extra_sheets,
        )
        return success, msg, backup
