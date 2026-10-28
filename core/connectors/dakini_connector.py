"""
Connector for Dakini AI ICP Scraper.
Supports direct reading from Dakini's SQLite database (.dakini-state.sqlite)
as well as parsing exported prospect CSV files and local agency datasets.
"""
import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import pandas as pd

from ..file_loader import LoadedDataset, compute_content_hash


class DakiniConnector:
    """
    Connects to Dakini AI ICP Scraper's SQLite database or directory,
    extracting prospect research records, fit scores, and contact intelligence.
    """

    DEFAULT_DB_FILENAMES = [
        ".dakini-state.sqlite",
        "dakini-state.sqlite",
        "dakini.sqlite",
        ".dakini.sqlite",
    ]

    DEFAULT_CSV_FILENAMES = [
        "indian-digital-marketing-agencies-enriched.csv",
        "indian-digital-marketing-agencies.csv",
    ]

    @classmethod
    def find_local_dakini_files(cls, base_dir: Optional[Union[str, Path]] = None) -> List[Path]:
        """
        Scan the workspace or directory for any Dakini SQLite files or candidate database/CSV files.
        """
        p = Path(base_dir).resolve() if base_dir else Path.cwd().resolve()
        candidates: List[Path] = []
        search_dirs = [p, p / "data", p / "temp", p / "dakini", p / "sample_data"]

        # Search recursively for any subfolder with dakini or scraper in the name
        try:
            for sdir in p.glob("*dakini*"):
                if sdir.is_dir() and sdir not in search_dirs:
                    search_dirs.append(sdir)
                    for inner in sdir.glob("*dakini*"):
                        if inner.is_dir() and inner not in search_dirs:
                            search_dirs.append(inner)
        except Exception:
            pass

        for sdir in search_dirs:
            if not sdir.exists():
                continue

            # 1. Check default DB filenames
            for fname in cls.DEFAULT_DB_FILENAMES:
                c = sdir / fname
                if c.is_file() and c not in candidates:
                    candidates.append(c)

            # 2. Check any .sqlite or .db
            for c in sdir.glob("*.sqlite"):
                if c.is_file() and c not in candidates:
                    candidates.append(c)
            for c in sdir.glob("*.db"):
                if c.is_file() and c not in candidates:
                    candidates.append(c)

            # 3. Check default CSV filenames
            for fname in cls.DEFAULT_CSV_FILENAMES:
                c = sdir / fname
                if c.is_file() and c not in candidates:
                    candidates.append(c)

        return candidates

    @classmethod
    def resolve_sqlite_path(cls, path_input: Optional[Union[str, Path]] = None) -> Optional[Path]:
        """
        Resolve a given folder or file path to an actual Dakini SQLite database or CSV dataset.
        If path_input is None or empty, auto-detects from the workspace.
        """
        if not path_input or not str(path_input).strip():
            detected = cls.find_local_dakini_files()
            return detected[0] if detected else None

        p = Path(path_input).expanduser().resolve()

        # If direct file path given
        if p.is_file():
            if p.suffix.lower() in [".sqlite", ".db", ".sqlite3", ".csv"]:
                return p
            return None

        # If directory path given
        if p.is_dir():
            # Check default filenames
            for fname in cls.DEFAULT_DB_FILENAMES:
                candidate = p / fname
                if candidate.is_file():
                    return candidate

            # Check any .sqlite in the directory
            for candidate in p.glob("*.sqlite"):
                if candidate.is_file():
                    return candidate

            for candidate in p.glob("*.db"):
                if candidate.is_file():
                    return candidate

            # Check default CSV datasets
            for fname in cls.DEFAULT_CSV_FILENAMES:
                candidate = p / fname
                if candidate.is_file():
                    return candidate

            for candidate in p.glob("*dakini*.csv"):
                if candidate.is_file():
                    return candidate

            # Check inside child folders
            for child in p.glob("*dakini*"):
                if child.is_dir():
                    res = cls.resolve_sqlite_path(child)
                    if res:
                        return res

        return None

    @classmethod
    def inspect_database(cls, db_path: Union[str, Path]) -> Dict[str, Any]:
        """
        Inspect the Dakini SQLite database or CSV dataset and return metadata about available tables and rows.
        """
        target_path = cls.resolve_sqlite_path(db_path)
        if not target_path or not target_path.exists():
            return {
                "success": False,
                "error": f"Database or dataset file not found at: {db_path}",
                "tables": {},
                "total_prospects": 0,
            }

        # If CSV file
        if target_path.suffix.lower() == ".csv":
            try:
                df_head = pd.read_csv(target_path, nrows=5)
                with open(target_path, "r", encoding="utf-8", errors="replace") as f:
                    cnt = sum(1 for _ in f) - 1
                cnt = max(0, cnt)
                return {
                    "success": True,
                    "db_path": str(target_path),
                    "tables": {
                        target_path.name: {
                            "row_count": cnt,
                            "columns": list(df_head.columns),
                        }
                    },
                    "total_prospects": cnt,
                }
            except Exception as ex:
                return {
                    "success": False,
                    "error": str(ex),
                    "tables": {},
                    "total_prospects": 0,
                }

        # If SQLite file
        try:
            conn = sqlite3.connect(f"file:{target_path.as_posix()}?mode=ro", uri=True)
            cursor = conn.cursor()

            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
            tables = [row[0] for row in cursor.fetchall()]

            table_meta: Dict[str, Any] = {}
            total_records = 0

            # Special check for Dakini state-store 'records' table
            if "records" in tables:
                try:
                    cursor.execute("SELECT collection, COUNT(*) FROM records GROUP BY collection;")
                    for col_name, c_cnt in cursor.fetchall():
                        table_meta[f"collection:{col_name}"] = {"row_count": c_cnt, "columns": ["payload (JSON)"]}
                        if col_name == "companies":
                            total_records += c_cnt
                except Exception:
                    pass

            for tbl in tables:
                try:
                    cursor.execute(f"SELECT COUNT(*) FROM \"{tbl}\";")
                    cnt = cursor.fetchone()[0]
                    cursor.execute(f"PRAGMA table_info(\"{tbl}\");")
                    cols = [col[1] for col in cursor.fetchall()]
                    table_meta[tbl] = {"row_count": cnt, "columns": cols}
                    if any(kw in tbl.lower() for kw in ["prospect", "company", "lead"]) and "records" not in tables:
                        total_records += cnt
                except Exception:
                    continue

            conn.close()

            return {
                "success": True,
                "db_path": str(target_path),
                "tables": table_meta,
                "total_prospects": total_records,
            }
        except Exception as ex:
            return {
                "success": False,
                "error": str(ex),
                "tables": {},
                "total_prospects": 0,
            }

    @classmethod
    def load_prospects_dataframe(
        cls,
        db_path: Union[str, Path],
        min_score: Optional[int] = None,
        tier: Optional[str] = None,
    ) -> Tuple[pd.DataFrame, List[str]]:
        """
        Load prospect data from Dakini SQLite or CSV dataset into a normalized pandas DataFrame.
        Returns (DataFrame, list of warnings).
        """
        target_path = cls.resolve_sqlite_path(db_path)
        if not target_path or not target_path.exists():
            raise FileNotFoundError(f"Dakini database or dataset not found at: {db_path}")

        warnings: List[str] = []

        # If it's a CSV dataset
        if target_path.suffix.lower() == ".csv":
            df = pd.read_csv(target_path, dtype=str)

            # Apply score / tier filtering
            score_col = None
            for candidate in ["Dakini AI fit score (0-100)", "score", "fit_score", "potential_score", "Score", "Fit Score"]:
                if candidate in df.columns:
                    score_col = candidate
                    break

            if score_col and min_score is not None:
                numeric_scores = pd.to_numeric(df[score_col], errors="coerce").fillna(0)
                df = df[numeric_scores >= min_score]

            tier_col = None
            for candidate in ["Dakini fit level", "tier", "fit_tier", "Tier", "Fit Tier"]:
                if candidate in df.columns:
                    tier_col = candidate
                    break

            if tier_col and tier and tier.lower() != "all":
                df = df[df[tier_col].astype(str).str.lower().str.contains(tier.lower())]

            return df, warnings

        # If it's SQLite
        conn = sqlite3.connect(f"file:{target_path.as_posix()}?mode=ro", uri=True)

        try:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
            tables = [row[0] for row in cursor.fetchall()]

            # 1. Check for Dakini state-store schema (records table with collection='companies')
            if "records" in tables:
                cursor.execute("SELECT payload FROM records WHERE collection = 'companies';")
                rows = cursor.fetchall()
                if rows:
                    items = []
                    for r in rows:
                        val = r[0]
                        if isinstance(val, str) and val.strip().startswith(("{", "[")):
                            try:
                                items.append(json.loads(val))
                            except Exception:
                                continue
                    if items:
                        df = pd.json_normalize(items)
                        # Process lists and filters
                        for col in df.columns:
                            df[col] = df[col].apply(
                                lambda v: ", ".join(str(item) for item in v) if isinstance(v, list) else v
                            )
                        score_col = None
                        for cand in ["score", "fit_score", "potential_score", "Score", "Fit Score"]:
                            if cand in df.columns:
                                score_col = cand
                                break
                        if score_col and min_score is not None:
                            numeric_scores = pd.to_numeric(df[score_col], errors="coerce").fillna(0)
                            df = df[numeric_scores >= min_score]

                        tier_col = None
                        for cand in ["tier", "fit_tier", "Tier", "Fit Tier"]:
                            if cand in df.columns:
                                tier_col = cand
                                break
                        if tier_col and tier and tier.lower() != "all":
                            df = df[df[tier_col].astype(str).str.lower().str.contains(tier.lower())]

                        return df, warnings

            # 2. Determine best standard table to read
            prospect_table = None
            for candidate in ["prospects", "leads", "companies", "saved_prospects"]:
                if candidate in tables:
                    prospect_table = candidate
                    break

            if not prospect_table:
                for tbl in tables:
                    if "prospect" in tbl.lower():
                        prospect_table = tbl
                        break
            if not prospect_table and tables:
                prospect_table = tables[0]

            if not prospect_table:
                warnings.append("No user data tables found in Dakini SQLite database.")
                return pd.DataFrame(), warnings

            raw_df = pd.read_sql_query(f"SELECT * FROM \"{prospect_table}\"", conn)

            processed_rows: List[Dict[str, Any]] = []
            json_cols = [c for c in raw_df.columns if c.lower() in ["data", "json", "payload", "prospect", "value", "state"]]

            if json_cols and len(raw_df.columns) <= 4:
                jcol = json_cols[0]
                for _, row in raw_df.iterrows():
                    val = row[jcol]
                    if isinstance(val, str) and val.strip().startswith(("{", "[")):
                        try:
                            parsed = json.loads(val)
                            if isinstance(parsed, dict):
                                processed_rows.append(parsed)
                            elif isinstance(parsed, list):
                                for item in parsed:
                                    if isinstance(item, dict):
                                        processed_rows.append(item)
                        except Exception:
                            continue
                if processed_rows:
                    df = pd.json_normalize(processed_rows)
                else:
                    df = raw_df
            else:
                df = raw_df.copy()
                for c in df.columns:
                    sample = df[c].dropna().head(10)
                    if not sample.empty and all(isinstance(v, str) and (v.strip().startswith("{") or v.strip().startswith("[")) for v in sample):
                        try:
                            parsed_series = df[c].apply(lambda x: json.loads(x) if isinstance(x, str) and x.strip() else None)
                            if c.lower() in ["scores", "score_breakdown"]:
                                score_df = pd.json_normalize(parsed_series.dropna())
                                score_df.columns = [f"score_{sub}" for sub in score_df.columns]
                                df = pd.concat([df.drop(columns=[c]), score_df], axis=1)
                        except Exception:
                            pass

            for col in df.columns:
                df[col] = df[col].apply(
                    lambda v: ", ".join(str(item) for item in v) if isinstance(v, list) else v
                )

            score_col = None
            for candidate in ["score", "fit_score", "potential_score", "Score", "Fit Score"]:
                if candidate in df.columns:
                    score_col = candidate
                    break

            if score_col and min_score is not None:
                numeric_scores = pd.to_numeric(df[score_col], errors="coerce").fillna(0)
                df = df[numeric_scores >= min_score]

            tier_col = None
            for candidate in ["tier", "fit_tier", "Tier", "Fit Tier"]:
                if candidate in df.columns:
                    tier_col = candidate
                    break

            if tier_col and tier and tier.lower() != "all":
                df = df[df[tier_col].astype(str).str.lower().str.contains(tier.lower())]

            return df, warnings

        finally:
            conn.close()


def inspect_dakini_sqlite(path_input: Union[str, Path]) -> Dict[str, Any]:
    """Helper function to inspect Dakini database or dataset."""
    return DakiniConnector.inspect_database(path_input)


def load_dakini_dataset(
    path_input: Union[str, Path],
    min_score: Optional[int] = None,
    tier: Optional[str] = None,
) -> LoadedDataset:
    """
    Load Dakini prospects directly as a LoadedDataset ready for ConsolidationWorkflow.
    """
    resolved = DakiniConnector.resolve_sqlite_path(path_input)
    if not resolved:
        raise FileNotFoundError(f"Could not locate Dakini database or dataset from path: '{path_input}'")

    df, warnings = DakiniConnector.load_prospects_dataframe(resolved, min_score=min_score, tier=tier)
    f_hash = compute_content_hash(resolved)

    return LoadedDataset(
        source_filename=resolved.name,
        sheet_name="Dakini_Prospects",
        df=df,
        warnings=warnings,
        content_hash=f_hash,
    )
