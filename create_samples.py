"""
Generate sample spreadsheets to demonstrate and test the Master Spreadsheet Management System.
"""
from pathlib import Path
import pandas as pd

SAMPLE_DIR = Path(__file__).parent / "sample_data"
SAMPLE_DIR.mkdir(parents=True, exist_ok=True)

# 1. companies_batch1.xlsx (Multiple Sheets)
sheet1_data = [
    {"Company Name": "Acme Industrial", "Phone": "555-0100", "Email": "contact@acme.com", "City": "Chicago", "Postal Code": "60601"},
    {"Company Name": "Globex Corporation", "Phone": "555-0200", "Email": "info@globex.com", "City": "Springfield", "Postal Code": "62701"},
    {"Company Name": "Initech Systems", "Phone": "555-0300", "Email": "support@initech.com", "City": "Austin", "Postal Code": "78701"},
    {"Company Name": "Stark Enterprises", "Phone": "555-0400", "Email": "stark@enterprise.com", "City": "New York", "Postal Code": "10001"},
]

sheet2_data = [
    {"Company Name": "Umbrella Health", "Phone": "555-0500", "Email": "umbrella@health.com", "City": "Raccoon City", "Postal Code": "45201"},
    {"Company Name": "Initech Systems", "Phone": "555-0300", "Email": "support@initech.com", "City": "Austin", "Postal Code": "78701"},  # Exact Duplicate within file across sheets
]

with pd.ExcelWriter(SAMPLE_DIR / "companies_batch1.xlsx", engine="openpyxl") as writer:
    pd.DataFrame(sheet1_data).to_excel(writer, sheet_name="Active_Companies", index=False)
    pd.DataFrame(sheet2_data).to_excel(writer, sheet_name="Pending_Companies", index=False)

# 2. customers.csv (Different column headers: Business Name, Contact Number, Email Address)
customers_csv = """Business Name,Contact Number,Email Address,City,Annual Revenue
Acme Industrial,555-0100,contact@acme.com,Chicago,$1200000
Wayne Technologies,555-0600,bruce@wayne.com,Gotham,$50000000
Globex Corp.,555-0200,info@globex.com,Springfield,$8500000
Cyberdyne Systems,555-0700,miles@cyberdyne.com,Sunnyvale,$25000000
"""
(SAMPLE_DIR / "customers.csv").write_text(customers_csv, encoding="utf-8")

# 3. partners_semicolon.csv (Semicolon delimiter, quoted values, complementary data for Stark Enterprises)
partners_csv = """Company Name;Phone;Email;Website;Notes
Stark Enterprises;555-0400;;https://stark.com;"Key defense partner; priority account"
Soylent Food Corp;555-0800;orders@soylent.com;https://soylent.com;"Consumer goods"
Massive Dynamic;555-0900;inquiry@massivedynamic.com;https://massivedynamic.com;"R&D lab"
"""
(SAMPLE_DIR / "partners_semicolon.csv").write_text(partners_csv, encoding="utf-8")

print(f"Sample data generated in {SAMPLE_DIR}")
