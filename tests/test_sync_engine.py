"""
Unit tests for DakiniSyncEngine and dynamic change synchronization.
"""
import tempfile
from pathlib import Path
import pandas as pd
import pytest

from core.master_manager import MasterManager
from core.sync_engine import DakiniSyncEngine


def test_sync_engine_delta_and_state():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        engine = DakiniSyncEngine(workspace_root=tmp_path)
        engine.manager = MasterManager(master_path=tmp_path / "Master.xlsx", backup_dir=tmp_path / "backups")
        engine.state_file = tmp_path / ".sync_state.json"

        # 1. Create a dummy CSV source
        csv_file = tmp_path / "indian-digital-marketing-agencies-enriched.csv"
        df1 = pd.DataFrame([
            {"Company Name": "Acme Tech", "Public phone number(s)": "555-0100", "Dakini AI fit score (0-100)": "92", "Company website (Clutch linked)": "https://acme.com"},
            {"Company Name": "Beta Labs", "Public phone number(s)": "555-0200", "Dakini AI fit score (0-100)": "48", "Company website (Clutch linked)": "https://beta.com"},
        ])
        df1.to_csv(csv_file, index=False)

        # First sync
        has_ch, src, sig = engine.has_changes()
        assert has_ch is True
        assert src == csv_file

        res1 = engine.sync_once()
        assert res1["success"] is True
        assert res1["new_leads"] == 2
        assert res1["total_master_rows"] == 2

        # Second sync with NO changes
        has_ch2, _, _ = engine.has_changes()
        assert has_ch2 is False

        res2 = engine.sync_once()
        assert res2["success"] is True
        assert res2["changed"] is False
        assert res2["new_leads"] == 0

        # 2. Simulate Dakini finding 1 new lead and 1 duplicate
        df2 = pd.DataFrame([
            {"Company Name": "Acme Tech", "Public phone number(s)": "555-0100", "Dakini AI fit score (0-100)": "95", "Company website (Clutch linked)": "https://acme.com"},
            {"Company Name": "Gamma Robotics", "Public phone number(s)": "555-0300", "Dakini AI fit score (0-100)": "88", "Company website (Clutch linked)": "https://gamma.com"},
        ])
        df2.to_csv(csv_file, index=False)

        has_ch3, _, _ = engine.has_changes()
        assert has_ch3 is True

        res3 = engine.sync_once()
        assert res3["success"] is True
        assert res3["changed"] is True
        # Gamma Robotics is new (1), Acme Tech is merged
        assert res3["total_master_rows"] == 3
        print("Sync engine test passed successfully!")


if __name__ == "__main__":
    test_sync_engine_delta_and_state()
