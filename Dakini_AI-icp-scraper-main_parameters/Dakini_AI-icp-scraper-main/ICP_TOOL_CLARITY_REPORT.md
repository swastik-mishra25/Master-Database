# ICP Tool Improvement Report: Clarity in Data

**Prepared:** 13 October 2026  
**Scope:** Changes made to make prospect evidence, ICP fit, data provenance, and review status easier to understand in the Dakini AI ICP tool.

## Executive summary

The ICP tool was improved to distinguish what a source actually states from what the application infers. Prospect fit and company-website evidence are shown as separate assessments; source links, scanned-page details, rule-based score components, and qualification caveats are available for review. The result is a more transparent research and triage tool—not an independent verification service or a predictor of purchase intent.

## Problem addressed

An ICP score alone can obscure the difference between:

- A fact explicitly stated on a company page.
- A signal extracted or inferred from that page.
- A listing copied from a third-party directory.
- Information that was not found.
- A heuristic assessment of potential relevance to Dakini AI.

Without those distinctions, users may mistake a directory listing, a public contact channel, or a high fit score for proof that a company is legitimate, actively seeking a vendor, or ready to buy.

## Improvements made

### 1. Separate fit from company-website evidence

The app presents Dakini ICP fit and legitimacy evidence as separate concepts. The fit score estimates how closely the available business information matches Dakini AI use cases. The legitimacy assessment evaluates first-party website evidence and is not incorporated into the fit score as if it were legal verification.

Strong website evidence is deliberately gated on multiple types of first-party evidence, including company identity, marketing-business content, public contact evidence, company-profile evidence, and distinct company-domain pages. Search-result snippets and third-party directory listings cannot supply that first-party proof. Weaker candidates remain labeled for review rather than being presented as established companies.

Company identity matching requires corroboration beyond a single overlapping word for multi-word brands. A single distinctive name token must appear both in the homepage title and opening text unless an exact brand-aligned domain also corroborates the homepage. This lowers false-positive identity matches; it remains a heuristic rather than legal verification.

### 2. Show evidence and provenance with the result

Prospect details expose the evidence basis, check time, number of pages scanned, source excerpts, and source links. Directory-only entries are labeled as such. Search-result URLs are identified as search references rather than direct company listings. Users can inspect the rule-based score breakdown and see why a record received its status.

### 3. Explain what scores do—and do not—mean

The interface and documentation explain the fit-score components: service fit, operating scale, India/language fit, integration readiness, buying/growth signals, and public contactability. They also state that scores are research priorities, not calibrated probabilities or evidence of buying intent. Suggested Dakini workflows are hypotheses to validate, not confirmed company needs.

### 4. Make weak evidence reviewable

Candidates that do not meet the strong-evidence threshold are retained for review instead of being silently promoted or discarded. Directory-only records can be revisited by a website crawl to add first-party evidence. UI filters let the operator separate strong website evidence, review-needed, unverified, and directory-only records.

### 5. Clarify preprocessing output

The prospect detail view shows how deterministic preprocessing selected and ranked source-linked text segments before the rules-based extractor evaluated them. This makes context selection more inspectable; it is not an LLM analysis or a guarantee that the selected evidence is complete.

## Current dataset snapshot

The two prospect CSV files present in the repository when this report was prepared each contain **451 rows**. The enriched file has **54 Review** and **397 Low fit** records. These counts describe the present files, not a guarantee that every record has independently verified company operations.

The current dataset also contains 442 Clutch company profiles and nine records without a Clutch profile. There are 204 rows with workflow evidence. A missing workflow signal means the file does not record that evidence; it should not be interpreted as proof that a company has no such workflow.

## Benefits

- Operators can audit a score against its cited excerpts and source pages.
- Directory-only data is less likely to be mistaken for first-party company verification.
- Potential-fit hypotheses, explicit signals, and missing evidence are easier to distinguish.
- Review effort can be prioritized without describing a heuristic as certainty.
- Weak candidates can be kept available for human review and possible later enrichment.

## Limitations and risks

- The legitimacy result is a content-based heuristic. It does not verify government registration, legal status, current trading activity, ownership, or whether a phone number is active.
- Company-controlled website content is still untrusted and can be inaccurate or misleading.
- Search coverage, robots rules, inaccessible pages, and website design affect what can be observed.
- Rules and keyword signals can miss synonyms, multilingual content, or relevant information expressed unusually.
- Public contact information may be a general business channel rather than a decision-maker's contact.
- Fit tiers are not calibrated against historical conversion outcomes; they do not establish a prospect's intent to purchase.

## Recommended next steps

1. Continue human review before using any record for outreach.
2. Keep first-party website evidence, directory evidence, and search references visibly distinct in future imports and exports.
3. Re-crawl stale records on a defined schedule and retain a checked-at timestamp and source URL for each material field.
4. Measure score quality against a manually reviewed sample and eventual outreach outcomes before changing thresholds or calling the score predictive.
5. Track missing evidence explicitly rather than silently treating it as a negative signal.

## Related implementation

- [Prospect interface](./public/app.js)
- [Platform page and scoring guide](./public/platform.html)
- [Legitimacy evidence assessment](./company-legitimacy.js)
- [Preprocessing implementation](./predictive-preprocessing.js)
- [Project architecture](./ARCHITECTURE.md)
- [Project README and scoring rubric](./README.md)
