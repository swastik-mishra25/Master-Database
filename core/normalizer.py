"""
Safe value normalization for duplicate comparison without altering source data.
"""
import re
from datetime import datetime, date
from typing import Any, Optional
import pandas as pd
from dateutil import parser as date_parser
from .config import DEFAULT_BLANK_PLACEHOLDERS

# Provenance column names
PROVENANCE_COLS = ["_source_file", "_source_sheet", "_source_row", "_import_id"]


def is_blank(val: Any) -> bool:
    """
    Check if a value is null, empty string, or matches standard blank placeholders.
    Missing/blank values MUST NOT be treated as matching identifiers.
    """
    if val is None:
        return True
    if isinstance(val, (float, int)) and pd.isna(val):
        return True
    s = str(val).strip().lower()
    return s in DEFAULT_BLANK_PLACEHOLDERS


def normalize_value_for_comparison(val: Any) -> str:
    """
    Normalize a single cell value purely for duplicate comparison:
    - Return empty string if blank placeholder
    - Trim leading/trailing whitespace
    - Condense multiple whitespace characters to a single space
    - Lowercase text
    - Normalize standard date formats if unambiguous
    - Maintain leading zeros and text identifiers
    """
    if is_blank(val):
        return ""

    # Check for date / datetime
    if isinstance(val, (datetime, date)):
        return val.strftime("%Y-%m-%d")

    val_str = str(val).strip()

    # Condense consecutive whitespaces
    val_str = re.sub(r"\s+", " ", val_str)

    # Check if it looks like a clean date (e.g., YYYY-MM-DD or MM/DD/YYYY)
    if len(val_str) >= 8 and len(val_str) <= 30:
        # Check if contains year-like digits
        if re.search(r"\d{4}", val_str):
            try:
                # Only parse if it looks like a date string with typical separators
                if any(sep in val_str for sep in ["-", "/", "."]):
                    parsed = date_parser.parse(val_str, fuzzy=False)
                    return parsed.strftime("%Y-%m-%d")
            except (ValueError, OverflowError):
                pass

    return val_str.lower()


def create_normalized_dataframe(df: pd.DataFrame, columns_to_normalize: Optional[list] = None) -> pd.DataFrame:
    """
    Create a shadow DataFrame where values are normalized for comparison.
    Original DataFrame remains untouched.
    """
    norm_df = pd.DataFrame(index=df.index)
    cols = columns_to_normalize if columns_to_normalize is not None else df.columns

    for col in cols:
        if col in PROVENANCE_COLS:
            continue
        norm_df[col] = df[col].apply(normalize_value_for_comparison)

    return norm_df
