"""
Unit tests for DakiniSyncEngine and dynamic change synchronization.
"""
import tempfile
import unittest
from pathlib import Path
import pandas as pd

from core.master_manager import MasterManager
from core.sync_engine import DakiniSyncEngine


class TestDakiniSyncEngine(unittest.TestCase):
    def test_sync_engine_delta_and_state(self):
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
            self.assertTrue(has_ch)
            self.assertEqual(src, csv_file)

            res1 = engine.sync_once()
            self.assertTrue(res1["success"])
            self.assertEqual(res1["new_leads"], 2)
            self.assertEqual(res1["total_master_rows"], 2)

            # Second sync with NO changes
            has_ch2, _, _ = engine.has_changes()
            self.assertFalse(has_ch2)

            res2 = engine.sync_once()
            self.assertTrue(res2["success"])
            self.assertFalse(res2["changed"])
            self.assertEqual(res2["new_leads"], 0)

            # 2. Simulate Dakini finding 1 new lead and 1 duplicate
            df2 = pd.DataFrame([
                {"Company Name": "Acme Tech", "Public phone number(s)": "555-0100", "Dakini AI fit score (0-100)": "95", "Company website (Clutch linked)": "https://acme.com"},
                {"Company Name": "Gamma Robotics", "Public phone number(s)": "555-0300", "Dakini AI fit score (0-100)": "88", "Company website (Clutch linked)": "https://gamma.com"},
            ])
            df2.to_csv(csv_file, index=False)

            has_ch3, _, _ = engine.has_changes()
            self.assertTrue(has_ch3)

            res3 = engine.sync_once()
            self.assertTrue(res3["success"])
            self.assertTrue(res3["changed"])
            # Gamma Robotics is new (1), Acme Tech is merged
            self.assertEqual(res3["total_master_rows"], 3)


if __name__ == "__main__":
    unittest.main()
