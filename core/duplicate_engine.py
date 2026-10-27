"""
Duplicate detection engine supporting exact and fuzzy/probable matching with safeguards.
"""
import re
from typing import Any, Dict, List, Optional, Set, Tuple
import pandas as pd
from rapidfuzz import fuzz

from .normalizer import (
    PROVENANCE_COLS,
    create_normalized_dataframe,
    is_blank,
    normalize_value_for_comparison,
)
from .schema_mapper import normalize_header


class DuplicateGroup:
    """Represents a set of rows identified as duplicates or probable duplicates."""

    def __init__(
        self,
        group_id: int,
        match_type: str,  # 'exact' or 'probable'
        confidence: float,  # 0.0 - 100.0
        row_indices: List[int],
        matching_fields: List[str],
        differing_fields: List[str],
        explanation: str,
    ):
        self.group_id = group_id
        self.match_type = match_type
        self.confidence = confidence
        self.row_indices = row_indices
        self.matching_fields = matching_fields
        self.differing_fields = differing_fields
        self.explanation = explanation
        # Resolution decision: 'keep_first', 'keep_last', 'keep_most_populated',
        # 'merge_complementary', 'keep_both', 'manual_pick'
        self.resolution: str = "keep_first" if match_type == "exact" else "keep_both"
        self.selected_row_index: Optional[int] = row_indices[0] if row_indices else None
        # Field conflicts for complementary merge: {field: [conflicting_vals]}
        self.conflicts: Dict[str, List[Any]] = {}


def find_exact_duplicates(
    df: pd.DataFrame,
    comparison_mode: str = "entire_row",  # 'entire_row', 'selected_columns', 'common_columns'
    selected_columns: Optional[List[str]] = None,
    common_columns: Optional[List[str]] = None,
) -> Tuple[List[DuplicateGroup], Set[int]]:
    """
    Find exact duplicate rows in a DataFrame.
    Returns (list of DuplicateGroup, set of duplicate row indices).
    """
    data_cols = [c for c in df.columns if c not in PROVENANCE_COLS]
    if not data_cols:
        return [], set()

    if comparison_mode == "selected_columns" and selected_columns:
        compare_cols = [c for c in selected_columns if c in data_cols]
    elif comparison_mode == "common_columns" and common_columns:
        compare_cols = [c for c in common_columns if c in data_cols]
    else:  # 'entire_row'
        compare_cols = data_cols

    if not compare_cols:
        compare_cols = data_cols

    norm_df = create_normalized_dataframe(df, compare_cols)

    # Group by comparison tuple
    groups_dict: Dict[Tuple[str, ...], List[int]] = {}
    for idx, row in norm_df.iterrows():
        # Safeguard 1: check if all comparison fields in this row are blank
        all_blank = all(str(row[c]) == "" for c in compare_cols)
        if all_blank:
            # Rows where all comparison fields are blank MUST NOT be treated as duplicates!
            continue

        # Safeguard 2: For selected columns, require at least one non-empty identifier value
        if comparison_mode == "selected_columns":
            # If all selected columns in this row are empty, it cannot be matched
            if all(str(row[c]).strip() == "" for c in compare_cols):
                continue

        key = tuple(str(row[c]) for c in compare_cols)
        if key not in groups_dict:
            groups_dict[key] = []
        groups_dict[key].append(idx)

    duplicate_groups: List[DuplicateGroup] = []
    duplicate_indices: Set[int] = set()
    group_id_counter = 1

    # Common identifying keyword tokens
    identifier_keywords = {"name", "company", "id", "email", "phone", "title", "code", "ssn", "ein", "account"}

    for key, indices in groups_dict.items():
        if len(indices) > 1:
            # Compute differing fields across the original data_cols (outside compare_cols or formatting diffs)
            differing: List[str] = []
            for c in data_cols:
                distinct_vals = {str(df.at[i, c]).strip() for i in indices if not is_blank(df.at[i, c])}
                if len(distinct_vals) > 1:
                    differing.append(c)

            matching = [c for c in compare_cols if c not in differing]

            # Safeguard 3: If differing fields include major identifiers (e.g. different Company or Person Names),
            # or if group is unusually large (e.g. > 5 rows from low-cardinality match), DO NOT auto-delete!
            has_conflicting_identifiers = any(
                any(k in normalize_header(d_col) for k in identifier_keywords)
                for d_col in differing
            )
            is_generic_cluster = len(indices) > 5 and len(differing) > len(matching)

            explanation = (
                f"Exact match on {len(compare_cols)} field(s): {', '.join(compare_cols[:5])}"
                + ("..." if len(compare_cols) > 5 else "")
            )
            if has_conflicting_identifiers or is_generic_cluster:
                explanation += " [Protected: differing core identifiers detected; flagged for review, not auto-deleted]"

            group = DuplicateGroup(
                group_id=group_id_counter,
                match_type="exact",
                confidence=100.0 if not has_conflicting_identifiers else 70.0,
                row_indices=indices,
                matching_fields=matching,
                differing_fields=differing,
                explanation=explanation,
            )

            # If differing identifiers exist or it's a generic cluster, default to keep_both
            if has_conflicting_identifiers or is_generic_cluster:
                group.resolution = "keep_both"
            else:
                group.resolution = "keep_first"

            # Find field conflicts for merging
            group.conflicts = _detect_conflicts(df, indices, data_cols)

            duplicate_groups.append(group)
            for idx in indices:
                duplicate_indices.add(idx)
            group_id_counter += 1

    return duplicate_groups, duplicate_indices


def find_probable_duplicates(
    df: pd.DataFrame,
    fuzzy_columns: List[str],
    similarity_threshold: float = 85.0,
    excluded_indices: Optional[Set[int]] = None,
    max_candidates_to_compare: int = 2500,
) -> List[DuplicateGroup]:
    """
    Find probable (fuzzy) duplicates among records not already identified as exact duplicates.
    """
    data_cols = [c for c in df.columns if c not in PROVENANCE_COLS]
    valid_fuzzy_cols = [c for c in fuzzy_columns if c in data_cols]
    if not valid_fuzzy_cols:
        return []

    norm_df = create_normalized_dataframe(df, valid_fuzzy_cols)

    candidate_indices = [
        i for i in df.index
        if (excluded_indices is None or i not in excluded_indices)
    ]

    # If dataset is very large, limit pairwise comparisons to prevent UI freezes
    if len(candidate_indices) > max_candidates_to_compare:
        candidate_indices = candidate_indices[:max_candidates_to_compare]

    groups: List[DuplicateGroup] = []
    matched_in_probable: Set[int] = set()
    group_id_counter = 10001

    n = len(candidate_indices)
    for i in range(n):
        idx_a = candidate_indices[i]
        if idx_a in matched_in_probable:
            continue

        row_a = norm_df.loc[idx_a]
        # Skip if all fuzzy columns are blank for row_a
        if all(row_a[c] == "" for c in valid_fuzzy_cols):
            continue

        current_cluster = [idx_a]
        cluster_confidences: List[float] = []
        cluster_explanations: List[str] = []

        for j in range(i + 1, n):
            idx_b = candidate_indices[j]
            if idx_b in matched_in_probable:
                continue

            row_b = norm_df.loc[idx_b]
            if all(row_b[c] == "" for c in valid_fuzzy_cols):
                continue

            # Compare fuzzy columns
            col_scores: List[float] = []
            matched_cols: List[str] = []
            non_empty_comparisons = 0

            for c in valid_fuzzy_cols:
                val_a = row_a[c]
                val_b = row_b[c]

                # If either is blank, do not consider as positive similarity
                if not val_a or not val_b:
                    continue

                non_empty_comparisons += 1
                # Clean punctuation for robust text matching (e.g. 'Corp.' vs 'Corp')
                clean_a = re.sub(r"[^\w\s]", " ", val_a).strip()
                clean_b = re.sub(r"[^\w\s]", " ", val_b).strip()
                score = max(
                    fuzz.token_set_ratio(val_a, val_b),
                    fuzz.token_sort_ratio(clean_a, clean_b),
                    fuzz.token_set_ratio(clean_a, clean_b),
                )
                col_scores.append(score)
                if score >= similarity_threshold:
                    matched_cols.append(f"{c} ({round(score, 1)}%)")

            # Must have at least one meaningful non-empty field comparison
            if non_empty_comparisons == 0 or not col_scores:
                continue

            avg_score = sum(col_scores) / len(col_scores)

            if avg_score >= similarity_threshold and matched_cols:
                current_cluster.append(idx_b)
                cluster_confidences.append(avg_score)
                cluster_explanations.append(
                    f"Row {idx_b} matches on: {', '.join(matched_cols)} [Avg: {round(avg_score, 1)}%]"
                )

        if len(current_cluster) > 1:
            for idx_c in current_cluster:
                matched_in_probable.add(idx_c)

            avg_conf = sum(cluster_confidences) / len(cluster_confidences) if cluster_confidences else similarity_threshold

            differing: List[str] = []
            for c in data_cols:
                distinct_vals = {str(df.at[i, c]).strip() for i in current_cluster if not is_blank(df.at[i, c])}
                if len(distinct_vals) > 1:
                    differing.append(c)

            matching = [c for c in valid_fuzzy_cols if c not in differing]

            group = DuplicateGroup(
                group_id=group_id_counter,
                match_type="probable",
                confidence=round(avg_conf, 1),
                row_indices=current_cluster,
                matching_fields=matching,
                differing_fields=differing,
                explanation="; ".join(cluster_explanations),
            )
            group.conflicts = _detect_conflicts(df, current_cluster, data_cols)

            groups.append(group)
            group_id_counter += 1

    return groups


def _detect_conflicts(df: pd.DataFrame, indices: List[int], data_cols: List[str]) -> Dict[str, List[Any]]:
    """Detect non-empty conflicting values across columns for a group of rows."""
    conflicts: Dict[str, List[Any]] = {}
    for c in data_cols:
        vals = []
        seen_norm = set()
        for i in indices:
            val = df.at[i, c]
            if not is_blank(val):
                norm = normalize_value_for_comparison(val)
                if norm not in seen_norm:
                    seen_norm.add(norm)
                    vals.append(val)
        if len(vals) > 1:
            conflicts[c] = vals
    return conflicts
