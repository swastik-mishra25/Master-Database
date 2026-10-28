# TechBehemoths Agency Data Import

## Result

Added 359 new digital-marketing agency candidates to both agency CSV files on 2026-10-14. The files now contain 811 unique normalized company names: the prior 452 records plus these 359 additions.

## Source and selection

- India digital-marketing directory: <https://techbehemoths.com/companies/digital-marketing/india>
- Company profile URLs are recorded for every new row in `Company-level directory profile`.
- The directory category URL is recorded in `Directory/source URL`.
- Candidates were drawn from the first 18 listing pages. Selection required an India location and a digital-marketing/SEO-related service tag or matching directory description.
- Names were normalized and deduplicated against the existing dataset and within the import; profile URLs were also deduplicated.

## Evidence and limitations

These are third-party directory listings, not independently verified or first-party-confirmed businesses. The directory establishes only that a listing is present in its India digital-marketing category and gives a directory-reported location and service tags. A directory listing does not prove current operation, legal status, service delivery, or Dakini AI buying intent.

The 359 new rows each have a conservative 23/100 (`Low fit`) score: 15 points for the directory's digital-marketing category and 8 points for its India-listed location. No points are assigned for company scale, integration readiness, buying intent, or public contactability. This heuristic is not a purchase probability.

The listing cards did not provide phone numbers, first-party company websites, or supported business start years. Those fields are blank for all 359 additions; none were inferred. The existing dataset's 445 usable sourced phone numbers remain unchanged, leaving 366 of 811 total records without a usable phone number.
