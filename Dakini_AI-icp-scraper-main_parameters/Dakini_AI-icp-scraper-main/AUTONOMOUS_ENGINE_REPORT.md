# Autonomous Engine Creation Report

**Project:** Dakini AI ICP Scraper  
**Report date:** 2026-10-08  
**Target:** Hardened single-operator, single-server deployment

## Executive summary

The project includes a deterministic autonomous prospect-research engine. It schedules research cycles, discovers public data-source candidates, waits for operator approval before retrieving newly discovered directories, searches public web indexes, crawls permitted company pages, extracts evidence, scores each company against an ICP, persists results, and streams status to the UI.

This is an automation pipeline, not an LLM agent or an autonomous sales agent. It does not contact prospects, make purchases, prove intent, or execute arbitrary tools. The fit tiers and evidence confidence are heuristics for human review.

## Engine construction

The engine combines these stages:

1. **Configuration:** ICP industry, location, and use-case preferences; schedule and timezone; search provider credentials; crawler concurrency.
2. **Source discovery:** Rotating search queries cover public registers, associations, government/open-data sources, supplier directories, and public portfolios. A result is fetched and checked for directory evidence before it becomes a pending candidate.
3. **Human approval boundary:** Newly found directories remain pending. Approval authorizes later retrieval from that directory; it does not approve outreach to listed companies.
4. **Directory and web discovery:** Approved sources are revisited for listings; public search results are filtered, ranked, and normalized by company domain. Daily search queries are balanced across configured industries, rotate their extra query allocation, and include buying-signal queries. Likely AI vendors/job boards are filtered.
5. **Safe crawling:** Public HTTP(S) URLs are checked against DNS/private-address rules and redirects; response size, type, timeout, robots policy, crawl delay, and per-site concurrency are bounded.
6. **Evidence processing:** Company pages are parsed for company activity, operating scale, contact channels, language needs, integrations, and buying/growth signals.
7. **ICP scoring:** Evidence is matched to documented Dakini-aligned voice workflows, scored with a transparent rubric, and assigned a Priority, Review, or Low fit tier.
8. **Persistence and operator review:** Jobs, progress, company records, source quotes, and discovery status are written to SQLite. The UI exposes job status, results, evidence, score details, and engine events.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the system and data-flow diagrams.

## Operating modes and controls

- Fresh installations default to one daily cycle, using `DISCOVERY_TIME` and `DISCOVERY_TIME_ZONE`. Existing saved engine settings are retained.
- Operators can start a cycle immediately or select interval/continuous modes. Faster modes consume more provider quota and create more crawler traffic.
- Search provider response limits, public index coverage, website accessibility, robots policies, and configured concurrency constrain the work. No run can guarantee exhaustive results.
- Search and site failures are recorded on jobs and surfaced in status; rate limiting stops/limits work rather than creating an unbounded retry loop.
- Candidates from discovered directories require operator approval before their company links are retrieved. Company results still require human qualification before any outreach.

## Reliability work in this upgrade

- Async jobs launched by the scheduler and HTTP routes are tracked.
- `SIGINT` and `SIGTERM` now stop scheduler timers, close SSE connections and the HTTP listener, wait for tracked work to finish, persist the final state, and close the SQLite connection.
- Interrupted source discovery, approved-directory retrieval, and web-discovery jobs resume after restart. Web discovery persists completed query indexes and candidate evidence, then checkpoints completed company domains so finished work is not repeated.
- New installs use the daily schedule as the autonomous default, matching the documented operating schedule. Daily engine cycles also refresh source discovery and approved directories.

## Production limitations and next engineering stages

This upgrade hardens the documented single-server deployment; it does not turn the POC into a horizontally scalable SaaS product.

1. **Queue durability:** The job runner and timers remain in-process. SQLite records progress but is not a lease-based work queue; only one server instance is supported.
2. **Runtime operations:** Use a process manager with restart policy and a graceful-stop window long enough to drain current work. Monitor `/api/health` and job error summaries; configure alerts and test restore from backups.
3. **Secrets and OAuth:** Keep search keys, Basic Auth credentials, Google OAuth secrets, and `GOOGLE_TOKEN_ENCRYPTION_KEY` in a protected secret store/environment. Google refresh tokens are now AES-256-GCM encrypted in SQLite; losing the encryption key prevents recovery of the saved Sheets connection.
4. **Data governance:** Define retention/deletion periods for prospects, source evidence, database backups, and logs; protect the database and backups as business contact data.
5. **Validation before live launch:** Run `npm ci` and `npm test`, verify real provider quotas, test robots and crawl behavior against target sites, configure HTTPS/reverse-proxy restrictions, schedule integrity-checked backups, and perform a restore exercise.

For multi-user or multi-instance operation, replace the shared Basic Auth model and process-local session state, move jobs to a durable external queue with leases and retries, use a server database with tenant isolation, and add distributed scheduling and observability. That is a separate architecture change, not a safe incremental switch for the current app.
