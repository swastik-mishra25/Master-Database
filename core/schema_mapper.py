"""
Schema alignment and column mapping across multiple datasets.
"""
import re
from typing import Dict, List, Optional, Set, Tuple
from rapidfuzz import fuzz

# Common semantic synonyms for tabular headers
SYNONYM_GROUPS = [
    {"name", "company", "company name", "business", "business name", "organization", "org name", "account", "account name", "client", "client name"},
    {"phone", "telephone", "phone number", "contact", "contact number", "mobile", "cell", "tel", "public phone number", "public phone numbers", "public phone"},
    {"email", "email address", "e-mail", "mail", "mail address", "public email", "public business email", "public emails"},
    {"address", "street", "street address", "location", "addr"},
    {"city", "town", "municipality"},
    {"state", "province", "region"},
    {"zip", "zip code", "zipcode", "postal", "postal code", "postcode"},
    {"country", "nation"},
    {"website", "url", "web", "web address", "domain", "company website", "company site", "homepage"},
    {"id", "identifier", "code", "item id", "product id", "customer id", "user id", "record id"},
    {"price", "cost", "amount", "total", "rate"},
    {"date", "created date", "timestamp", "creation date", "time", "check time", "scanned at"},
    {"first name", "firstname", "given name", "forename"},
    {"last name", "lastname", "surname", "family name"},
    {"full name", "contact name", "person name", "employee name"},
    {"notes", "comment", "comments", "description", "details", "source excerpts", "evidence quotes", "evidence basis"},
    {"status", "state status", "condition", "tier", "fit tier", "qualification tier"},
    {"score", "fit score", "potential score", "icp score", "dakini score", "rating"},
    {"industry", "target industry", "categories", "category", "sector"},
    {"operating scale", "scale", "operating scale score"},
    {"service fit", "service fit score", "workflow fit"},
    {"buying signals", "buying signal", "intent signals", "growth signals"},
    {"founding year", "founded year", "business start year", "start year", "year established"},
    {"company age", "business age", "estimated age", "age"},
]


def normalize_header(header: str) -> str:
    """Normalize a header string for comparison."""
    if not header:
        return ""
    # Lowercase, replace underscores/hyphens/dots with spaces, remove punctuation
    h = str(header).lower().strip()
    h = re.sub(r"[_\-\.\/]+", " ", h)
    h = re.sub(r"[^\w\s]", "", h)
    h = re.sub(r"\s+", " ", h).strip()
    return h


ROOT_SYNONYM_MAP = {
    "email": ["email", "emails", "e-mail", "mail", "mail address", "email address", "public emails", "public business email", "public email"],
    "phone": ["phone", "phones", "telephone", "mobile", "cell", "tel", "contact number", "contact no", "phone number", "public phone number", "public phone numbers", "public phone number s", "public phone"],
    "company": ["company", "company name", "business", "business name", "organization", "org name", "account", "client"],
    "website": ["website", "web", "url", "web address", "domain", "company website", "homepage", "company site", "company website clutch linked"],
    "city": ["city", "town", "municipality", "city-level", "office city", "india-listed office location", "india listed office location", "office location"],
    "address": ["address", "street", "street address", "location", "addr", "office location", "india-listed office location", "india listed office location"],
    "state": ["state", "province", "region"],
    "zip": ["zip", "zip code", "zipcode", "postal", "postal code", "postcode"],
    "country": ["country", "nation"],
    "revenue": ["revenue", "annual revenue", "turnover", "sales"],
    "score": ["score", "fit score", "potential score", "icp score", "dakini score", "rating", "dakini ai fit score", "dakini ai fit score 0 100", "fit score 0 100"],
    "tier": ["tier", "fit tier", "qualification tier", "dakini fit level", "fit level"],
    "industry": ["industry", "target industry", "category", "sector"],
    "age": ["age", "business age", "company age", "estimated age", "start year", "business start year", "founding year", "company age calendar year estimate as of 2026", "company age calendar-year estimate; as of 2026"],
    "evidence": ["evidence", "evidence basis", "source excerpts", "evidence quotes", "source reference url", "workflow check", "dakini workflow evidence", "workflow evidence", "score basis", "dakini score components"],
}


def are_synonyms(header1: str, header2: str) -> bool:
    """Check if two headers belong to the same synonym group or share semantic root."""
    n1 = normalize_header(header1)
    n2 = normalize_header(header2)
    if n1 == n2:
        return True

    # Check defined synonym groups
    for group in SYNONYM_GROUPS:
        if n1 in group and n2 in group:
            return True

    # Check root synonym map
    tokens1 = set(n1.split())
    tokens2 = set(n2.split())

    for root, variants in ROOT_SYNONYM_MAP.items():
        v_norms = {normalize_header(v) for v in variants}
        # Check if full normalized strings match
        if n1 in v_norms and n2 in v_norms:
            return True
        # Check if tokens match
        if (tokens1 & v_norms or any(v in n1 for v in v_norms)) and (tokens2 & v_norms or any(v in n2 for v in v_norms)):
            return True

    return False


class SchemaMapper:
    """
    Manages column mapping across multiple datasets to unify them into a single consolidated schema.
    """

    def __init__(self, target_columns: Optional[List[str]] = None):
        # Target canonical column names (e.g. from existing master or first dataset)
        self.target_columns: List[str] = list(target_columns) if target_columns else []
        # Mapping rules: dataset_identifier -> {source_col: target_col}
        self.mappings: Dict[str, Dict[str, str]] = {}
        # Ambiguous suggestions needing confirmation: dataset_identifier -> {source_col: [candidate_targets]}
        self.ambiguities: Dict[str, Dict[str, List[Tuple[str, float]]]] = {}

    def initialize_target_columns_from_datasets(self, datasets: List[Any], existing_master_cols: Optional[List[str]] = None):
        """
        Establish the initial master column list.
        If existing_master_cols is provided, start with that.
        Otherwise, use the columns of the first dataset, and append genuinely new columns from subsequent datasets.
        Columns that are synonyms or match existing target columns are NOT added as separate columns.
        """
        canonical_cols: List[str] = []

        def _is_represented(col: str, existing_list: List[str]) -> bool:
            norm_col = normalize_header(col)
            for c in existing_list:
                norm_c = normalize_header(c)
                if norm_col == norm_c or are_synonyms(col, c):
                    return True
                if fuzz.token_sort_ratio(norm_col, norm_c) >= 90.0:
                    return True
            return False

        if existing_master_cols:
            for c in existing_master_cols:
                if not _is_represented(c, canonical_cols):
                    canonical_cols.append(c)

        for ds in datasets:
            for col in ds.columns:
                if not _is_represented(col, canonical_cols):
                    canonical_cols.append(col)

        self.target_columns = canonical_cols

    def propose_mappings_for_dataset(
        self,
        dataset_id: str,
        source_columns: List[str],
        similarity_threshold: float = 85.0,
    ) -> Dict[str, str]:
        """
        Propose mappings from source_columns to self.target_columns.
        Returns proposed mapping: {source_col: target_col}.
        Populates self.ambiguities with any ambiguous candidates.
        """
        mapping: Dict[str, str] = {}
        dataset_ambiguities: Dict[str, List[Tuple[str, float]]] = {}

        used_targets: Set[str] = set()

        for src_col in source_columns:
            norm_src = normalize_header(src_col)

            # 1. Exact match (case/space-insensitive)
            exact_match = None
            for tgt in self.target_columns:
                if norm_src == normalize_header(tgt):
                    exact_match = tgt
                    break

            if exact_match and exact_match not in used_targets:
                mapping[src_col] = exact_match
                used_targets.add(exact_match)
                continue

            # 2. Known Synonym Match
            synonym_matches = [
                tgt for tgt in self.target_columns
                if are_synonyms(src_col, tgt) and tgt not in used_targets
            ]
            if len(synonym_matches) == 1:
                mapping[src_col] = synonym_matches[0]
                used_targets.add(synonym_matches[0])
                continue
            elif len(synonym_matches) > 1:
                dataset_ambiguities[src_col] = [(m, 95.0) for m in synonym_matches]
                # Default to keeping src_col as its own column rather than incorrectly combining
                mapping[src_col] = src_col
                continue

            # 3. High-confidence fuzzy string match
            candidates: List[Tuple[str, float]] = []
            for tgt in self.target_columns:
                if tgt in used_targets:
                    continue
                score = fuzz.token_sort_ratio(norm_src, normalize_header(tgt))
                if score >= similarity_threshold:
                    candidates.append((tgt, score))

            candidates.sort(key=lambda x: x[1], reverse=True)

            if len(candidates) == 1:
                mapping[src_col] = candidates[0][0]
                used_targets.add(candidates[0][0])
            elif len(candidates) > 1:
                # Ambiguous: multiple targets with high similarity
                if candidates[0][1] - candidates[1][1] >= 15.0:
                    # Clear winner
                    mapping[src_col] = candidates[0][0]
                    used_targets.add(candidates[0][0])
                else:
                    dataset_ambiguities[src_col] = candidates
                    mapping[src_col] = src_col
            else:
                # No reliable match: preserve separately
                mapping[src_col] = src_col

        self.mappings[dataset_id] = mapping
        if dataset_ambiguities:
            self.ambiguities[dataset_id] = dataset_ambiguities

        return mapping

    def set_manual_mapping(self, dataset_id: str, source_col: str, target_col: str):
        """User manual override of a column mapping."""
        if dataset_id not in self.mappings:
            self.mappings[dataset_id] = {}
        self.mappings[dataset_id][source_col] = target_col
        # Add target_col to target_columns if it's new
        if target_col not in self.target_columns:
            self.target_columns.append(target_col)

    def get_consolidated_columns(self) -> List[str]:
        """Return the complete list of unique columns across all mappings and targets."""
        cols: List[str] = []
        seen: Set[str] = set()

        # Add target columns first
        for col in self.target_columns:
            if col not in seen:
                seen.add(col)
                cols.append(col)

        # Add any mapped target columns that might not be in self.target_columns
        for d_id, d_map in self.mappings.items():
            for src, tgt in d_map.items():
                if tgt and tgt not in seen:
                    seen.add(tgt)
                    cols.append(tgt)

        return cols
