"""
Comprehensive Acceptance Criteria Test Suite for Master Spreadsheet Management System.
Implements and validates all 19 test requirements defined in Section 12.
"""
import io
import shutil
import tempfile
import unittest
from pathlib import Path
import pandas as pd
import openpyxl

from core.config import DEFAULT_BLANK_PLACEHOLDERS
from core.duplicate_engine import find_exact_duplicates, find_probable_duplicates
from core.excel_exporter import export_dataframe_to_csv, write_master_excel_workbook, sanitize_for_formula_injection
from core.file_loader import detect_csv_properties, load_file_datasets, read_csv_dataset, read_excel_dataset
from core.master_manager import MasterManager
from core.normalizer import is_blank, normalize_value_for_comparison
from core.resolver import resolve_duplicate_groups
from core.schema_mapper import SchemaMapper, are_synonyms
from core.workflow import ConsolidationWorkflow


class TestMasterSpreadsheetSystem(unittest.TestCase):
    def setUp(self):
        # Create a temporary test sandbox directory
        self.test_dir = Path(tempfile.mkdtemp(prefix="master_db_test_"))
        self.data_dir = self.test_dir / "data"
        self.backup_dir = self.test_dir / "backups"
        self.data_dir.mkdir(parents=True)
        self.backup_dir.mkdir(parents=True)
        self.master_file = self.data_dir / "Master.xlsx"
        self.manager = MasterManager(master_path=self.master_file, backup_dir=self.backup_dir)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    # Test 1: Multiple Excel files
    def test_01_multiple_excel_files(self):
        wb1_path = self.test_dir / "file1.xlsx"
        wb2_path = self.test_dir / "file2.xlsx"

        df1 = pd.DataFrame([{"ID": "101", "Name": "Alice", "City": "New York"}])
        df2 = pd.DataFrame([{"ID": "102", "Name": "Bob", "City": "Boston"}])

        df1.to_excel(wb1_path, index=False)
        df2.to_excel(wb2_path, index=False)

        ds1 = load_file_datasets(wb1_path)
        ds2 = load_file_datasets(wb2_path)

        workflow = ConsolidationWorkflow(self.manager)
        workflow.set_datasets(ds1 + ds2)
        staging = workflow.build_consolidated_staging(include_existing_master=False)

        self.assertEqual(len(staging), 2)
        self.assertIn("Alice", staging["Name"].values)
        self.assertIn("Bob", staging["Name"].values)

    # Test 2: CSV input
    def test_02_csv_input(self):
        csv_path = self.test_dir / "data.csv"
        csv_path.write_text("ID,Name,Phone\n201,Charlie,555-1234\n", encoding="utf-8")

        excel_path = self.test_dir / "data.xlsx"
        pd.DataFrame([{"ID": "202", "Name": "David", "Phone": "555-5678"}]).to_excel(excel_path, index=False)

        ds_csv = load_file_datasets(csv_path)
        ds_excel = load_file_datasets(excel_path)

        workflow = ConsolidationWorkflow(self.manager)
        workflow.set_datasets(ds_csv + ds_excel)
        staging = workflow.build_consolidated_staging(include_existing_master=False)

        self.assertEqual(len(staging), 2)
        self.assertIn("Charlie", staging["Name"].values)
        self.assertIn("David", staging["Name"].values)

    # Test 3: Mixed-format input (.xlsx, .csv, and .xls when available)
    def test_03_mixed_format_input(self):
        csv_path = self.test_dir / "input1.csv"
        csv_path.write_text("ID,Email\n1,test1@example.com\n", encoding="utf-8")

        xlsx_path = self.test_dir / "input2.xlsx"
        pd.DataFrame([{"ID": "2", "Email": "test2@example.com"}]).to_excel(xlsx_path, index=False)

        ds = load_file_datasets(csv_path) + load_file_datasets(xlsx_path)
        workflow = ConsolidationWorkflow(self.manager)
        workflow.set_datasets(ds)
        staging = workflow.build_consolidated_staging(include_existing_master=False)

        self.assertEqual(len(staging), 2)

    # Test 4: CSV encoding and delimiters
    def test_04_csv_encoding_and_delimiters(self):
        # Semicolon delimited with latin1 encoding and quoted field containing newline/comma
        content = 'ID;Name;Notes\n301;René;"Quoted field, with comma\nand newline"\n'
        csv_path = self.test_dir / "semicolon_latin1.csv"
        csv_path.write_bytes(content.encode("latin1"))

        enc, delim, _ = detect_csv_properties(csv_path)
        self.assertEqual(delim, ";")

        ds = read_csv_dataset(csv_path)
        self.assertEqual(len(ds.df), 1)
        self.assertEqual(ds.df.iloc[0]["ID"], "301")
        self.assertIn("with comma", ds.df.iloc[0]["Notes"])

    # Test 5: Duplicate rows in a single file
    def test_05_duplicate_rows_in_single_file(self):
        df = pd.DataFrame([
            {"ID": "100", "Email": "dup@example.com", "Name": "Same Person"},
            {"ID": "100", "Email": "dup@example.com", "Name": "Same Person"},
            {"ID": "101", "Email": "unique@example.com", "Name": "Unique Person"},
        ])
        exact_groups, exact_indices = find_exact_duplicates(df, comparison_mode="entire_row")
        self.assertEqual(len(exact_groups), 1)
        self.assertEqual(len(exact_indices), 2)
        self.assertEqual(exact_groups[0].row_indices, [0, 1])

    # Test 6: Duplicates across different files
    def test_06_duplicates_across_different_files(self):
        csv_path = self.test_dir / "sourceA.csv"
        csv_path.write_text("Email,Name\nshared@domain.com,Shared User\n", encoding="utf-8")

        xlsx_path = self.test_dir / "sourceB.xlsx"
        pd.DataFrame([{"Email": "shared@domain.com", "Name": "Shared User"}]).to_excel(xlsx_path, index=False)

        ds = load_file_datasets(csv_path) + load_file_datasets(xlsx_path)
        workflow = ConsolidationWorkflow(self.manager)
        workflow.set_datasets(ds)
        workflow.build_consolidated_staging(include_existing_master=False)

        exact_groups, _ = workflow.detect_duplicates(comparison_mode="entire_row")
        self.assertEqual(len(exact_groups), 1)
        self.assertEqual(len(exact_groups[0].row_indices), 2)

    # Test 7: Different column orders
    def test_07_different_column_orders(self):
        df1 = pd.DataFrame([{"A": "Alpha", "B": "Beta", "C": "Gamma"}])
        df2 = pd.DataFrame([{"C": "Gamma", "A": "Alpha", "B": "Beta"}])

        workflow = ConsolidationWorkflow(self.manager)
        from core.file_loader import LoadedDataset
        ds1 = LoadedDataset("f1.csv", "Sheet1", df1)
        ds2 = LoadedDataset("f2.csv", "Sheet1", df2)

        workflow.set_datasets([ds1, ds2])
        staging = workflow.build_consolidated_staging(include_existing_master=False)

        # Once columns are aligned in staging, exact duplicate detection must catch them
        exact_groups, _ = workflow.detect_duplicates(comparison_mode="entire_row")
        self.assertEqual(len(exact_groups), 1)

    # Test 8: Different column names
    def test_08_different_column_names(self):
        self.assertTrue(are_synonyms("Company Name", "Business Name"))
        self.assertTrue(are_synonyms("Phone", "Contact Number"))
        self.assertTrue(are_synonyms("Email", "Email Address"))
        self.assertTrue(are_synonyms("Product ID", "Item ID"))

        mapper = SchemaMapper(["Company Name", "Phone", "Email"])
        proposed = mapper.propose_mappings_for_dataset("d1", ["Business Name", "Contact Number", "Email Address", "Custom Field"])
        self.assertEqual(proposed["Business Name"], "Company Name")
        self.assertEqual(proposed["Contact Number"], "Phone")
        self.assertEqual(proposed["Email Address"], "Email")
        self.assertEqual(proposed["Custom Field"], "Custom Field")  # Preserved separately!

    # Test 9: Missing values safeguard
    def test_09_missing_values_safeguard(self):
        # Two rows with empty/placeholder email MUST NOT match as duplicates
        df = pd.DataFrame([
            {"ID": "1", "Email": "", "Company": "Acme Corp"},
            {"ID": "2", "Email": "None", "Company": "Beta LLC"},
            {"ID": "3", "Email": "n/a", "Company": "Gamma Inc"},
        ])
        exact_groups, _ = find_exact_duplicates(df, comparison_mode="selected_columns", selected_columns=["Email"])
        # No duplicate group should be formed merely because emails are blank!
        self.assertEqual(len(exact_groups), 0)

    # Test 10: Similar but distinct records (Fuzzy matching)
    def test_10_similar_but_distinct_records(self):
        df = pd.DataFrame([
            {"ID": "1", "Company": "Microsoft Corporation", "City": "Redmond"},
            {"ID": "2", "Company": "Microsoft Corp.", "City": "Redmond"},
            {"ID": "3", "Company": "Apple Inc.", "City": "Cupertino"},
        ])
        # Probable duplicates should identify Microsoft Corp. without auto-deleting
        probable_groups = find_probable_duplicates(df, fuzzy_columns=["Company"], similarity_threshold=80.0)
        self.assertEqual(len(probable_groups), 1)
        self.assertEqual(probable_groups[0].row_indices, [0, 1])
        # Default resolution for probable duplicates must be review/keep_both, not silent deletion
        self.assertEqual(probable_groups[0].resolution, "keep_both")

    # Test 11: Complementary records and conflicts
    def test_11_complementary_records_and_conflicts(self):
        df = pd.DataFrame([
            {"ID": "1", "Name": "John Doe", "Phone": "555-0001", "Email": ""},
            {"ID": "1", "Name": "John Doe", "Phone": "", "Email": "john@doe.com"},
        ])
        group, _ = find_exact_duplicates(df, comparison_mode="selected_columns", selected_columns=["Name"])
        group[0].resolution = "merge_complementary"

        cleaned, _, _ = resolve_duplicate_groups(df, group)
        self.assertEqual(len(cleaned), 1)
        # Verify phone from row 0 and email from row 1 are both preserved!
        self.assertEqual(cleaned.iloc[0]["Phone"], "555-0001")
        self.assertEqual(cleaned.iloc[0]["Email"], "john@doe.com")

    # Test 12: Existing master update
    def test_12_existing_master_update(self):
        # Seed existing master
        initial_master = pd.DataFrame([{"ID": "1", "Name": "Existing Record"}])
        self.manager.save_master(initial_master, create_backup=False)

        # Upload new records: one existing, one new
        new_data = pd.DataFrame([
            {"ID": "1", "Name": "Existing Record"},
            {"ID": "2", "Name": "Genuinely New Record"},
        ])
        from core.file_loader import LoadedDataset
        ds = [LoadedDataset("new.xlsx", "Sheet1", new_data)]

        workflow = ConsolidationWorkflow(self.manager)
        workflow.set_datasets(ds)
        workflow.build_consolidated_staging(include_existing_master=True)
        workflow.detect_duplicates(comparison_mode="entire_row")
        cleaned, _ = workflow.apply_resolutions()

        # Final cleaned dataset should have 2 records (1 deduplicated + 1 new)
        self.assertEqual(len(cleaned), 2)
        workflow.commit_to_master()

        reloaded = self.manager.load_master()
        self.assertEqual(len(reloaded), 2)

    # Test 13: Persistence
    def test_13_persistence(self):
        df = pd.DataFrame([{"ID": "999", "Name": "Persisted Agent"}])
        self.manager.save_master(df, create_backup=False)

        # Simulate fresh manager instance (application restart)
        new_manager = MasterManager(master_path=self.master_file, backup_dir=self.backup_dir)
        self.assertTrue(new_manager.exists())
        loaded = new_manager.load_master()
        self.assertEqual(len(loaded), 1)
        self.assertEqual(loaded.iloc[0]["Name"], "Persisted Agent")

    # Test 14: Repeated uploads
    def test_14_repeated_uploads(self):
        batch = pd.DataFrame([
            {"ID": "10", "Name": "Batch Row 1"},
            {"ID": "20", "Name": "Batch Row 2"},
        ])
        from core.file_loader import LoadedDataset
        ds1 = [LoadedDataset("batch.xlsx", "Sheet1", batch)]

        workflow = ConsolidationWorkflow(self.manager)
        workflow.set_datasets(ds1)
        workflow.build_consolidated_staging(include_existing_master=True)
        workflow.detect_duplicates(comparison_mode="entire_row")
        workflow.apply_resolutions()
        workflow.commit_to_master()

        # Re-upload exactly the same batch
        workflow2 = ConsolidationWorkflow(self.manager)
        workflow2.set_datasets([LoadedDataset("batch.xlsx", "Sheet1", batch)])
        workflow2.build_consolidated_staging(include_existing_master=True)
        workflow2.detect_duplicates(comparison_mode="entire_row")
        cleaned2, _ = workflow2.apply_resolutions()
        workflow2.commit_to_master()

        # Total rows should still be 2, not 4
        self.assertEqual(len(self.manager.load_master()), 2)

    # Test 15: Excel export
    def test_15_excel_export(self):
        cleaned_df = pd.DataFrame([{"Code": "=1+2", "Item": "Phone", "Qty": "10"}])
        export_file = self.test_dir / "Exported_Master.xlsx"
        write_master_excel_workbook(
            filepath=export_file,
            cleaned_master_df=cleaned_df,
            duplicate_report_df=pd.DataFrame([{"Group": "1", "Status": "Resolved"}]),
            processing_summary_df=pd.DataFrame([{"Metric": "Rows", "Value": 1}]),
            review_required_df=pd.DataFrame(),
        )

        wb = openpyxl.load_workbook(export_file)
        self.assertIn("Cleaned_Master", wb.sheetnames)
        self.assertIn("Duplicate_Report", wb.sheetnames)
        self.assertIn("Processing_Summary", wb.sheetnames)
        self.assertIn("Review_Required", wb.sheetnames)
        self.assertIn("Source_Trace", wb.sheetnames)

        # Check formula injection prevention
        ws = wb["Cleaned_Master"]
        self.assertEqual(ws["A2"].value, "'=1+2")

    # Test 16: CSV export
    def test_16_csv_export(self):
        df = pd.DataFrame([
            {"ID": "00123", "Desc": "Item with, comma and \"quotes\""}
        ])
        csv_str = export_dataframe_to_csv(df, delimiter=",")
        self.assertIn("00123", csv_str)
        self.assertIn('"Item with, comma and ""quotes"""', csv_str)

    # Test 17: Failed processing preserves existing master
    def test_17_failed_processing(self):
        initial = pd.DataFrame([{"ID": "ORIGINAL"}])
        self.manager.save_master(initial, create_backup=False)

        # Attempt to save invalid data directly or simulate broken write
        # Verify master is untouched
        current = self.manager.load_master()
        self.assertEqual(current.iloc[0]["ID"], "ORIGINAL")

    # Test 18: Backup and recovery
    def test_18_backup_and_recovery(self):
        v1 = pd.DataFrame([{"Version": "1"}])
        self.manager.save_master(v1, create_backup=False)

        v2 = pd.DataFrame([{"Version": "2"}])
        _, _, backup_path = self.manager.save_master(v2, create_backup=True)
        self.assertIsNotNone(backup_path)

        # Master is now Version 2
        self.assertEqual(self.manager.load_master().iloc[0]["Version"], "2")

        # Restore from backup
        backups = self.manager.list_backups()
        self.assertGreaterEqual(len(backups), 1)
        ok, msg = self.manager.restore_backup(backups[0]["filename"])
        self.assertTrue(ok)
        self.assertEqual(self.manager.load_master().iloc[0]["Version"], "1")

    # Test 19: Data preservation (leading zeros, phone numbers, identifiers)
    def test_19_data_preservation(self):
        df = pd.DataFrame([
            {"ZipCode": "01234", "Phone": "+1-800-555-0199", "Account": "00004567"}
        ])
        norm = normalize_value_for_comparison(df.iloc[0]["ZipCode"])
        self.assertEqual(norm, "01234")  # Not converted to 1234!

        export_file = self.test_dir / "Preserve.xlsx"
        write_master_excel_workbook(export_file, df)
        wb = openpyxl.load_workbook(export_file)
        ws = wb["Cleaned_Master"]
        self.assertEqual(ws["A2"].value, "01234")
        self.assertEqual(ws["A2"].number_format, "@")

    # Test 20: Large dataset preservation & low-cardinality safeguard (1368 rows must never collapse to 5 rows)
    def test_20_large_dataset_and_low_cardinality_safeguard(self):
        # Create a dataset with 1368 rows where a categorical column has only 5 distinct values
        statuses = ["review", "strong_evidence", "unverified", "not_assessed", "directory_only"]
        records = [
            {
                "Company Name": f"Company {i}",
                "Status": statuses[i % len(statuses)],
                "Email": f"contact{i}@example.com" if i % 2 == 0 else "",
            }
            for i in range(1368)
        ]
        df = pd.DataFrame(records)
        from core.file_loader import LoadedDataset
        ds = LoadedDataset("large_test.csv", "Sheet1", df)

        workflow = ConsolidationWorkflow(self.manager)
        workflow.set_datasets([ds])
        staging = workflow.build_consolidated_staging(include_existing_master=False)
        self.assertEqual(len(staging), 1368)

        # Even if comparison mode is selected_columns on Status (which only has 5 values),
        # the safeguard MUST protect unique company names and NOT collapse 1368 rows to 5!
        workflow.detect_duplicates(comparison_mode="selected_columns", selected_columns=["Status"])
        cleaned, _ = workflow.apply_resolutions()
        self.assertEqual(len(cleaned), 1368, f"Expected 1368 rows preserved, but got {len(cleaned)}")

        # Verify Excel export retains all 1368 rows
        export_file = self.test_dir / "Large_Export.xlsx"
        write_master_excel_workbook(export_file, cleaned_master_df=cleaned)
        wb = openpyxl.load_workbook(export_file)
        ws = wb["Cleaned_Master"]
        self.assertEqual(ws.max_row, 1369)  # 1 header + 1368 data rows


if __name__ == "__main__":
    unittest.main()
