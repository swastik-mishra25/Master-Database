"""
Configuration and directory management for the Master Spreadsheet Management System.
"""
from pathlib import Path

# Base application directories
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
BACKUP_DIR = BASE_DIR / "backups"
TEMP_DIR = BASE_DIR / "temp"

# Primary persistent master workbook
MASTER_FILENAME = "Master.xlsx"
MASTER_FILE_PATH = DATA_DIR / MASTER_FILENAME

# Common placeholders that should be normalized to empty/null
DEFAULT_BLANK_PLACEHOLDERS = {
    "", "nan", "none", "null", "n/a", "na", "-", "--", "nil", "undefined", "?", "n.a."
}

# Default fuzzy similarity threshold (0 - 100)
DEFAULT_FUZZY_THRESHOLD = 85.0

# Supported file extensions
SUPPORTED_EXTENSIONS = {".xlsx", ".xls", ".csv"}


def ensure_directories():
    """Ensure that data, backup, and temp directories exist."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
