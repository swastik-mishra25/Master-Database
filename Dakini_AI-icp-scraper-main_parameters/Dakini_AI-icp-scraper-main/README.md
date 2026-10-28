# Dakini AI ICP Scraper

This is the Dakini AI prospect research platform. The root URL opens the prospecting interface; production deployments require configured authentication. The marketing-only landing page has been removed.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system flow and [AUTONOMOUS_ENGINE_REPORT.md](./AUTONOMOUS_ENGINE_REPORT.md) for the automation design, reliability work, and remaining production gaps.

## What it does

1. Optionally define multiple comma-separated target industries, locations, and voice-agent use cases for manual crawls; leaving industries blank includes all industries.
2. Register approved company pages as sources.
3. Discover companies from public web results, approved directories, and their target industries; optionally run a city-specific OpenStreetMap business lookup; crawl the homepage and up to seven relevant service, booking, support, FAQ, careers, and contact pages.
4. Extract company activity, publicly listed business emails/phone numbers, operating details, voice use cases, and buying signals.
5. Prepare company evidence before analysis: normalize text, remove repeated/boilerplate snippets, rank relevant content against the ICP and Dakini workflow signals, and select a bounded, source-linked context. If no known signals match, retain deduplicated text in source order.
6. Recommend Dakini AI voice-agent workflows, match evidence against the ICP, and rank potential clients by a transparent score.
7. Review source quotes, preprocessing selections, and score breakdowns for each result; filter prospects by industry; and download the matching results as a spreadsheet-compatible CSV. Successfully downloaded prospects are cleared from the active list, while their domains remain saved so future searches and crawls skip them.
8. Search public web results for configured industries using rotating signals for expansion and acquisitions, partner and competitor ecosystems, e-commerce support, public registries and directories, enquiry channels, visible technology stacks, business news, franchises, and supported languages. These searches identify evidence to review; competitor-tool use does not imply dissatisfaction.
9. Connect a Google account and sync prospects to a Google Sheet.
10. Recheck saved prospects whose last research is at least 90 days old (or was never timestamped), refreshing the first-party website evidence and contact details.

This tool generates a research list of potential Dakini AI clients; it does not prove that a company intends to buy. Scores and evidence confidence are heuristic, not calibrated probabilities. Publicly listed email addresses and phone numbers may be general company channels rather than named decision-makers. Verify the details and suitability before sales outreach.

### Geographic and expanded discovery sources

The optional **Geographic business discovery** action resolves a city/state/country with public OpenStreetMap Nominatim, searches named business listings with public websites via Overpass, and can also query Wikidata. Set `SEARXNG_URL` to include a local or self-hosted SearXNG JSON endpoint. Per-source counts, disabled sources, and source errors are visible in the geographic job results; one provider can fail without discarding successful results from another. All candidate websites enter the same robots-aware crawl, contact extraction, first-party evidence, legitimacy, ICP scoring, persistent portfolio, and CSV export path as web and directory discovery.

OpenStreetMap requires attribution to contributors and is available under the [Open Database License](https://www.openstreetmap.org/copyright); Wikidata content is CC0. OSM and Wikidata coverage/tagging is incomplete, and public provider availability and usage limits apply. Candidate source links are provenance, not proof that a business is active, legally registered, or a fit. Overture's optional remote-Parquet/DuckDB path is not duplicated in this Node app; use the existing directory/import workflow for permitted local company datasets.

The expanded web searches cover company growth announcements and new locations, neutral identification of businesses publicly mentioning common customer-service/CRM tools, possible referral/integration partners, e-commerce enquiry workflows, public company registries and industry directories, published business contact routes, visible CRM/helpdesk/booking technologies, franchise operators, and Tamil/Hindi/English language evidence. Search results are leads for human review, not assertions of fit, a technology gap, or buying intent. Registry searches use public web evidence and approved public directories; they do not query private or paid registries or establish a company's legal status.

The geographic-discovery workflow was informed by the public [geographical_scraping_system](https://github.com/swastik-mishra25/geographical_scraping_system) project. It is integrated as native Node/Express source adapters and uses this app's existing crawl pipeline rather than running a second FastAPI service or maintaining a duplicate lead/scoring system.

The agency CSV files contain 811 unique company records: 452 earlier records and 359 additional candidates listed in TechBehemoths' India digital-marketing directory. New candidates were deduplicated against existing normalized company names and repeated profile URLs, and are cited to both the directory category and company profile. They are directory-listed prospects, not independently verified companies. Their scores are a conservative 23/100 (Low fit), reflecting only the directory category and an India-listed location; no Dakini workflow, buying intent, first-party operation, phone number, website, or company age was verified. Unsupported fields are intentionally blank. See [TECHBEHEMOTHS_IMPORT_REPORT.md](./TECHBEHEMOTHS_IMPORT_REPORT.md) for the import method and limitations.

The 391 rows whose only provenance was a Bing search-results URL were excluded; those rows included a duplicate company-name entry. One additional, low-fit MullenLowe Lintas Group candidate is sourced to its Wikipedia article; its phone and company-site fields are intentionally blank because the Wikipedia page did not substantiate a public phone or company-site URL. Wikipedia reports that Lintas India began operating in Mumbai in 1969; the enriched CSV records the founding/operating year, a 57-year calendar-year estimate as of 2026, and the article source. This age describes Lintas India operating history, not the current TBWA\\Lintas brand following the 2025–2026 rebrand. The article also reports 13 offices across four Indian cities as of July 2023; this dated scale evidence needs re-verification. Wikipedia text is available under CC BY-SA 4.0; see the linked article for attribution and revision history. Phone numbers are normalized and repeated values within a company are removed; obvious placeholder numbers are omitted. Of the 811 records, 445 have a usable public phone number and 366 are blank because no usable number was found; no number is inferred. Directory imports also skip an existing website domain or a matching normalized company name and India location, preventing duplicate entries across alternate website domains.

Live prospect records include a business start year only when an explicit founding or operating-start year can be extracted from a crawled company-domain page. Business age is calculated as the current calendar year minus that year and is an estimate (not anniversary-precise). The cited excerpt and source URL are included in prospect evidence and CSV/Google Sheets exports. Directory or search-result dates are not used to infer a live company's start year; if no explicit first-party statement is found, the value remains blank.

Live crawls assess company legitimacy evidence separately from Dakini fit. Only readable pages hosted on the company's own domain count; search results and third-party directory pages cannot supply identity, contact, or profile evidence. Identity matching requires more than one shared company-name element for multi-word brands, a distinctive name supported by the domain, or an exact brand-aligned domain with first-party page corroboration. Strong evidence also requires marketing-business information, a public contact path on first-party content, company-profile information, and at least two distinct first-party page paths. Automated discovery only counts these strong-evidence prospects as qualified; weaker results are retained for review rather than treated as established companies. Buying intent is counted only when an explicit evaluation, procurement, or implementation action is tied to voice AI, conversational AI, or customer-service automation; generic vendor-seeking copy does not count. Stored prospects are re-scored when scoring rules change, and identity can be rechecked against previously scanned first-party page titles. Directory-only imports remain eligible for website crawling so their evidence can be upgraded. This is a transparent heuristic, not a government registry, legal-status, or active-phone verification.

The preprocessing stage is deterministic relevance ranking, not an LLM or a trained predictive model. It is intended to reduce duplicate/noisy context before the existing rules-based extractor runs. Prospect detail views expose its selected sources and signals; validate ranking quality against real crawl examples before relying on it operationally.

See [PREDICTIVE_PREPROCESSING_REPORT.md](./PREDICTIVE_PREPROCESSING_REPORT.md) for the implementation review, differences from a direct LLM request, proposed LLM-enabled architecture, evaluation plan, and research references.

### Dakini AI capabilities used for matching

Dakini AI's [public website](https://www.dakini-ai.com/) describes customer-service, sales, and knowledge agents; customer query and complaint handling; lead qualification, product recommendations, and demo/follow-up scheduling; multilingual Indian-language and accent support; customer-context retrieval and human escalation; and integration with existing systems, email, voice agents, and sales/CRM tools. The scraper maps company evidence to these documented capabilities. It does not treat adjacent opportunities—such as healthcare intake or appointment scheduling—as confirmed Dakini product features; those recommendations explicitly require workflow, integration, and compliance validation.

### Potential-client fit score (out of 100)

- **Service fit (30):** 15 for the first distinct Dakini-aligned workflow, 10 for the second, then 5 for additional workflows, capped at 30. Equivalent labels are deduplicated.
- **Operating scale (25):** 5 for customer-facing support/sales staff, 4 for multiple branches, 8 for high customer/call volumes, 4 for extended hours, and 4 for relevant support/sales hiring.
- **India and language fit (5):** 3 for evidence of an India market presence and 2 for multilingual, regional-language, dialect, or accent needs.
- **Integration readiness (8):** 5 for CRM/telephony/contact-center tools and 3 for APIs, customer records, or integration evidence.
- **Buying/growth signals (15):** 12 for explicit AI/voice automation evaluation or adoption and 3 for expansion. Relevant hiring is counted only under operating scale, not double-counted.
- **Public contactability (5):** 3 for a public business email and 2 for a phone number.
- **First-party workflow evidence (12):** Up to 4 for customer-support options, 3 for a working enquiry form, 3 for FAQs, and 2 for booking workflows found on scanned company pages. These indicate publicly observable workflows, not a verified service gap.

**High potential** requires at least 90 points, any configured ICP criteria to match, a confirmed Dakini workflow, and an explicit, non-negated buying/automation signal. **Research** requires at least 45 points, configured ICP criteria to match, a confirmed core workflow, and at least one operating-scale or integration signal. Industry aliases (such as BFSI and Banking & Financial Services) are normalized during ICP matching. Appointment and booking signals alone are adjacent opportunities, not confirmed Dakini product fit, and do not earn core service-fit points. Sites that appear to sell AI/voice-agent/contact-center software are treated as competitors, capped at 20 points, and excluded from these tiers. Industry, use-case, and location filters gate the tier but do not add score points. The portfolio displays all leads from highest score down; use the 90+ High-potential filter for only the strongest matches. Research and Lower-fit records remain available by changing the filter. Daily discovery counts only newly captured, legitimacy-qualified 90+ High-potential leads—not Research-tier records—toward its best-effort target. Each result shows its point breakdown and available evidence quotes/links. Scores prioritize research; they are not purchase probabilities. The scoring version is incremented so saved website prospects are rescored on the next server startup.

Lower-fit prospects can be re-researched from the portfolio using **Re-research all Lower fit**. The job snapshots the selected prospects, waits for any active discovery/crawl to finish, deduplicates websites by domain, and revisits public first-party pages under the existing robots and safe-fetch policies. It refreshes evidence and scores in place instead of creating duplicate prospects, runs at limited concurrency, and resumes completed-target checkpoints after a server restart. Directory-only entries are included when a valid company website is available; invalid URLs and duplicate domains are reported as skipped. Research can take hours and does not guarantee a higher fit.

### Reading prospect evidence

Prospect details identify the evidence basis, check time, and number of scanned pages. The website workflow check reports whether enquiry forms, booking flows, FAQs, and customer-support options were found on scanned first-party pages; "not detected" is not proof of a gap or a business problem. Source excerpts show the text that triggered rule-based signals; they are not independently verified facts. Directory-only records are explicitly labeled as not having company operations checked. Search-results URLs are identified as discovery references, not direct company listings. Extracted activity summaries and suggested Dakini workflows are not confirmed company statements or buying intent. CSV and Google Sheets exports include the evidence-basis note, website workflow check, source reference type and URL, source excerpts, check time, and page count; treat fit scores as research priorities, not probabilities.

In live mode, public pages with external links to companies in supported industries may be surfaced as directory candidates. The crawler extracts distinct company names and links only after the candidate is reviewed and approved; it then visits public company sites subject to robots.txt. Each company site is limited to eight pages total (homepage plus up to seven relevant same-domain pages). Daily web search uses industry-specific and appointment, hiring, multi-branch, website-workflow, and buying-signal queries. The ICP form defaults to location-independent discovery; uncheck that option to limit searches and scoring to selected locations. City-level and other supported locations can also be added. When a location is selected, it counts as a match only when supported by company-site text; a search query or `.in` domain alone does not verify a presence. Search ranks domains using relevance and filters likely AI vendors/job boards before crawling. There is no application-imposed per-run company cap; up to `DISCOVERY_CRAWL_CONCURRENCY` sites are crawled in parallel (8 by default).

## Run

Requirements: Node.js 22 or later (Node.js 22 LTS recommended).

```bash
npm install
npm start
```

Open:

http://localhost:3000

The server binds to `127.0.0.1` by default. The application creates `.dakini-state.sqlite` beside `server.js` and keeps it out of Git. Set `DAKINI_DATABASE_FILE` to place the database on a protected local volume. SQLite is configured for write-ahead logging and full synchronous commits.

## Google Sheets connection

1. In Google Cloud Console, create an OAuth 2.0 Client ID with application type **Web application**.
2. Add `http://localhost:3000/auth/google/callback` as an authorized redirect URI.
3. Copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_TOKEN_ENCRYPTION_KEY`. Generate a 32-byte encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep this key and `.env` private, back up the key separately from the database, and do not commit credentials.
4. Restart the server, choose **Connect Google Sheets**, and authorize the requested Sheets access.
5. Choose **Sync to Google Sheets** to create or update the prospect sheet for that app session.

Google OAuth refresh tokens are encrypted with AES-256-GCM before being stored in SQLite. The app restores the connection and spreadsheet reference after a server restart. Losing or changing `GOOGLE_TOKEN_ENCRYPTION_KEY` makes stored credentials unreadable; restore the original key from your protected secret backup or reconnect Google after removing the old stored connection. The app still has shared Basic Authentication and one global prospect workspace; do not use it as a multi-user service.

If `DAKINI_STATE_FILE` points to an existing legacy JSON state file, the first startup imports its records into SQLite and leaves the JSON file untouched. New changes are written to SQLite; keep the legacy file as a backup until the import has been verified.

### Backups

Create a consistent online SQLite backup with:

```powershell
npm run backup
```

The command runs SQLite's integrity check against the completed backup before reporting success. Schedule it regularly with Windows Task Scheduler, cron, or your hosting provider. Prospect retention remains manual; backups are not automatically pruned.

On Windows, create a daily Task Scheduler task that runs `node.exe` with the argument `C:\path\to\dakini-icp-poc\backup-database.js`, and set **Start in** to the project directory so `.env` and relative database paths resolve correctly. Run the task as an account that can access the SQLite file and the protected backup location. Check Task Scheduler's last-run result and retain the output log.

To choose a destination, pass its absolute path:

```powershell
npm run backup -- "C:\secure-backups\dakini.sqlite"
```

Store backups with access controls at least as strict as the live database. The database contains saved company research and publicly listed business contact details. Store `GOOGLE_TOKEN_ENCRYPTION_KEY` separately in a protected secret store; the database backup alone cannot restore Google OAuth access. For recovery, stop the server and point `DAKINI_DATABASE_FILE` at a verified backup.

### Single-server production deployment

This deployment mode is for one trusted operator on one server. It does not provide user accounts, tenant isolation, durable background workers, or multi-instance coordination.

1. Copy `.env.example` to `.env`. Set `NODE_ENV=production`, `DEMO_MODE=false`, `APP_USERNAME`, and a unique `APP_PASSWORD` of at least 12 characters. Do not commit `.env`.
2. Put the app behind an HTTPS reverse proxy, restrict direct access to its Node port, and use an HTTPS `GOOGLE_REDIRECT_URI` if Google Sheets is enabled. Basic authentication is not safe over plain HTTP.
3. Set `DAKINI_DATABASE_FILE` to a persistent, access-controlled local disk path. Do not put the SQLite database on a network filesystem or share it between app instances.
4. Run `npm ci`, `npm test`, then `npm start`. Use a process manager to restart the single Node process and monitor `GET /api/health`.
5. Schedule regular backups with `npm run backup` using Windows Task Scheduler, cron, or your process host's scheduler; retain encrypted/off-host copies according to your data-retention policy. Backups contain prospect data and should be access-controlled.

With `NODE_ENV=production`, the app refuses to start without both authentication settings and uses live mode by default. If Google OAuth is configured, a valid 32-byte `GOOGLE_TOKEN_ENCRYPTION_KEY` is also required. The app protects its UI and APIs with a shared HTTP Basic credential, rejects cross-origin writes, limits request size and crawl-start frequency, and sets baseline browser security headers. The `/api/health` endpoint intentionally remains unauthenticated and reports only whether the app and database are available; authenticated operational details are available at `/api/operations/diagnostics`.

Daily scheduling and crawl queues remain in-process: the server must be online at the configured schedule. `SIGINT` and `SIGTERM` stop scheduling, drain tracked background work, persist state, and close SQLite. After a forced termination, interrupted source-discovery, approved-directory retrieval, and broad web-discovery jobs resume from stored progress. Web discovery checkpoints completed search queries and candidate evidence, then tracks completed company domains so a restart retries unfinished work without repeating completed crawls. Google OAuth connections persist encrypted in the local database. Prospect retention is manual: use the UI's clear/export controls to remove saved records; no age-based automatic deletion is performed.

## Automated web discovery

Scheduled discovery aims for 300 newly captured, legitimacy-qualified High-potential prospects (90+ score, matching ICP/core workflow, and explicit buying signal) per local day. Research-tier leads do not count toward this high-potential target. The flow searches up to 100 rotating queries at a time across saved ICP industries and, unless location-independent mode is selected, its target locations. Queries cover appointment/booking, customer-support hiring, multi-branch, website-workflow, and explicit AI buying signals; the search requests up to 100 Firecrawl results or 20 Brave results per query, deduplicates company domains, and continues with fresh query batches until the target is reached, the daily window closes, the provider is rate-limited, or the available query pool is exhausted. Search-query context can qualify a candidate when a search snippet omits the target industry wording; the first-party company-site crawl still determines its industry, legitimacy evidence, and fit. Website workflow checks report only features found or not detected on scanned pages; they do not treat missing features as evidence of a business problem. Previously saved domains are not added again. Company names come from the company site or fall back to its verified domain, not the search-result title. Likely AI vendors and job boards are filtered. The crawler checks each homepage and up to seven relevant same-domain pages. The target is best-effort, not guaranteed: search-provider quotas, public index coverage, crawl permissions, and strict qualification criteria may cause a shortfall.

The search provider still controls its own quotas, result caps, index coverage, and availability; keyless Firecrawl requests are spaced by at least 6.5 seconds and a `429` stops the run rather than retrying indefinitely. Configure `FIRECRAWL_API_KEY` or `BRAVE_SEARCH_API_KEY` for the limits available on your provider plan (Brave takes precedence if both are set). Discovery runs daily at the configured schedule while the server is online, and can also be started manually. It searches public indexed sources, not the entire internet, so no system can guarantee literally unlimited or exhaustive leads. Review the company's website and evidence before outreach; a fit score is not confirmation of buying intent.

The local server must remain running and connected to the internet at its scheduled time (`09:00` by default in `Asia/Kolkata`); it does not run while the machine or server is off.

### Built-in public company directories

ICP discovery supports companies across banking and financial services, insurance, healthcare and clinics, retail, ecommerce, education, real estate, hospitality and hotels, recruitment, logistics, telecom, professional services, manufacturing, automotive, travel, SaaS, and marketing. The search surfaces appointment-based businesses, customer-support/reception/appointment-setting hiring, multi-location brands, and public website enquiry/booking/FAQ/support options. Location-independent search is enabled by default; location filters remain configurable. Website features and directory membership are research signals, not evidence of an unmet need or active buying intent.

### Automated data-source discovery and retrieval

The source pipeline searches multiple rotating combinations of saved ICP industries and locations, across regulators and licensed-entity registers, government/open-data lists, associations/chambers, supplier directories, and public company portfolios. It runs eight searches per scan by default; configure `SOURCE_DISCOVERY_SEARCHES_PER_RUN` from 1 to 100 to adjust coverage against provider quotas. Authenticated provider requests are concurrent (3 by default, adjustable with `AUTHENTICATED_SEARCH_CONCURRENCY`); keyless requests remain serialized and rate-limited. The search provider's returned results bound each scan; all results matching source signals are checked rather than stopping at a fixed candidate count.

Each result is treated as untrusted until its directory page has been fetched and checked for authority, list, and distinct external-company-link evidence. Validated source candidates retain their search evidence, ICP/industry/location context, validation confidence, and last-seen time. Repeated discoveries refresh the same candidate instead of creating duplicate queue items. Candidate discovery never follows listed company links until a reviewer approves that directory.

Company and directory pages are fetched only over public HTTP/HTTPS addresses. Up to eight sites are crawled simultaneously by default; adjust `DISCOVERY_CRAWL_CONCURRENCY` between 1 and 16 for the machine and network. Before each page request, the crawler checks the site's `robots.txt`, follows its allow/disallow rules, and observes its crawl delay; rules are cached for six hours. A missing robots file is allowed, while inaccessible or server-error responses pause that site's crawl. Requests are serialized per origin with a one-second default spacing when no crawl delay is specified. Redirect targets are revalidated to prevent private-network access.

Use **Find data sources** for an on-demand scan. Approving a candidate is permission to revisit its directory and retrieve its present and future public listings; no separate prompt is shown for each company. Approval adds the directory with its matching ICP context, so retrieved businesses are scored against the right industry and location. **Retrieve approved sources** runs retrieval on demand. Curated sources are included only when verified sources are configured; placeholder URLs are not offered as sources. The daily scheduler automatically includes approved discovered directories before the broader prospect search. The Configuration panel shows approved directories and each source's last retrieval result.

Retrieval tracks visited pages, company listings, qualification results, and errors; it deduplicates by company domain and revisits approved directory pages on later runs to discover newly listed companies. Completed company domains are checkpointed as a retrieval progresses, and interrupted approved-directory retrieval, source-discovery, and web-discovery jobs are automatically resumed after restart. Other interrupted crawl types remain marked interrupted. Directory retrieval retains discovered records for review, but only strong-legitimacy prospects with Priority or Review ICP fit count as qualified.

Provider quotas, search-index coverage, the number of public links a directory exposes, and website accessibility bound real-world results; the system cannot guarantee an exhaustive or literally unlimited view of the internet.

On startup, saved prospects with older score versions are re-scored using their stored company summaries and evidence quotes. Because full source-page text is not retained, recrawl companies to refresh their evidence and contact details.

The daily schedule defaults to `09:00` in `Asia/Kolkata`; customize it with `DISCOVERY_TIME` (24-hour `HH:MM`) and `DISCOVERY_TIME_ZONE` (IANA time-zone name). You can also start a run from the app. The server process must stay running for scheduled runs. SQLite keeps completed results and retrieval progress between restarts; in-progress directory retrieval and source-discovery jobs resume on startup.

Search-provider errors and company-site fetch errors are reported in job status.

## Demo mode

Demo mode is the safe default and uses a built-in synthetic digital-marketing-company fixture for manual crawls. Automated web discovery, when configured, still searches the web and fetches public company sites even in demo mode.

To run a live crawl on Windows PowerShell, set the variable in the same terminal before starting the server:

```powershell
$env:DEMO_MODE = "false"
npm start
```

Restart the server after changing the mode, then add an approved public URL in the app.

## Validation

Run the automated persistence, network-safety, authentication, and HTTP request-limit checks with:

```powershell
npm test
```
