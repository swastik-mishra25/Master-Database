"""
Excel and CSV export utilities with Openpyxl formatting, formula injection prevention,
frozen headers, autofilters, and the 5 required report sheets.
"""
import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
import pandas as pd

from .normalizer import PROVENANCE_COLS


def sanitize_for_formula_injection(val: Any) -> Any:
    """
    Prevent formula injection by prefixing formula triggers (=, +, -, @)
    with a single quote if the value is a string.
    """
    if val is None:
        return ""
    val_str = str(val)
    if val_str and val_str[0] in ("=", "+", "-", "@"):
        return "'" + val_str
    return val


def write_master_excel_workbook(
    filepath: Union[str, Path, io.BytesIO],
    cleaned_master_df: pd.DataFrame,
    duplicate_report_df: Optional[pd.DataFrame] = None,
    processing_summary_df: Optional[pd.DataFrame] = None,
    review_required_df: Optional[pd.DataFrame] = None,
    source_trace_df: Optional[pd.DataFrame] = None,
    extra_sheets: Optional[Dict[str, pd.DataFrame]] = None,
) -> None:
    """
    Create a polished multi-sheet Excel workbook with openpyxl.
    Sheets:
    1. Cleaned_Master
    2. Duplicate_Report
    3. Processing_Summary
    4. Review_Required
    5. Source_Trace
    """
    wb = openpyxl.Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    # 1. Cleaned_Master
    # Exclude internal provenance columns from Cleaned_Master display
    display_master_cols = [c for c in cleaned_master_df.columns if c not in PROVENANCE_COLS]
    master_export_df = cleaned_master_df[display_master_cols] if not cleaned_master_df.empty else pd.DataFrame(columns=display_master_cols)
    _add_formatted_sheet(wb, "Cleaned_Master", master_export_df, header_color="1F4E79")

    # 2. Duplicate_Report
    dup_df = duplicate_report_df if duplicate_report_df is not None else pd.DataFrame(
        columns=["Group_ID", "Match_Type", "Confidence", "Action_Taken", "Matching_Fields", "Differences", "Explanation"]
    )
    _add_formatted_sheet(wb, "Duplicate_Report", dup_df, header_color="2F5597", empty_message="No duplicates identified.")

    # 3. Processing_Summary
    summary_df = processing_summary_df if processing_summary_df is not None else pd.DataFrame(
        columns=["Metric", "Value", "Details"]
    )
    _add_formatted_sheet(wb, "Processing_Summary", summary_df, header_color="1E385B")

    # 4. Review_Required
    review_cols = [c for c in review_required_df.columns if c not in PROVENANCE_COLS] if review_required_df is not None and not review_required_df.empty else ["Status", "Record_Reference", "Notes"]
    review_export_df = review_required_df[review_cols] if review_required_df is not None and not review_required_df.empty else pd.DataFrame(columns=review_cols)
    _add_formatted_sheet(wb, "Review_Required", review_export_df, header_color="C00000", empty_message="No records requiring review.")

    # 5. Source_Trace
    if source_trace_df is not None and not source_trace_df.empty:
        trace_df = source_trace_df
    else:
        # Generate source trace from provenance columns if present in cleaned_master_df
        prov_present = [c for c in PROVENANCE_COLS if c in cleaned_master_df.columns]
        if prov_present and not cleaned_master_df.empty:
            trace_cols = ["Master_Row"] + prov_present
            t_df = cleaned_master_df[prov_present].copy()
            t_df.insert(0, "Master_Row", [i + 1 for i in range(len(t_df))])
            trace_df = t_df
        else:
            trace_df = pd.DataFrame(columns=["Master_Row", "Source_File", "Source_Sheet", "Source_Row"])
    _add_formatted_sheet(wb, "Source_Trace", trace_df, header_color="595959", empty_message="No source trace records.")

    # Extra custom sheets if provided
    if extra_sheets:
        for name, sheet_df in extra_sheets.items():
            if name not in wb.sheetnames:
                _add_formatted_sheet(wb, name, sheet_df, header_color="333333")

    wb.save(filepath)
    wb.close()


def _add_formatted_sheet(
    wb: openpyxl.Workbook,
    title: str,
    df: pd.DataFrame,
    header_color: str = "2F5597",
    empty_message: Optional[str] = None,
) -> None:
    """Helper to populate and format an openpyxl worksheet."""
    ws = wb.create_sheet(title=title)

    # Styles
    header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color=header_color, end_color=header_color, fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    regular_font = Font(name="Segoe UI", size=10)
    center_alignment = Alignment(horizontal="center", vertical="center")
    left_alignment = Alignment(horizontal="left", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="E0E0E0"),
        right=Side(style="thin", color="E0E0E0"),
        top=Side(style="thin", color="E0E0E0"),
        bottom=Side(style="thin", color="E0E0E0"),
    )

    # If empty dataframe
    if df.empty:
        cols = list(df.columns) if list(df.columns) else ["Status"]
        ws.append(cols)
        # Format header
        for col_idx in range(1, len(cols) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment

        # Add empty message row
        msg = empty_message or "No data available."
        ws.append([msg] + [""] * (len(cols) - 1))
        msg_cell = ws.cell(row=2, column=1)
        msg_cell.font = Font(name="Segoe UI", size=10, italic=True, color="7F7F7F")
        ws.freeze_panes = "A2"
        ws.column_dimensions["A"].width = max(len(msg) + 5, 25)
        return

    # Write headers
    headers = list(df.columns)
    ws.append(headers)

    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border
    ws.row_dimensions[1].height = 28

    # Write data rows
    for r_idx, row in enumerate(df.itertuples(index=False), start=2):
        row_values = []
        for v in row:
            sanitized = sanitize_for_formula_injection(v)
            row_values.append(sanitized)
        ws.append(row_values)

        ws.row_dimensions[r_idx].height = 20
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=r_idx, column=col_idx)
            cell.font = regular_font
            cell.border = thin_border

            # Keep numeric format if actual number or format as text for identifiers
            val = cell.value
            if isinstance(val, (int, float)):
                cell.alignment = center_alignment
            else:
                cell.alignment = left_alignment
                # Format cell as text format to preserve leading zeroes
                cell.number_format = "@"

    # Freeze header row
    ws.freeze_panes = "A2"

    # Auto-filter
    last_col_letter = get_column_letter(len(headers))
    ws.auto_filter.ref = f"A1:{last_col_letter}{len(df) + 1}"

    # Auto-adjust column widths
    for col_idx, col_name in enumerate(headers, start=1):
        max_len = len(str(col_name))
        for row_idx in range(2, min(len(df) + 2, 100)):  # sample first 100 rows for speed
            val = ws.cell(row=row_idx, column=col_idx).value
            if val is not None:
                max_len = max(max_len, len(str(val)))
        col_letter = get_column_letter(col_idx)
        ws.column_dimensions[col_letter].width = min(max(max_len + 4, 12), 50)


def export_dataframe_to_csv(
    df: pd.DataFrame,
    delimiter: str = ",",
    exclude_provenance: bool = True,
) -> str:
    """Export the cleaned master dataset to a UTF-8 CSV string."""
    cols = [c for c in df.columns if not (exclude_provenance and c in PROVENANCE_COLS)]
    export_df = df[cols] if not df.empty else pd.DataFrame(columns=cols)
    return export_df.to_csv(index=False, sep=delimiter, encoding="utf-8")
