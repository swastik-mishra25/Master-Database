"""
File ingestion, sheet inspection, and encoding/delimiter detection for Excel and CSV files.
"""
import io
import csv
import hashlib
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union, Any
import pandas as pd
import openpyxl

try:
    import xlrd
except ImportError:
    xlrd = None


def compute_content_hash(file_input: Union[str, Path, io.BytesIO, bytes, Any]) -> str:
    """Compute a SHA-256 hash of file content for reliable version and change tracking."""
    try:
        if isinstance(file_input, bytes):
            return hashlib.sha256(file_input).hexdigest()
        if hasattr(file_input, "getvalue"):
            return hashlib.sha256(file_input.getvalue()).hexdigest()
        if hasattr(file_input, "seek") and hasattr(file_input, "read"):
            pos = file_input.tell() if hasattr(file_input, "tell") else 0
            file_input.seek(0)
            content = file_input.read()
            file_input.seek(pos)
            if isinstance(content, str):
                content = content.encode("utf-8", errors="replace")
            return hashlib.sha256(content).hexdigest()
        if isinstance(file_input, (str, Path)):
            p = Path(file_input)
            if p.exists():
                return hashlib.sha256(p.read_bytes()).hexdigest()
    except Exception:
        pass
    return ""


class LoadedDataset:
    """Represents an ingested dataset from a file/sheet."""

    def __init__(
        self,
        source_filename: str,
        sheet_name: str,
        df: pd.DataFrame,
        warnings: Optional[List[str]] = None,
        errors: Optional[List[str]] = None,
        content_hash: str = "",
    ):
        self.source_filename = source_filename
        self.sheet_name = sheet_name
        self.df = df
        self.row_count = len(df)
        self.column_count = len(df.columns)
        self.columns = [str(c) for c in df.columns.tolist()]
        self.warnings = warnings or []
        self.errors = errors or []
        self.content_hash = content_hash or ""

    def __repr__(self) -> str:
        return f"<LoadedDataset {self.source_filename} [{self.sheet_name}] rows={self.row_count} cols={self.column_count}>"


def inspect_excel_sheets(file_input: Union[str, Path, io.BytesIO, Any]) -> List[str]:
    """Inspect and return sheet names from an Excel file (.xlsx or .xls)."""
    # If it's a file path or has a name
    filename = getattr(file_input, "name", str(file_input))
    lower_name = filename.lower()

    if hasattr(file_input, "seek"):
        file_input.seek(0)

    if lower_name.endswith(".xls") and not lower_name.endswith(".xlsx"):
        if xlrd is None:
            raise RuntimeError("xlrd is required to inspect legacy .xls files.")
        if hasattr(file_input, "read"):
            content = file_input.read()
            file_input.seek(0)
            book = xlrd.open_workbook(file_contents=content)
        else:
            book = xlrd.open_workbook(str(file_input))
        return book.sheet_names()
    else:
        # Default to openpyxl for .xlsx
        wb = openpyxl.load_workbook(file_input, read_only=True, data_only=True)
        sheet_names = wb.sheetnames
        wb.close()
        if hasattr(file_input, "seek"):
            file_input.seek(0)
        return sheet_names


def detect_csv_properties(
    file_input: Union[str, Path, io.BytesIO, Any],
    candidate_encodings: Optional[List[str]] = None,
) -> Tuple[str, str, List[str]]:
    """
    Detect character encoding and delimiter for a CSV file.
    Returns (encoding, delimiter, warnings).
    """
    if candidate_encodings is None:
        candidate_encodings = ["utf-8-sig", "utf-8", "cp1252", "latin1", "iso-8859-1"]

    warnings: List[str] = []

    # Get sample bytes
    if hasattr(file_input, "seek"):
        file_input.seek(0)
        sample_bytes = file_input.read(65536)
        file_input.seek(0)
    else:
        with open(str(file_input), "rb") as f:
            sample_bytes = f.read(65536)

    if not sample_bytes:
        return "utf-8", ",", ["CSV file is completely empty."]

    # Detect encoding
    detected_encoding = "utf-8"
    sample_text = ""
    for enc in candidate_encodings:
        try:
            sample_text = sample_bytes.decode(enc)
            detected_encoding = enc
            break
        except UnicodeDecodeError:
            continue

    if not sample_text:
        detected_encoding = "latin1"
        sample_text = sample_bytes.decode("latin1", errors="replace")
        warnings.append("Could not unambiguously determine encoding; defaulted to latin1.")

    # Detect delimiter using csv.Sniffer
    detected_delimiter = ","
    try:
        sniffer = csv.Sniffer()
        dialect = sniffer.sniff(sample_text, delimiters=[",", ";", "\t", "|"])
        detected_delimiter = dialect.delimiter
    except Exception:
        # Fallback heuristic: count occurrences of standard delimiters in lines
        lines = [line for line in sample_text.splitlines() if line.strip()][:10]
        if lines:
            counts = {
                ",": sum(line.count(",") for line in lines),
                ";": sum(line.count(";") for line in lines),
                "\t": sum(line.count("\t") for line in lines),
                "|": sum(line.count("|") for line in lines),
            }
            best = max(counts, key=counts.get)
            if counts[best] > 0:
                detected_delimiter = best
            else:
                warnings.append("Could not detect delimiter reliably; default comma used.")

    return detected_encoding, detected_delimiter, warnings


def read_csv_dataset(
    file_input: Union[str, Path, io.BytesIO, Any],
    filename: Optional[str] = None,
    encoding: Optional[str] = None,
    delimiter: Optional[str] = None,
) -> LoadedDataset:
    """Read a CSV file safely and return a LoadedDataset."""
    if filename is None:
        filename = getattr(file_input, "name", "dataset.csv")

    warnings: List[str] = []
    errors: List[str] = []

    det_encoding, det_delimiter, detect_warnings = detect_csv_properties(file_input)
    warnings.extend(detect_warnings)

    chosen_encoding = encoding or det_encoding
    chosen_delimiter = delimiter or det_delimiter

    if hasattr(file_input, "seek"):
        file_input.seek(0)

    try:
        # Read with pandas. Use dtype=str initially or keep_default_na=False to avoid
        # premature coercion of identifiers, or use dtype=object.
        # We read with dtype=object to keep strings/numbers unmodified.
        df = pd.read_csv(
            file_input,
            encoding=chosen_encoding,
            sep=chosen_delimiter,
            dtype=str,
            keep_default_na=False,
            na_values=[],
            on_bad_lines="warn",
        )
    except Exception as e:
        # Retry with python engine if c engine fails on multiline quotes
        if hasattr(file_input, "seek"):
            file_input.seek(0)
        try:
            df = pd.read_csv(
                file_input,
                encoding=chosen_encoding,
                sep=chosen_delimiter,
                engine="python",
                dtype=str,
                keep_default_na=False,
                na_values=[],
                on_bad_lines="warn",
            )
            warnings.append("Used Python fallback parsing engine for complex CSV structure.")
        except Exception as ex2:
            errors.append(f"Failed to read CSV: {str(ex2)}")
            df = pd.DataFrame()

    # Clean columns
    df = _clean_dataframe_columns(df, warnings)
    content_hash = compute_content_hash(file_input)

    return LoadedDataset(
        source_filename=Path(filename).name,
        sheet_name="CSV_Data",
        df=df,
        warnings=warnings,
        errors=errors,
        content_hash=content_hash,
    )


def read_excel_dataset(
    file_input: Union[str, Path, io.BytesIO, Any],
    filename: Optional[str] = None,
    sheet_name: Optional[str] = None,
) -> LoadedDataset:
    """Read an Excel worksheet and return a LoadedDataset."""
    if filename is None:
        filename = getattr(file_input, "name", "dataset.xlsx")

    warnings: List[str] = []
    errors: List[str] = []
    lower_name = filename.lower()
    content_hash = compute_content_hash(file_input)

    if hasattr(file_input, "seek"):
        file_input.seek(0)

    engine = "openpyxl"
    if lower_name.endswith(".xls") and not lower_name.endswith(".xlsx"):
        engine = "xlrd"

    try:
        # Read as dtype=str to avoid corrupting identifiers (like phone numbers, IDs with leading zeros)
        df = pd.read_excel(
            file_input,
            sheet_name=sheet_name if sheet_name is not None else 0,
            engine=engine,
            dtype=str,
            keep_default_na=False,
            na_values=[],
        )
        if sheet_name is None:
            # Check sheet name if read by index 0
            sheets = inspect_excel_sheets(file_input)
            sheet_name = sheets[0] if sheets else "Sheet1"
    except Exception as e:
        errors.append(f"Failed to read Excel worksheet '{sheet_name}': {str(e)}")
        df = pd.DataFrame()

    df = _clean_dataframe_columns(df, warnings)

    return LoadedDataset(
        source_filename=Path(filename).name,
        sheet_name=str(sheet_name),
        df=df,
        warnings=warnings,
        errors=errors,
        content_hash=content_hash,
    )


def _clean_dataframe_columns(df: pd.DataFrame, warnings: List[str]) -> pd.DataFrame:
    """Ensure column names are non-empty strings and detect unnamed or duplicates."""
    if df.empty:
        return df

    cleaned_cols = []
    col_counts: Dict[str, int] = {}

    for i, col in enumerate(df.columns):
        col_str = str(col).strip()
        if not col_str or col_str.lower().startswith("unnamed:"):
            col_str = f"Column_{i+1}"
            warnings.append(f"Column index {i+1} had no header; renamed to '{col_str}'.")

        if col_str in col_counts:
            col_counts[col_str] += 1
            dedup_col = f"{col_str}_{col_counts[col_str]}"
            warnings.append(f"Duplicate column header '{col_str}' found; renamed to '{dedup_col}'.")
            cleaned_cols.append(dedup_col)
        else:
            col_counts[col_str] = 1
            cleaned_cols.append(col_str)

    df.columns = cleaned_cols
    return df


def load_file_datasets(
    file_input: Union[str, Path, io.BytesIO, Any],
    filename: Optional[str] = None,
    selected_sheets: Optional[List[str]] = None,
    csv_encoding: Optional[str] = None,
    csv_delimiter: Optional[str] = None,
) -> List[LoadedDataset]:
    """
    High-level loader for an uploaded file.
    If Excel, returns a LoadedDataset for each selected worksheet.
    If CSV, returns a single LoadedDataset.
    """
    if filename is None:
        filename = getattr(file_input, "name", str(file_input))

    lower_name = filename.lower()
    if lower_name.endswith(".csv"):
        return [read_csv_dataset(file_input, filename=filename, encoding=csv_encoding, delimiter=csv_delimiter)]
    elif lower_name.endswith(".xlsx") or lower_name.endswith(".xls"):
        all_sheets = inspect_excel_sheets(file_input)
        sheets_to_load = selected_sheets if selected_sheets else all_sheets
        datasets: List[LoadedDataset] = []
        for s in sheets_to_load:
            datasets.append(read_excel_dataset(file_input, filename=filename, sheet_name=s))
        return datasets
    else:
        # Unsupported format
        return [
            LoadedDataset(
                source_filename=Path(filename).name,
                sheet_name="Error",
                df=pd.DataFrame(),
                errors=[f"Unsupported file format: {Path(filename).suffix}. Only .xlsx, .xls, and .csv are supported."],
            )
        ]
