# Dakini AI — Work Report

**Date:** 12 October 2026

## Summary

Yesterday's work covered the Dakini AI landing page, research into predictive preprocessing for LLM applications, and a preprocessing feature for the existing ICP prospect-research tool.

## 1. Dakini AI landing page

- Replaced the root page with a product landing page describing Dakini AI's knowledge and workflow capabilities.
- Added landing-page styling, product features, team use cases, workflow steps, and calls to action.
- Preserved the existing ICP prospect-research platform at `/platform.html`.

Files:

- [public/index.html](./public/index.html)
- [public/landing.css](./public/landing.css)
- [public/platform.html](./public/platform.html)

The app was started locally, and both the landing page and platform route were fetched successfully.

## 2. Predictive preprocessing research

Reviewed the term “predictive preprocessing” and how it relates to LLM applications. The report explains that it is not a single standardized LLM stage; more precise terms include **query-aware context preparation**, **retrieval and reranking**, and **prompt construction**.

The main conclusion was that selecting and structuring relevant information before an LLM call may improve relevance, grounding, and efficiency for large or fragmented business data. It does not guarantee correctness: retrieval may omit important evidence, while extra processing can increase latency and cost. Dakini should validate benefits with task-specific evaluation before claiming an accuracy improvement.

Research references are included in the detailed report.

## 3. Context preprocessing in the ICP scraper

Added a deterministic, rules-based preprocessing step that prepares crawled company-site text before the existing evidence extractor and prospect scorer. It:

- Normalizes text and removes selected boilerplate.
- Deduplicates repeated snippets.
- Ranks snippets against configured ICP criteria and Dakini workflow signals.
- Selects bounded context while retaining source references.
- Reserves a homepage overview snippet when available.
- Falls back to deduplicated source-order text when no known relevance signals match.

The prospect detail UI exposes selected sources and signals, along with context-selection metrics.

Files:

- [predictive-preprocessing.js](./predictive-preprocessing.js)
- [server.js](./server.js)
- [public/app.js](./public/app.js)
- [tests/predictive-preprocessing.test.js](./tests/predictive-preprocessing.test.js)

## 4. Documentation

Created a detailed report with the distinction between direct LLM requests and prepared context, benefits and limitations, proposed LLM architecture, evaluation guidance, repository implementation review, and references.

- [PREDICTIVE_PREPROCESSING_REPORT.md](./PREDICTIVE_PREPROCESSING_REPORT.md)
- [README.md](./README.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)

## Validation and limitations

- Focused preprocessing and server-recovery tests passed: **8 passed**.
- JavaScript syntax checks passed.
- `git diff --check` passed.
- A wider test run earlier reported three failures in discovery-query and HTTP Basic authentication tests. Those were outside the focused preprocessing tests and were not confirmed against a clean baseline.
- No benchmark against representative production data was performed; an improvement in prospect accuracy has not been established.
- The reviewed ICP scraper repository has no LLM inference call path. The implemented preprocessing currently feeds rule-based extraction, not an LLM. Integrating it with an LLM-backed Dakini service requires locating that service and adding query-aware retrieval and token-aware prompt construction there.
