"""
Dynamic synchronization engine between Dakini AI ICP Scraper and Master.xlsx.
Monitors Dakini SQLite database (.dakini-state.sqlite) and CSV datasets for changes,
and automatically extracts, deduplicates, and merges new or updated leads into data/Master.xlsx.
"""
import hashlib
import json
import logging
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
import pandas as pd

from .config import DATA_DIR, MASTER_FILE_PATH, ensure_directories
from .connectors.dakini_connector import DakiniConnector, load_dakini_dataset
from .master_manager import MasterManager
from .workflow import ConsolidationWorkflow

logger = logging.getLogger("dakini_sync")
STATE_FILE = DATA_DIR / ".dakini_sync_state.json"


class DakiniSyncEngine:
    """
    Generalized dynamic synchronizer.
    Watches Dakini data sources and incrementally commits new/changed leads to Master.xlsx.
    """

    def __init__(self, workspace_root: Optional[Path] = None):
        self.workspace_root = workspace_root or Path(__file__).resolve().parent.parent
        self.manager = MasterManager()
        self._watcher_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self.state_file = STATE_FILE
        self._sync_lock = threading.Lock()

    def _load_sync_state(self) -> Dict[str, Any]:
        """Load persistent sync state (hashes, timestamps, tracked lead signatures)."""
        if self.state_file.exists():
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "last_sync_timestamp": None,
            "last_source_path": None,
            "last_source_hash": "",
            "total_synced_leads": 0,
            "lead_signatures": {},
        }

    def _save_sync_state(self, state: Dict[str, Any]):
        """Save persistent sync state."""
        ensure_directories()
        try:
            with open(self.state_file, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
        except Exception as ex:
            logger.warning(f"Could not persist sync state: {ex}")

    def get_active_source(self) -> Optional[Path]:
        """Locate the active Dakini SQLite database or latest CSV file."""
        candidates = DakiniConnector.find_local_dakini_files(self.workspace_root)
        if not candidates:
            return None
        # Prefer .sqlite if it exists, otherwise enriched CSV
        sqlite_candidates = [c for c in candidates if c.suffix.lower() in [".sqlite", ".db"]]
        if sqlite_candidates:
            return sqlite_candidates[0]
        return candidates[0]

    def compute_source_signature(self, source_path: Path) -> str:
        """Compute content hash and size/modification timestamp for rapid change detection."""
        try:
            stat = source_path.stat()
            # Fast signature: mtime + size
            sig_str = f"{source_path.name}_{stat.st_size}_{stat.st_mtime}"
            return hashlib.sha256(sig_str.encode("utf-8")).hexdigest()
        except Exception:
            return ""

    def has_changes(self) -> Tuple[bool, Optional[Path], str]:
        """
        Check if the Dakini data source has been updated since the last sync.
        Returns (has_changed, source_path, current_sig).
        """
        src = self.get_active_source()
        if not src or not src.exists():
            return False, None, ""

        current_sig = self.compute_source_signature(src)
        state = self._load_sync_state()

        if state.get("last_source_hash") != current_sig or state.get("last_source_path") != str(src):
            return True, src, current_sig

        return False, src, current_sig

    def sync_once(
        self,
        min_score: Optional[int] = None,
        source_override: Optional[Path] = None,
        force: bool = False,
    ) -> Dict[str, Any]:
        """
        Execute one sync run:
        1. Ingests all current prospects from Dakini.
        2. Aligns schema into Master canonical columns.
        3. Deduplicates against data/Master.xlsx (filling blanks with complementary merge).
        4. Writes updated Master.xlsx atomically with backup.
        5. Updates sync state.
        """
        with self._sync_lock:
            src = source_override or self.get_active_source()
            if not src or not src.exists():
                return {
                    "success": False,
                    "error": "No Dakini SQLite database or CSV dataset found in workspace.",
                    "new_leads": 0,
                    "updated_leads": 0,
                    "total_master_rows": 0,
                }

            current_sig = self.compute_source_signature(src)
            state = self._load_sync_state()

            if not force and state.get("last_source_hash") == current_sig:
                # No changes detected
                master_df = self.manager.load_master()
                master_count = len(master_df) if master_df is not None else 0
                return {
                    "success": True,
                    "changed": False,
                    "message": "No new changes in Dakini data source.",
                    "new_leads": 0,
                    "updated_leads": 0,
                    "total_master_rows": master_count,
                    "source": str(src.name),
                }

            # 1. Load dataset from Dakini source
            try:
                ds = load_dakini_dataset(src, min_score=min_score)
            except Exception as ex:
                return {
                    "success": False,
                    "error": f"Failed to load Dakini dataset: {str(ex)}",
                    "new_leads": 0,
                    "updated_leads": 0,
                }

            # 2. Existing master rows count
            master_rows_before = 0
            if self.manager.exists():
                existing_df = self.manager.load_master()
                if existing_df is not None:
                    master_rows_before = len(existing_df)

            # 3. Setup Consolidation Workflow
            wf = ConsolidationWorkflow(self.manager)
            wf.set_datasets([ds])
            wf.build_consolidated_staging(include_existing_master=True)

            # 4. Duplicate detection and safe merging
            wf.detect_duplicates(
                comparison_mode="selected_columns",
                selected_columns=["Company Name"],
                enable_fuzzy=False,
            )
            cleaned_df, review_df = wf.apply_resolutions()

            # 5. Commit to Master.xlsx with backup
            extra_sheets = {}
            try:
                extra_sheets["Processing_Summary"] = wf.get_summary_dataframe()
            except Exception:
                pass

            success, msg, backup_path = self.manager.save_master(
                cleaned_df, create_backup=True, extra_sheets=extra_sheets
            )
            if not success:
                return {
                    "success": False,
                    "error": f"Master save failed: {msg}",
                    "new_leads": 0,
                    "updated_leads": 0,
                }

            # Calculate deltas
            summary = wf.processing_summary
            total_after = len(cleaned_df)
            new_leads = max(0, total_after - master_rows_before)
            duplicates_merged = summary.get("confirmed_duplicates_removed", 0)

            # Update sync state
            state["last_sync_timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            state["last_source_path"] = str(src)
            state["last_source_hash"] = current_sig
            state["total_synced_leads"] = ds.row_count
            self._save_sync_state(state)

            return {
                "success": True,
                "changed": True,
                "message": f"Successfully synced {ds.row_count:,} Dakini prospects into Master.xlsx.",
                "source": str(src.name),
                "previous_master_rows": master_rows_before,
                "new_leads": new_leads,
                "duplicates_merged": duplicates_merged,
                "total_master_rows": total_after,
                "backup_created": backup_path.name if backup_path else None,
                "timestamp": state["last_sync_timestamp"],
            }

    def start_watcher(
        self,
        interval_seconds: int = 15,
        on_sync_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ):
        """
        Start continuous background daemon thread watching for Dakini lead changes.
        """
        if self._watcher_thread and self._watcher_thread.is_alive():
            return  # Already running

        self._stop_event.clear()

        def _loop():
            logger.info(f"Dakini Auto-Sync daemon started (poll interval: {interval_seconds}s)")
            while not self._stop_event.is_set():
                try:
                    changed, src, _ = self.has_changes()
                    if changed and src:
                        logger.info(f"Change detected in {src.name}! Syncing to Master.xlsx...")
                        result = self.sync_once()
                        if on_sync_callback:
                            on_sync_callback(result)
                except Exception as ex:
                    logger.error(f"Error in sync daemon loop: {ex}")

                self._stop_event.wait(timeout=interval_seconds)

            logger.info("Dakini Auto-Sync daemon stopped.")

        self._watcher_thread = threading.Thread(target=_loop, daemon=True, name="DakiniSyncWatcher")
        self._watcher_thread.start()

    def stop_watcher(self):
        """Stop background watcher thread."""
        self._stop_event.set()
        if self._watcher_thread:
            self._watcher_thread.join(timeout=3)
            self._watcher_thread = None

    def is_watcher_running(self) -> bool:
        """Check if daemon thread is currently running."""
        return bool(self._watcher_thread and self._watcher_thread.is_alive())

    def get_status(self) -> Dict[str, Any]:
        """Return current status of dynamic sync."""
        state = self._load_sync_state()
        src = self.get_active_source()
        return {
            "watcher_running": self.is_watcher_running(),
            "active_source": str(src.name) if src else "None detected",
            "active_source_path": str(src) if src else None,
            "last_sync": state.get("last_sync_timestamp", "Never"),
            "total_synced_leads": state.get("total_synced_leads", 0),
        }
