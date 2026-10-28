# ICP Data Normalization Report

**Prepared:** 13 October 2026  
**Scope:** Normalization, validation, deduplication, and provenance of the Indian digital-marketing-agency CSV data and public phone fields.

## Executive summary

The agency datasets use a consistent company-name set, reject duplicate normalized company names, and store usable phone values in a consistent digit-based format. Phone values are not guessed: a record with no usable number keeps the phone and phone-source fields blank. Spreadsheet formula prefixes are removed from phone values, malformed and obvious repeated-digit placeholders are rejected, and repeated phone values within a company are deduplicated.

## Dataset snapshot and measured results

The CSV files currently present in the repository were read directly when this report was prepared:

| Measure | Current result |
|---|---:|
| Rows in `indian-digital-marketing-agencies.csv` | 452 |
| Rows in `indian-digital-marketing-agencies-enriched.csv` | 452 |
| Unique normalized company names in each file | 452 |
| Company-name sets match between files | Yes |
| Enriched rows with at least one public phone | 445 |
| Enriched rows with no usable public phone | 7 |
| Total normalized phone values across phone-bearing rows | 512 |
| Malformed or placeholder phone values detected | 0 |
| Rows with repeated phone values within the row | 0 |
| Phone/address source fields containing Bing search-result URLs | 0 |
| Enriched rows with a Clutch company profile | 442 |
| Enriched rows with workflow evidence | 204 |
| Fit levels in the current enriched file | 54 Review; 398 Low fit |
| Records with a sourced business start year | 1 |

**Dataset-version note:** Some earlier conversation summaries referred to an 842-row dataset. That count does not match the CSV files currently present in the repository, which each contain 452 rows. The figures in this report reflect the files actually inspected for this report. If 842 rows are expected, reconcile or restore the intended dataset version before using these counts operationally.

## Normalization performed

### Company names and duplicates

- Company names are compared after Unicode normalization, case folding, and removal of punctuation/spacing differences.
- Both current CSVs contain 452 distinct normalized company names, and their normalized name sets match.
- Directory imports also skip an existing website domain or a matching normalized company name and India location to reduce alternate-domain duplicates.

### Phone numbers

- Display punctuation and whitespace are removed while preserving an explicit leading `+`.
- The tool does not infer a country calling code for a number that does not include one.
- Values with fewer than 7 digits, more than 15 digits, a misplaced plus sign, or an obvious repeated-digit placeholder are rejected.
- Formula-safety apostrophes are stripped from imported values; repeated normalized numbers within one company are deduplicated.
- A phone number is retained only when there is a corresponding phone-source value. Missing or invalid numbers remain blank rather than being generated or filled from assumptions.
- Validation of the current enriched CSV found 512 phone values across 445 rows, no malformed/placeholder values, and no repeated values within a row.

### Source and location fields

- Phone and address sources are represented in separate columns from the values they support.
- The current source fields contain no Bing search-result URLs. A direct company or profile source is more useful for review than a broad search-results page.
- Location precision is labeled separately. Most rows state that the directory provides a city/office location but not a street address; other records carry a qualification such as country-only or city not verified.
- The 442 Clutch-profile records retain links to the profile and directory pages. Nine records have no Clutch company profile.
- The enriched list includes business start year, calendar-year age estimate, and start-year source columns. The only currently populated start year is 1969 for the Lintas India operating history associated with the MullenLowe Lintas Group record; the estimate is 57 years as of 2026 and does not represent the age of the current TBWA\\Lintas brand.

## Validation and data-use guidance

- The repository includes phone-normalization tests for formatting, malformed values, placeholders, and deduplication.
- Dataset-quality tests check company uniqueness, matching company-name sets, phone normalization, and phone/source consistency.
- Fit scores and evidence fields should be interpreted according to their cited source and stated precision. A normalized value is not necessarily independently verified.
- Phone formatting does not establish that a number is active, belongs to the named company, or reaches a decision-maker.
- Directory-listed services and contactability do not demonstrate buying intent. Fit scores remain heuristic research priorities.

## Known limitations and recommended controls

1. Reconcile the 452-row files with any separate 842-row copy before downstream imports or reporting; avoid merging by row position.
2. Continue deduplicating by normalized company identity and website domain, while preserving legitimate distinct subsidiaries and locations for human review.
3. Record retrieval date, source type, and direct source URL for every imported field where available.
4. Keep phone numbers as text in spreadsheets and exports so spreadsheet software does not reformat them.
5. Do not replace blank phones or uncertain locations with inferred values. Capture uncertainty in the precision/source field.
6. Periodically re-check public contact details before outreach; normalization is not live validation.

## Related implementation and tests

- [Phone normalization helper](./public/phone-numbers.js)
- [Phone normalization tests](./tests/phone-numbers.test.js)
- [Prospect CSV quality tests](./tests/prospect-data.test.js)
- [Enriched agency dataset](./indian-digital-marketing-agencies-enriched.csv)
- [Base agency dataset](./indian-digital-marketing-agencies.csv)
- [Project README](./README.md)
