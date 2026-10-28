# Wikipedia ICP Import Report

**Prepared:** 14 October 2026  
**Scope:** Public Wikipedia pages and category listings reviewed for Indian digital-marketing and advertising company candidates.

## Result

One Wikipedia-sourced candidate was added to both agency CSVs:

| Company | India location | Fit estimate | Contact data |
|---|---|---:|---|
| MullenLowe Lintas Group (Lintas India operating history) | Mumbai, India | Founded/operating since 1969; approximately 57 years as of 2026 | 12/100 — Low fit; no phone number or company website URL imported |

The candidate is labeled as a conservative, rule-based estimate, not as purchase intent or a verified current profile. The Wikipedia article describes the business as an Indian advertising and marketing-communications company and reports approximately 600 employees and 13 offices across four Indian cities as of July 2023. The 2023 scale information may be stale. The estimate awards 8 points for India presence and 4 for multiple offices; no Dakini workflow, integration use, buying intent, or public phone is evidenced by the imported source.

The Wikipedia article was already absent from the existing company names. Its direct article URL is recorded in the source fields in both CSVs. Wikipedia says Lintas India began operating in Mumbai in 1969. The age refers to that Lintas India operating history, not the age of the MullenLowe brand: the article also reports the MullenLowe network's dissolution in 2025 and TBWA\\Lintas taking effect in January 2026.

## Source review and exclusions

Wikipedia's `Category:Digital marketing companies of India` listed four company pages:

- [MullenLowe Lintas Group](https://en.wikipedia.org/wiki/MullenLowe_Lintas_Group) — included as an Indian advertising/marketing-communications company.
- [InMobi](https://en.wikipedia.org/wiki/InMobi) — not added to the digital-marketing-agency list; its article describes a mobile advertising technology platform/company rather than an agency prospect.
- [PubMatic](https://en.wikipedia.org/wiki/Pubmatic) — not added to the agency list; its article describes online advertising software and services.
- [Jade Magnet](https://en.wikipedia.org/wiki/Jade_Magnet) — not added as an active prospect; its article uses historical wording (“was”) and describes a crowdsourcing platform. Current operating status was not established by Wikipedia.

The `Category:Advertising agencies of India` review also surfaced government advertising bodies and a `Cell 18` page with no article extract. Government agencies are outside the commercial prospect list, and the stub page did not provide enough company evidence for import.

This deliberately small result reflects Wikipedia's limited category coverage and the requirement not to invent contact details or current business status. It is not an exhaustive census of Indian marketing agencies.

## Attribution and limitations

Wikipedia article content is available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The imported record links to the article and this report identifies the source; see the Wikipedia article and its revision history for contributor attribution. The entry is a paraphrase of brief factual information, not a reproduction of the article.

Wikipedia is a discovery source, not authoritative proof of current registration, active trading, service availability, office count, contact information, or buying intent. Verify material facts against current company-controlled sources before outreach. No phone number was inferred.

## Files updated

- [Base agency CSV](./indian-digital-marketing-agencies.csv)
- [Enriched agency CSV](./indian-digital-marketing-agencies-enriched.csv)
- [Prospect dataset validation test](./tests/prospect-data.test.js)
- [README](./README.md)
