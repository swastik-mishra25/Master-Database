"""
Duplicate resolution and complementary data merging.
"""
from typing import Any, Dict, List, Optional, Set, Tuple
import pandas as pd
from .duplicate_engine import DuplicateGroup
from .normalizer import PROVENANCE_COLS, is_blank, normalize_value_for_comparison


def resolve_duplicate_groups(
    df: pd.DataFrame,
    duplicate_groups: List[DuplicateGroup],
    manual_conflict_resolutions: Optional[Dict[int, Dict[str, Any]]] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, List[Dict[str, Any]]]:
    """
    Apply duplicate resolutions to the DataFrame.
    Returns:
    - cleaned_df: DataFrame with duplicates resolved/removed.
    - review_df: DataFrame of rows still requiring manual review/uncertain.
    - resolution_audit: List of audit records detailing what was done for each group.
    """
    manual_resolutions = manual_conflict_resolutions or {}
    data_cols = [c for c in df.columns if c not in PROVENANCE_COLS]

    cleaned_df = df.copy()
    rows_to_drop: Set[int] = set()
    review_row_indices: Set[int] = set()
    audit_records: List[Dict[str, Any]] = []

    for group in duplicate_groups:
        res = group.resolution
        indices = group.row_indices

        if res == "keep_both":
            # If probable duplicate with keep_both, flag for review
            if group.match_type == "probable":
                for idx in indices:
                    review_row_indices.add(idx)

            audit_records.append({
                "group_id": group.group_id,
                "match_type": group.match_type,
                "confidence": group.confidence,
                "action": "keep_both",
                "kept_indices": indices,
                "removed_indices": [],
                "explanation": group.explanation,
                "conflicts": group.conflicts,
            })
            continue

        # Determine the primary/retained row
        primary_idx = indices[0]
        if res == "keep_first":
            primary_idx = indices[0]
        elif res == "keep_last":
            primary_idx = indices[-1]
        elif res == "keep_most_populated":
            # Count non-blank cells for each row
            counts = {}
            for idx in indices:
                cnt = sum(1 for c in data_cols if not is_blank(cleaned_df.at[idx, c]))
                counts[idx] = cnt
            primary_idx = max(counts, key=counts.get)
        elif res == "manual_pick" or res == "manual_select":
            primary_idx = group.selected_row_index if group.selected_row_index in indices else indices[0]
        elif res == "merge_complementary":
            # Preferred row is selected_row_index or most populated
            if group.selected_row_index and group.selected_row_index in indices:
                primary_idx = group.selected_row_index
            else:
                counts = {}
                for idx in indices:
                    cnt = sum(1 for c in data_cols if not is_blank(cleaned_df.at[idx, c]))
                    counts[idx] = cnt
                primary_idx = max(counts, key=counts.get)

            # Perform complementary merge: fill missing fields in primary_idx from other rows
            group_conflicts = manual_resolutions.get(group.group_id, {})
            for c in data_cols:
                primary_val = cleaned_df.at[primary_idx, c]
                if is_blank(primary_val):
                    # Find first non-blank value in other rows
                    for other_idx in indices:
                        if other_idx == primary_idx:
                            continue
                        other_val = cleaned_df.at[other_idx, c]
                        if not is_blank(other_val):
                            cleaned_df.at[primary_idx, c] = other_val
                            break
                else:
                    # Primary value is non-blank. If manual conflict resolution is set, apply it
                    if c in group_conflicts:
                        cleaned_df.at[primary_idx, c] = group_conflicts[c]

        # Other rows in the group are removed
        other_indices = [i for i in indices if i != primary_idx]
        for rem_idx in other_indices:
            rows_to_drop.add(rem_idx)

        audit_records.append({
            "group_id": group.group_id,
            "match_type": group.match_type,
            "confidence": group.confidence,
            "action": res,
            "kept_indices": [primary_idx],
            "removed_indices": other_indices,
            "explanation": group.explanation,
            "conflicts": group.conflicts,
        })

    # Drop removed rows from cleaned_df
    cleaned_df = cleaned_df.drop(index=list(rows_to_drop)).reset_index(drop=True)

    # Review dataframe
    if review_row_indices:
        review_df = df.loc[list(review_row_indices)].copy()
    else:
        review_df = pd.DataFrame(columns=df.columns)

    return cleaned_df, review_df, audit_records
