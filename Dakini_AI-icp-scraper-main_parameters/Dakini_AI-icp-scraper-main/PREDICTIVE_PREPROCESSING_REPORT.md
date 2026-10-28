# Predictive Preprocessing for Dakini AI

**Review date:** 12 October 2026  
**Status:** Rule-based company-context preparation is implemented in this repository. LLM-backed query preparation is a recommended next step, not currently implemented here.

## Executive summary

“Predictive preprocessing” is a useful informal label for preparing information before asking a model to answer, but it is not a single standard LLM component with one agreed algorithm. More precise terms include **input preprocessing**, **query-aware context preparation**, **retrieval and reranking**, **context engineering**, and **prompt construction**.

The core distinction is:

```text
Basic application:   user request → prompt → LLM → response
Prepared context:    request + data → retrieve/rank/structure → prompt → LLM → response
```

The model still tokenizes its input and generates output in the ordinary way. The application-side preparation layer changes which context is supplied, how it is organized, and what constraints accompany it.

This can improve relevance and evidence-grounding when answers depend on large, noisy, changing, or company-specific information. It does not guarantee correctness: poor retrieval can exclude the right evidence, and more processing can add latency, cost, or new failure modes. Measure the impact on Dakini tasks before describing it as an accuracy improvement.

## What counts as preprocessing

The phrase can refer to several different operations. They should be named separately in design documents and metrics:

| Operation | Purpose | Example for Dakini |
|---|---|---|
| Input normalization | Standardize representation without changing the intended meaning | Normalize whitespace, decode document text, retain source and date metadata |
| Task identification | Determine the requested operation | Distinguish “summarize this ticket” from “rank customers for follow-up” |
| Retrieval | Find candidate evidence relevant to the request | Search customer notes, tickets, product docs, or crawled pages |
| Ranking / filtering | Prioritize evidence and remove duplicates or irrelevant material | Prefer a recent renewal note over old generic site copy |
| Context assembly | Fit selected evidence and instructions into a model request | Include concise passages, dates, source IDs, and output schema |
| Safety / permission checks | Limit use to authorized data and treat retrieved text as untrusted | Enforce user access before retrieval; do not follow instructions embedded in source documents |
| Output validation | Check generated results against the requested format and evidence | Validate JSON and verify cited source IDs exist |

Tokenization is also input preparation, but it is normally performed by the model provider's tokenizer/API implementation. It is not the same as application-side retrieval or evidence selection.

## How it differs from a basic LLM request

A basic request-response app may only add a system prompt and the user's message before calling a model. The model handles tokenization and inference, but the application may not know whether the model received the best supporting data.

With context preparation, the application performs work around the model call:

1. Interpret the question and scope.
2. Retrieve relevant records from permitted sources.
3. Rank evidence for relevance, freshness, reliability, and task-specific needs.
4. Deduplicate and enforce a token/context budget.
5. Build a prompt that labels evidence and its sources.
6. Ask the model to answer from that evidence, state uncertainty, and cite sources.
7. Validate the response and citations before returning it.

This is generally an **application architecture pattern**, not a different internal LLM inference algorithm. The model still predicts output tokens. Additional LLM calls for classification, summarization, or reranking are optional; they should only be added where their quality benefit justifies their cost and latency.

## Why it may help

### Potential benefits

- **More relevant answers:** the model receives evidence chosen for the actual question rather than an indiscriminate dump.
- **Better grounding and traceability:** source IDs, dates, and quotations can be carried into the prompt and answer.
- **Less distraction from long contexts:** research has found that model performance on relevant-information tasks can vary with the position of evidence in long inputs.
- **Lower input token use:** filtering or compression may reduce prompt size, and can lower usage cost or latency depending on provider and request shape.
- **Better handling of changing business knowledge:** retrieval can supply current records rather than relying on facts stored in model parameters.
- **More controlled uncertainty:** the application can detect weak or conflicting evidence and instruct the model to qualify the answer or ask for clarification.

### Limitations and trade-offs

- **Retrieval errors become answer errors:** if the useful record is missed, the LLM may not be able to recover it.
- **Heuristic bias:** keyword rules can favor expected wording and miss synonyms, multilingual content, or unusual business descriptions.
- **Compression can lose nuance:** summaries and aggressive context limits can remove exceptions or qualifications.
- **Cost and latency may rise:** query classification, embedding requests, reranking, or summarization can add model/API calls. Retrieval is not automatically cheaper than a direct request.
- **More components to operate:** indexing, freshness, access control, deletion, monitoring, and source provenance must be maintained.
- **No automatic truth guarantee:** asking for citations helps auditability but does not by itself ensure that every claim is supported.

Therefore, describe improvements as hypotheses until Dakini has measured them on representative tasks.

## Applicability to Dakini

The repository reviewed for this report is the **Dakini ICP Scraper**. Its server performs web crawling, rule-based evidence extraction, and heuristic ICP scoring; no LLM inference request path is present in this repository. The existing crawler implementation should not be described as an LLM preprocessing integration.

This repository does now include a narrower context-preparation stage for **prospect research**:

```text
Company website pages
  → normalize and segment
  → remove boilerplate and exact repeated snippets
  → rank snippets against configured ICP and Dakini workflow/operational signals
  → retain bounded, source-linked snippets
  → current rule-based extractor and scorer
```

The ICP profile is the ranking target in that flow; there is no interactive natural-language user question being classified. It is deterministic heuristic preprocessing, not a trained predictor, calibrated probability, embedding retriever, or LLM call.

The implementation records selection metrics and sources for operator inspection. When a homepage is available, one snippet is reserved for homepage coverage; when no relevance signals match, the processor falls back to deduplicated content in source order. These safeguards reduce the risk that relevance filtering discards all context or the basic company overview. They do not prove that the selected snippets are the best evidence.

## Recommended LLM-enabled flow

For a future Dakini conversational/knowledge assistant that can access business records:

```text
User question
  → validate identity, tenant, and data permissions
  → identify task / query scope
  → retrieve candidate records
  → rerank for semantic relevance, freshness, and source quality
  → deduplicate and select within a measured token budget
  → construct prompt with evidence IDs, dates, and answer requirements
  → LLM inference
  → validate format and source references; surface uncertainty
  → response with citations / links
```

### Suggested implementation sequence

1. **Establish the actual LLM call path.** Document provider, model, request parameters, timeout/retry behavior, and data boundaries. Keep API credentials server-side.
2. **Add an evaluation set first.** Collect representative Dakini questions and approved reference evidence/answers; include ambiguous, stale, conflicting, missing, and multilingual cases.
3. **Start with low-risk deterministic work.** Normalize extracted text, preserve source/date/permission metadata, remove exact duplicates, and use rules for a small set of well-defined tasks.
4. **Add query-aware retrieval.** Use keyword search for exact entities and identifiers; consider embeddings for semantic retrieval where paraphrase matters. Restrict retrieval by the caller's access permissions before presenting evidence to a model.
5. **Rerank and budget context.** Prefer evidence that answers the question, is recent enough for the task, and comes from an appropriate source. Reserve space for the system instruction and user's question; measure token counts with the model's tokenizer/API rather than treating character counts as tokens.
6. **Assemble a source-aware prompt.** Clearly delimit retrieved content as untrusted evidence. Instruct the model not to follow instructions found inside documents, to distinguish facts from recommendations, and to say when evidence is insufficient.
7. **Validate responses.** Validate JSON/schema where used, check that cited source IDs were actually retrieved, and avoid presenting model-generated confidence as calibrated probability.
8. **Roll out behind a flag.** Compare baseline and prepared-context variants on the same questions; retain a direct path for simple requests when retrieval adds no value.

Avoid adding a separate LLM call solely to label every query until evaluation shows that deterministic task routing is insufficient. A small number of clear categories and a safe fallback are usually easier to test and operate.

## How to evaluate whether it improves Dakini

Use a fixed, representative, permission-safe evaluation set and compare:

| Metric | What it tests |
|---|---|
| Retrieval recall / evidence coverage | Did the selected context contain the records needed to answer? |
| Answer correctness | Is the conclusion consistent with the reference evidence? |
| Grounded-claim rate | Are material factual claims supported by selected source passages? |
| Citation correctness | Do cited source IDs exist and support the associated claim? |
| Abstention quality | Does the system acknowledge missing or conflicting evidence? |
| Task success | Was the output useful for the user's specific workflow? |
| Input tokens and cost | Did preparation reduce or increase model usage expense? |
| End-to-end latency | Did preparation materially delay the response? |
| Failure rate | Did indexing, retrieval, model, or validation fail? |

Test at least these slices: current vs. stale evidence, contradictory records, repeated passages, exact identifiers, paraphrased questions, incomplete OCR, multilingual phrasing, evidence near context-budget limits, and prompt-injection-like text inside retrieved documents.

Choose launch thresholds before comparing systems. For example, require no regression in grounded correctness and citation validity, set an acceptable latency/cost increase, and require measurable gains for the target workflow. If a metric worsens, inspect retrieval omissions and context ordering before increasing prompt size.

## Review of current repository implementation

### Confirmed facts

- `server.js` calls `prepareCompanyContext` before the existing `extract` and scoring code.
- The preprocessor uses handcrafted regular expressions and optional saved ICP terms to score snippets.
- It normalizes text, removes selected boilerplate and exact duplicates, applies segment/character bounds, and returns source URLs, signals, and summary metrics.
- It excludes search-result snippets from the company-site evidence text.
- It includes homepage coverage and a source-order fallback when no known relevance signals match.
- The UI displays preprocessing details; tests cover relevant ranking, deduplication, bounds, and fallback.
- This code does not call an LLM and does not currently demonstrate better LLM output.

### Scope / correctness caveats

- The 24,000-character limit is a character budget, **not a token budget**. Provider tokenization varies by model and content; an LLM integration must budget with the relevant tokenizer/API.
- Regex relevance is an initial baseline. It may miss indirect or differently worded needs, and it is not an estimate of a company's purchase intent.
- The scoring patterns and segment selection need evaluation against real crawls; unit tests establish behavior, not business accuracy.
- Current data ingestion is crawler-oriented; the report's broader CRM/ticket/document retrieval design is a proposal and must not be presented as shipped functionality.
- Retrieved/crawled pages are untrusted. If supplied to an LLM in a future integration, treat them as data, not instructions; keep authorization checks outside the prompt.
- The existing fit score and preprocessing signals are heuristics, not calibrated probabilities.

### Changes made during this review

The preprocessor now reserves one available homepage snippet to reduce the chance that ranking removes company overview text when other pages contain strong workflow keywords. This was added with a regression test. The page's selection reason is shown separately from matched ranking signals.

## Conclusion

Query-aware preparation is a reasonable way to improve Dakini's LLM-backed workflows when they depend on large or fragmented business context. It is different from the direct request-to-response path because Dakini's application retrieves, filters, ranks, and structures evidence before inference. It can improve relevance, grounding, and efficiency, but only a Dakini-specific evaluation can establish whether it does so in practice.

The current repository has a useful deterministic precursor for prospect-site analysis, not a complete LLM preprocessing pipeline. The recommended next step is to define an LLM-backed Dakini use case and evaluation set, then add permission-aware retrieval and token-aware prompt assembly immediately before the model call.

## References

1. Patrick Lewis et al., [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401), NeurIPS 2020. The paper studies retrieval-augmented generation on knowledge-intensive NLP tasks; its results motivate retrieval as a design option, not a guarantee for Dakini.
2. Nelson F. Liu et al., [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172), TACL 2023. Reports that performance on relevant-information tasks can depend on where evidence occurs in a long context.
3. Huiqiang Jiang et al., [LLMLingua: Compressing Prompts for Accelerated Inference of Large Language Models](https://arxiv.org/abs/2310.05736), EMNLP 2023. Evaluates a specific prompt-compression method on several benchmarks; the paper's reported compression results should not be assumed for a different method or Dakini workload.
4. Hugging Face, [Tokenizer documentation](https://huggingface.co/docs/transformers/en/main_classes/tokenizer). Describes tokenization/encoding and tokenizer handling of model inputs.
5. OpenAI, [Embeddings guide](https://developers.openai.com/api/docs/guides/embeddings). Describes embeddings and relatedness-based search, clustering, recommendations, and classification uses.
6. OpenAI, [Prompt engineering guide](https://developers.openai.com/api/docs/guides/prompt-engineering). Guidance for constructing model inputs and output formats.
