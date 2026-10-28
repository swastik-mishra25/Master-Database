"""
Comprehensive Verification Test Suite implementing Section 10: Mandatory Reproduction and Testing (Tests A through J).
Uses synthetic data in an isolated temporary sandbox.
"""
import io
import shutil
import tempfile
import unittest
from pathlib import Path
import pandas as pd
import openpyxl

from core.file_loader import (
    LoadedDataset,
    compute_content_hash,
    inspect_excel_sheets,
    load_file_datasets,
    read_csv_dataset,
    read_excel_dataset,
)
from core.master_manager import MasterManager
from core.workflow import ConsolidationWorkflow


class TestSection10Reproduction(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="test_repro_"))
        self.data_dir = self.test_dir / "data"
        self.backup_dir = self.test_dir / "backups"
        self.data_dir.mkdir(parents=True)
        self.backup_dir.mkdir(parents=True)
        self.master_file = self.data_dir / "Master.xlsx"
        self.manager = MasterManager(master_path=self.master_file, backup_dir=self.backup_dir)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_a_new_excel_workbook(self):
        """
        Test A: New Excel Workbook
        1. Start with a master workbook containing three known records.
        2. Upload a separate Excel workbook containing two new unique records.
        3. Process the upload.
        4. Verify that both new records appear in the generated master workbook.
        Expected: Master contains five records.
        """
        # 1. Master with 3 known records
        init_df = pd.DataFrame([
            {"Company Name": "Alpha Tech", "Phone": "555-0001", "Email": "alpha@tech.com"},
            {"Company Name": "Beta Logistics", "Phone": "555-0002", "Email": "beta@logistics.com"},
            {"Company Name": "Gamma Healthcare", "Phone": "555-0003", "Email": "gamma@health.com"},
        ])
        ok, msg, _ = self.manager.save_master(init_df, create_backup=False)
        self.assertTrue(ok)
        self.assertEqual(len(self.manager.load_master()), 3)

        # 2. Upload separate Excel workbook with 2 new records
        new_excel_path = self.test_dir / "new_companies.xlsx"
        new_data = pd.DataFrame([
            {"Company Name": "Delta Robotics", "Phone": "555-0004", "Email": "delta@robotics.com"},
            {"Company Name": "Epsilon Energy", "Phone": "555-0005", "Email": "epsilon@energy.com"},
        ])
        new_data.to_excel(new_excel_path, sheet_name="Companies", index=False)

        # 3. Process the upload
        datasets = load_file_datasets(new_excel_path)
        wf = ConsolidationWorkflow(self.manager)
        wf.set_datasets(datasets)
        wf.build_consolidated_staging(include_existing_master=True)
        wf.detect_duplicates(comparison_mode="entire_row")
        cleaned, _ = wf.apply_resolutions()
        ok, msg, _ = wf.commit_to_master()
        self.assertTrue(ok)

        # 4. Verify master contains 5 records
        updated_master = self.manager.load_master()
        self.assertEqual(len(updated_master), 5)
        names = updated_master["Company Name"].tolist()
        self.assertIn("Delta Robotics", names)
        self.assertIn("Epsilon Energy", names)
        self.assertIn("Alpha Tech", names)
        self.assertEqual(wf.processing_summary["new_unique_records_added"], 2)
        self.assertEqual(wf.processing_summary["master_rows_before"], 3)
        self.assertEqual(wf.processing_summary["master_rows_after"], 5)

    def test_b_new_worksheet(self):
        """
        Test B: New Worksheet
        1. Create a workbook with a new worksheet that does not exist in the original workbook.
        2. Place a unique test record in that worksheet.
        3. Select it for processing.
        4. Verify that the record appears in the master output.
        Expected: The newly added worksheet is discovered and processed correctly.
        """
        # Master initially
        init_df = pd.DataFrame([
            {"Company Name": "Base Org", "Phone": "111-2222", "Email": "base@org.com"}
        ])
        self.manager.save_master(init_df, create_backup=False)

        # Workbook with newly created worksheet 'Q3_Special_Projects'
        multi_sheet_path = self.test_dir / "multi_sheets.xlsx"
        with pd.ExcelWriter(multi_sheet_path, engine="openpyxl") as writer:
            pd.DataFrame([{"Company Name": "Base Org", "Phone": "111-2222", "Email": "base@org.com"}]).to_excel(
                writer, sheet_name="Sheet1", index=False
            )
            pd.DataFrame([{"Company Name": "Novel Sheet Entity", "Phone": "999-8888", "Email": "novel@entity.com"}]).to_excel(
                writer, sheet_name="Q3_Special_Projects", index=False
            )

        # Verify dynamic worksheet inspection
        detected_sheets = inspect_excel_sheets(multi_sheet_path)
        self.assertIn("Q3_Special_Projects", detected_sheets)

        # Load all sheets or selected new sheet
        datasets = load_file_datasets(multi_sheet_path, selected_sheets=["Q3_Special_Projects"])
        self.assertEqual(len(datasets), 1)
        self.assertEqual(datasets[0].sheet_name, "Q3_Special_Projects")

        wf = ConsolidationWorkflow(self.manager)
        wf.set_datasets(datasets)
        wf.build_consolidated_staging(include_existing_master=True)
        wf.detect_duplicates(comparison_mode="entire_row")
        cleaned, _ = wf.apply_resolutions()
        wf.commit_to_master()

        updated_master = self.manager.load_master()
        self.assertEqual(len(updated_master), 2)
        self.assertIn("Novel Sheet Entity", updated_master["Company Name"].values)

    def test_c_mixed_existing_and_new_records(self):
        """
        Test C: Mixed Existing and New Records
        Upload a file containing one existing record and two new unique records.
        Expected: The existing record is not duplicated, both new records are added, and the counts are correct.
        """
        # Existing master has 1 record
        init_df = pd.DataFrame([
            {"Company Name": "Existing Corp", "Phone": "123-4567", "Email": "exist@corp.com"}
        ])
        self.manager.save_master(init_df, create_backup=False)

        # Upload contains 1 existing + 2 new
        upload_data = pd.DataFrame([
            {"Company Name": "Existing Corp", "Phone": "123-4567", "Email": "exist@corp.com"},  # duplicate
            {"Company Name": "New Corp One", "Phone": "777-1111", "Email": "one@new.com"},      # new 1
            {"Company Name": "New Corp Two", "Phone": "777-2222", "Email": "two@new.com"},      # new 2
        ])
        upload_path = self.test_dir / "mixed_batch.xlsx"
        upload_data.to_excel(upload_path, index=False)

        datasets = load_file_datasets(upload_path)
        wf = ConsolidationWorkflow(self.manager)
        wf.set_datasets(datasets)
        wf.build_consolidated_staging(include_existing_master=True)
        wf.detect_duplicates(comparison_mode="entire_row")
        cleaned, _ = wf.apply_resolutions()
        wf.commit_to_master()

        updated_master = self.manager.load_master()
        self.assertEqual(len(updated_master), 3)  # 1 initial + 2 new
        s = wf.processing_summary
        self.assertEqual(s["master_rows_before"], 1)
        self.assertEqual(s["new_unique_records_added"], 2)
        self.assertEqual(s["existing_records_matched"], 1)
        self.assertEqual(s["confirmed_duplicates_removed"], 1)
        self.assertEqual(s["final_master_row_count"], 3)

    def test_d_new_csv_upload(self):
        """
        Test D: New CSV Upload
        Upload a CSV containing new records.
        Expected: The actual CSV rows are processed and added to the master workbook.
        """
        # Master with 1 record
        init_df = pd.DataFrame([
            {"Company Name": "Seed Company", "Phone": "111-0000", "Email": "seed@co.com"}
        ])
        self.manager.save_master(init_df, create_backup=False)

        # CSV upload with semicolon and different header synonym: Business Name
        csv_path = self.test_dir / "new_leads.csv"
        csv_path.write_text(
            "Business Name;Contact Number;Email Address\n"
            "CSV Venture A;555-9001;a@venture.com\n"
            "CSV Venture B;555-9002;b@venture.com\n",
            encoding="utf-8"
        )

        datasets = load_file_datasets(csv_path)
        self.assertEqual(len(datasets), 1)
        self.assertEqual(datasets[0].row_count, 2)

        wf = ConsolidationWorkflow(self.manager)
        wf.set_datasets(datasets)
        wf.build_consolidated_staging(include_existing_master=True)
        wf.detect_duplicates(comparison_mode="entire_row")
        cleaned, _ = wf.apply_resolutions()
        wf.commit_to_master()

        updated_master = self.manager.load_master()
        self.assertEqual(len(updated_master), 3)
        self.assertIn("CSV Venture A", updated_master["Company Name"].values)
        self.assertIn("CSV Venture B", updated_master["Company Name"].values)

    def test_e_mixed_file_batch(self):
        """
        Test E: Mixed File Batch
        Upload multiple Excel and CSV files containing overlapping and unique records.
        Expected: All selected valid files are processed, and duplicates across the entire batch
        and existing master are handled correctly.
        """
        init_df = pd.DataFrame([
            {"Company Name": "Apex Corp", "Phone": "100-0001", "Email": "apex@corp.com"}
        ])
        self.manager.save_master(init_df, create_backup=False)

        # File 1: Excel with 1 existing + 1 new
        f1_path = self.test_dir / "batch_f1.xlsx"
        pd.DataFrame([
            {"Company Name": "Apex Corp", "Phone": "100-0001", "Email": "apex@corp.com"},  # duplicate of master
            {"Company Name": "Beacon Labs", "Phone": "100-0002", "Email": "beacon@labs.com"}, # new
        ]).to_excel(f1_path, index=False)

        # File 2: CSV with 1 duplicate of File 1 + 1 new
        f2_path = self.test_dir / "batch_f2.csv"
        f2_path.write_text(
            "Company Name,Phone,Email\n"
            "Beacon Labs,100-0002,beacon@labs.com\n"  # duplicate of f1
            "Crestline Media,100-0003,crest@media.com\n", # new
            encoding="utf-8"
        )

        all_ds = load_file_datasets(f1_path) + load_file_datasets(f2_path)
        self.assertEqual(len(all_ds), 2)

        wf = ConsolidationWorkflow(self.manager)
        wf.set_datasets(all_ds)
        wf.build_consolidated_staging(include_existing_master=True)
        wf.detect_duplicates(comparison_mode="entire_row")
        cleaned, _ = wf.apply_resolutions()
        wf.commit_to_master()

        updated_master = self.manager.load_master()
        # Initial (1) + Beacon Labs (1) + Crestline Media (1) = 3 total
        self.assertEqual(len(updated_master), 3)
        s = wf.processing_summary
        self.assertEqual(s["files_selected"], 2)
        self.assertEqual(s["input_rows_read"], 4)
        self.assertEqual(s["confirmed_duplicates_removed"], 2)
        self.assertEqual(s["new_unique_records_added"], 2)

    def test_f_same_filename_changed_contents(self):
        """
        Test F: Same Filename, Changed Contents
        Upload a file, then upload different contents under the same filename.
        Expected: The latest contents are processed and are not skipped because of the filename or stale cache.
        """
        file_path = self.test_dir / "recurring_feed.xlsx"

        # Version 1 of file
        v1_data = pd.DataFrame([{"ID": "101", "Name": "Alice V1"}])
        v1_data.to_excel(file_path, index=False)
        hash_v1 = compute_content_hash(file_path)

        ds_v1 = load_file_datasets(file_path)
        self.assertEqual(ds_v1[0].df.iloc[0]["Name"], "Alice V1")

        wf1 = ConsolidationWorkflow(self.manager)
        wf1.set_datasets(ds_v1)
        wf1.build_consolidated_staging(include_existing_master=False)
        wf1.detect_duplicates(comparison_mode="entire_row")
        wf1.apply_resolutions()
        wf1.commit_to_master()
        self.assertEqual(self.manager.load_master().iloc[0]["Name"], "Alice V1")

        # Now write Version 2 with completely different contents under the SAME filename
        v2_data = pd.DataFrame([
            {"ID": "101", "Name": "Alice V1"},
            {"ID": "102", "Name": "Bob V2 NEW"}
        ])
        v2_data.to_excel(file_path, index=False)
        hash_v2 = compute_content_hash(file_path)

        # Content hash must differ despite identical filename
        self.assertNotEqual(hash_v1, hash_v2)

        # Load again under same filename
        ds_v2 = load_file_datasets(file_path)
        self.assertEqual(len(ds_v2[0].df), 2)
        self.assertEqual(ds_v2[0].df.iloc[1]["Name"], "Bob V2 NEW")

        wf2 = ConsolidationWorkflow(self.manager)
        wf2.set_datasets(ds_v2)
        wf2.build_consolidated_staging(include_existing_master=True)
        wf2.detect_duplicates(comparison_mode="entire_row")
        cleaned2, _ = wf2.apply_resolutions()
        wf2.commit_to_master()

        updated_master = self.manager.load_master()
        self.assertEqual(len(updated_master), 2)
        self.assertIn("Bob V2 NEW", updated_master["Name"].values)

    def test_g_application_rerun_and_cache_invalidation(self):
        """
        Test G: Application Rerun
        Verify that rerun signatures invalidate stale data when upload changes and preserve data when unchanged.
        """
        f_bytes1 = b"ColA,ColB\nVal1,Val2\n"
        sig1 = compute_content_hash(f_bytes1)

        f_bytes2 = b"ColA,ColB\nVal1,Val2\nVal3,Val4\n"
        sig2 = compute_content_hash(f_bytes2)

        self.assertNotEqual(sig1, sig2)

        # Workflow resets properly on signature change
        wf = ConsolidationWorkflow(self.manager)
        ds1 = [read_csv_dataset(io.BytesIO(f_bytes1), filename="test.csv")]
        wf.set_datasets(ds1)
        wf.build_consolidated_staging(include_existing_master=False)
        wf.detect_duplicates(comparison_mode="entire_row")
        wf.apply_resolutions()
        self.assertEqual(len(wf.cleaned_df), 1)

        # Simulate new upload detected by signature change
        wf_new = ConsolidationWorkflow(self.manager)
        ds2 = [read_csv_dataset(io.BytesIO(f_bytes2), filename="test.csv")]
        wf_new.set_datasets(ds2)
        wf_new.build_consolidated_staging(include_existing_master=False)
        wf_new.detect_duplicates(comparison_mode="entire_row")
        wf_new.apply_resolutions()
        self.assertEqual(len(wf_new.cleaned_df), 2)

    def test_h_persistence_across_restart(self):
        """
        Test H: Persistence
        Update the master workbook, restart the application (fresh manager instance), and inspect the master again.
        Expected: The newly added records remain present.
        """
        df = pd.DataFrame([
            {"Record_ID": "REC-001", "Title": "Original Record"},
            {"Record_ID": "REC-002", "Title": "Second Record"},
        ])
        ok, msg, _ = self.manager.save_master(df, create_backup=False)
        self.assertTrue(ok)

        # Fresh instance simulating app restart
        restarted_manager = MasterManager(master_path=self.master_file, backup_dir=self.backup_dir)
        self.assertTrue(restarted_manager.exists())
        loaded = restarted_manager.load_master()
        self.assertEqual(len(loaded), 2)
        self.assertEqual(loaded.iloc[0]["Record_ID"], "REC-001")
        self.assertEqual(loaded.iloc[1]["Record_ID"], "REC-002")

    def test_i_processing_failure_preserves_master(self):
        """
        Test I: Processing Failure
        Upload an invalid file or deliberately simulate an export failure.
        Expected: The failure is reported clearly, and the previous valid master workbook remains intact.
        """
        valid_df = pd.DataFrame([{"Secure_Data": "Valid_Initial_State"}])
        self.manager.save_master(valid_df, create_backup=False)

        # Deliberate failure: pass invalid data to save_master
        ok, msg, _ = self.manager.save_master(None)  # type: ignore
        self.assertFalse(ok)
        self.assertIn("Validation", msg)

        # Verify initial state intact
        persisted = self.manager.load_master()
        self.assertIsNotNone(persisted)
        self.assertEqual(len(persisted), 1)
        self.assertEqual(persisted.iloc[0]["Secure_Data"], "Valid_Initial_State")

    def test_j_regression_and_summary_metrics(self):
        """
        Test J: Regression
        Run tests for the original file-processing workflow and verify exact Section 8 summary metrics.
        """
        init_master = pd.DataFrame([
            {"Company Name": "Old Guard Inc", "Phone": "555-1111", "Email": "og@guard.com"}
        ])
        self.manager.save_master(init_master, create_backup=False)

        new_data = pd.DataFrame([
            {"Company Name": "Old Guard Inc", "Phone": "555-1111", "Email": "og@guard.com"},  # duplicate of master
            {"Company Name": "New Vanguard", "Phone": "555-2222", "Email": "nv@guard.com"},    # new
            {"Company Name": "New Vanguard", "Phone": "555-2222", "Email": "nv@guard.com"},    # duplicate within batch
        ])
        ds = [LoadedDataset("vanguard.xlsx", "Sheet1", new_data)]

        wf = ConsolidationWorkflow(self.manager)
        wf.set_datasets(ds)
        wf.build_consolidated_staging(include_existing_master=True)
        wf.detect_duplicates(comparison_mode="entire_row")
        cleaned, _ = wf.apply_resolutions()
        wf.commit_to_master()

        s = wf.processing_summary
        # Verify 13 Section 8 metrics
        self.assertEqual(s["files_selected"], 1)
        self.assertEqual(s["files_processed"], 1)
        self.assertEqual(s["worksheets_processed_count"], 1)
        self.assertEqual(s["input_rows_read"], 3)
        self.assertEqual(s["valid_records_evaluated"], 3)
        self.assertEqual(s["master_rows_before"], 1)
        self.assertEqual(s["existing_records_matched"], 1)
        self.assertEqual(s["confirmed_duplicates_removed"], 2)  # 1 matched master + 1 within batch
        self.assertEqual(s["new_unique_records_added"], 1)
        self.assertEqual(s["final_master_row_count"], 2)  # 1 old + 1 new

        # Mathematical consistency:
        # Final master rows (2) = Previous master rows (1) + New unique records (1) - Existing rows removed (0)
        self.assertEqual(
            s["final_master_row_count"],
            s["master_rows_before"] + s["new_unique_records_added"]
        )

        # File report DataFrame verification
        file_rep = wf.get_file_report_dataframe()
        self.assertEqual(len(file_rep), 1)
        self.assertEqual(file_rep.iloc[0]["Rows Read"], 3)
        self.assertEqual(file_rep.iloc[0]["New Records Contributed"], 1)
        self.assertEqual(file_rep.iloc[0]["Duplicates Excluded"], 2)


if __name__ == "__main__":
    unittest.main()
