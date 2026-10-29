"""
Tests for Dakini AI ICP Scraper connector and schema mapping.
"""
import sqlite3
import tempfile
import unittest
from pathlib import Path
import pandas as pd

from core.connectors.dakini_connector import DakiniConnector, inspect_dakini_sqlite, load_dakini_dataset
from core.master_manager import MasterManager
from core.schema_mapper import SchemaMapper, are_synonyms
from core.workflow import ConsolidationWorkflow


class TestDakiniConnector(unittest.TestCase):
    def test_dakini_synonym_mapping(self):
        """Verify Dakini header terms match canonical synonyms."""
        self.assertTrue(are_synonyms("Public Business Email", "Email"))
        self.assertTrue(are_synonyms("Public Phone Number", "Phone"))
        self.assertTrue(are_synonyms("Fit Score", "Score"))
        self.assertTrue(are_synonyms("Fit Tier", "Status"))
        self.assertTrue(are_synonyms("Company Website", "Website"))
        self.assertTrue(are_synonyms("Evidence Basis", "Notes"))
        self.assertTrue(are_synonyms("Business Start Year", "Age"))

    def test_dakini_sqlite_ingest_and_merge(self):
        """Create a temporary Dakini SQLite database and test end-to-end extraction and consolidation."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            db_file = tmp_path / ".dakini-state.sqlite"

            # 1. Create realistic Dakini SQLite schema and sample data
            conn = sqlite3.connect(db_file)
            cursor = conn.cursor()
            cursor.execute(
                """
                CREATE TABLE prospects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_name TEXT NOT NULL,
                    domain TEXT,
                    website TEXT,
                    public_business_email TEXT,
                    public_phone_number TEXT,
                    score INTEGER,
                    tier TEXT,
                    service_fit INTEGER,
                    operating_scale INTEGER,
                    buying_signals TEXT,
                    evidence_basis TEXT,
                    business_start_year INTEGER,
                    city TEXT
                );
                """
            )
            cursor.executemany(
                """
                INSERT INTO prospects (
                    company_name, domain, website, public_business_email,
                    public_phone_number, score, tier, service_fit,
                    operating_scale, buying_signals, evidence_basis,
                    business_start_year, city
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                [
                    (
                        "Stark Enterprises",
                        "stark.com",
                        "https://stark.com",
                        "tony@stark.com",
                        "555-0400",
                        95,
                        "High potential",
                        30,
                        25,
                        "AI voice automation evaluation confirmed",
                        "Scanned careers and contact page",
                        2008,
                        "New York",
                    ),
                    (
                        "Acme Industrial",
                        "acme.com",
                        "https://acme.com",
                        "contact@acme.com",
                        "555-0100",
                        48,
                        "Research",
                        15,
                        10,
                        "Expansion news",
                        "TechBehemoths directory verified",
                        1995,
                        "Chicago",
                    ),
                    (
                        "Small Local Shop",
                        "localshop.com",
                        "https://localshop.com",
                        "shop@local.com",
                        "555-9999",
                        22,
                        "Lower fit",
                        5,
                        5,
                        "None",
                        "Single page scanned",
                        2021,
                        "Austin",
                    ),
                ],
            )
            conn.commit()
            conn.close()

            # 2. Test inspect_dakini_sqlite
            inspect_res = inspect_dakini_sqlite(tmp_path)
            self.assertTrue(inspect_res["success"])
            self.assertEqual(inspect_res["total_prospects"], 3)
            self.assertIn("prospects", inspect_res["tables"])

            # 3. Test loading with score filter
            ds_all = load_dakini_dataset(tmp_path)
            self.assertEqual(ds_all.row_count, 3)

            ds_high = load_dakini_dataset(tmp_path, min_score=90)
            self.assertEqual(ds_high.row_count, 1)
            self.assertEqual(ds_high.df.iloc[0]["company_name"], "Stark Enterprises")

            # 4. Test consolidation workflow with existing Master
            master_mgr = MasterManager(master_path=tmp_path / "Master.xlsx", backup_dir=tmp_path / "backups")
            
            # Pre-seed master with an incomplete record for Stark Enterprises (missing email)
            initial_master_df = pd.DataFrame([
                {"Company Name": "Stark Enterprises", "Phone": "555-0400", "Email": "", "City": "New York"}
            ])
            master_mgr.save_master(initial_master_df)

            # Consolidate Dakini dataset into master with merge mode
            wf = ConsolidationWorkflow(master_mgr)
            wf.set_datasets([ds_high])

            staging_df = wf.build_consolidated_staging(include_existing_master=True)
            self.assertEqual(len(staging_df), 2)  # 1 from master, 1 from Dakini

            # Deduplicate
            exact_g, prob_g = wf.detect_duplicates(
                comparison_mode="selected_columns",
                selected_columns=["Company Name"],
            )
            self.assertEqual(len(exact_g), 1)

            # Resolve with complementary merge
            exact_g[0].resolution = "merge_complementary"
            cleaned_df, review_df = wf.apply_resolutions()

            # Stark Enterprises should be merged into 1 record, backfilling the email from Dakini!
            self.assertEqual(len(cleaned_df), 1)
            merged_row = cleaned_df.iloc[0]
            self.assertEqual(merged_row["Company Name"], "Stark Enterprises")
            self.assertEqual(merged_row["Email"], "tony@stark.com")
            self.assertEqual(merged_row["Phone"], "555-0400")


    def test_actual_dakini_placed_folder(self):
        """Verify loading from the newly placed Dakini folder in the workspace."""
        workspace_root = Path(__file__).resolve().parent.parent
        local_files = DakiniConnector.find_local_dakini_files(workspace_root)
        if local_files:
            first_file = local_files[0]
            ds = load_dakini_dataset(first_file)
            self.assertTrue(ds.row_count > 0)


if __name__ == "__main__":
    unittest.main()
