const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const cheerio = require("cheerio");
const { google } = require("googleapis");
const { createStateStore } = require("./state-store");
const { decryptOAuthTokens, encryptOAuthTokens, parseEncryptionKey } = require("./encrypted-oauth-tokens");
const { fetchPublicPage } = require("./safe-fetch");
const { buildSourceDiscoveryQueries } = require("./source-discovery");
const {
  DEFAULT_RESULT_LIMIT: GEOGRAPHIC_RESULT_LIMIT,
  discoverGeographicalBusinesses
} = require("./geographical-discovery");
const {
  INDIA_CITIES,
  INDIA_DISCOVERY_LOCATIONS,
  INDIA_GEOGRAPHIC_SIGNAL,
  findIndiaLocations,
  hasIndiaGeographicSignal,
  isIndiaTargetLocation
} = require("./india-geography");
const { createRobotsPolicy } = require("./robots-policy");
const {
  DISCOVERY_INDUSTRIES,
  DAILY_DISCOVERY_QUERIES_PER_RUN,
  hasRelevantDiscoveryEvidence,
  selectDailyDiscoveryQueries
} = require("./discovery-queries");
const { selectRecoverableAutomationJobs } = require("./automation-recovery");
const { runWithConcurrency } = require("./bounded-concurrency");
const { createBackgroundTaskTracker } = require("./background-task-tracker");
const { createGracefulShutdown } = require("./graceful-shutdown");
const { pauseEngineState } = require("./engine-state");
const { prepareCompanyContext } = require("./predictive-preprocessing");
const { normalizePhoneNumbers } = require("./public/phone-numbers");
const { findCompanyStartYear } = require("./public/company-age");
const {
  assessCompanyLegitimacy,
  refreshStoredLegitimacy
} = require("./company-legitimacy");
const { findBuyingIntentSignal } = require("./buying-signals");
const {
  HIGH_POTENTIAL_SCORE_THRESHOLD,
  scoreLead
} = require("./prospect-scoring");
const {
  createLowerFitResearchTargets,
  createStaleCompanyResearchTargets
} = require("./lower-fit-research");
const {
  DAILY_QUALIFIED_PROSPECT_TARGET,
  countDailyQualifiedProspects,
  dateKeyInTimeZone
} = require("./daily-discovery-target");
const {
  detectWebsiteWorkflowSignals,
  summarizeWebsiteWorkflowSignals
} = require("./website-workflow-signals");
if (process.env.NODE_ENV !== "test") require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const DEMO_MODE = process.env.DEMO_MODE === undefined
  ? process.env.NODE_ENV !== "production"
  : process.env.DEMO_MODE !== "false";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;
const DATABASE_FILE = process.env.DAKINI_DATABASE_FILE || path.join(__dirname, ".dakini-state.sqlite");
const LEGACY_STATE_FILE = process.env.DAKINI_STATE_FILE;
const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const WEB_SEARCH_PROVIDER = BRAVE_SEARCH_API_KEY
  ? "Brave Search"
  : FIRECRAWL_API_KEY ? "Firecrawl (authenticated)" : "Bing Live Search";
const DISCOVERY_TIME = process.env.DISCOVERY_TIME || "09:00";
const DISCOVERY_TIME_ZONE = process.env.DISCOVERY_TIME_ZONE || "Asia/Kolkata";
const SOURCE_DISCOVERY_SEARCHES_PER_RUN = Number(process.env.SOURCE_DISCOVERY_SEARCHES_PER_RUN || 50);
const MAX_RESULTS_PER_SEARCH = BRAVE_SEARCH_API_KEY ? 20 : (FIRECRAWL_API_KEY ? 100 : 20);
const MAX_PAGES_PER_COMPANY = 8;
const DISCOVERY_CRAWL_CONCURRENCY = Number(process.env.DISCOVERY_CRAWL_CONCURRENCY || 8);
const AUTHENTICATED_SEARCH_CONCURRENCY = Number(process.env.AUTHENTICATED_SEARCH_CONCURRENCY || 3);
const SCORE_VERSION = 9;
const APP_USERNAME = process.env.APP_USERNAME || "";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (!Number.isInteger(Number(PORT)) || Number(PORT) < 1 || Number(PORT) > 65535) {
  throw new Error("PORT must be a valid TCP port between 1 and 65535.");
}
if (Boolean(APP_USERNAME) !== Boolean(APP_PASSWORD)) {
  throw new Error("APP_USERNAME and APP_PASSWORD must be configured together.");
}
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  parseEncryptionKey(GOOGLE_TOKEN_ENCRYPTION_KEY);
}
if (IS_PRODUCTION && (!APP_USERNAME || !APP_PASSWORD)) {
  throw new Error("APP_USERNAME and APP_PASSWORD are required when NODE_ENV=production.");
}
if (APP_PASSWORD && APP_PASSWORD.length < 12) {
  throw new Error("APP_PASSWORD must contain at least 12 characters.");
}
if (!Number.isInteger(SOURCE_DISCOVERY_SEARCHES_PER_RUN) ||
    SOURCE_DISCOVERY_SEARCHES_PER_RUN < 1 || SOURCE_DISCOVERY_SEARCHES_PER_RUN > 100) {
  throw new Error("SOURCE_DISCOVERY_SEARCHES_PER_RUN must be an integer between 1 and 100.");
}
if (!Number.isInteger(DISCOVERY_CRAWL_CONCURRENCY) ||
    DISCOVERY_CRAWL_CONCURRENCY < 1 || DISCOVERY_CRAWL_CONCURRENCY > 16) {
  throw new Error("DISCOVERY_CRAWL_CONCURRENCY must be an integer between 1 and 16.");
}
if (!Number.isInteger(AUTHENTICATED_SEARCH_CONCURRENCY) ||
    AUTHENTICATED_SEARCH_CONCURRENCY < 1 || AUTHENTICATED_SEARCH_CONCURRENCY > 8) {
  throw new Error("AUTHENTICATED_SEARCH_CONCURRENCY must be an integer between 1 and 8.");
}
if (IS_PRODUCTION && process.env.DEMO_MODE === "true") {
  throw new Error("DEMO_MODE must be false in production.");
}
if (IS_PRODUCTION && process.env.GOOGLE_CLIENT_ID && !GOOGLE_REDIRECT_URI.startsWith("https://")) {
  throw new Error("GOOGLE_REDIRECT_URI must use HTTPS in production.");
}

if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(DISCOVERY_TIME)) {
  throw new Error("DISCOVERY_TIME must be a valid 24-hour time such as 09:00.");
}
try {
  new Intl.DateTimeFormat("en-US", { timeZone: DISCOVERY_TIME_ZONE }).format(new Date());
} catch {
  throw new Error("DISCOVERY_TIME_ZONE must be a valid IANA time zone.");
}

const stateStore = createStateStore(DATABASE_FILE);
const robotsPolicy = createRobotsPolicy({
  fetchRobots: async url => {
    try {
      const body = await fetchPublicPage(url);
      return { status: 200, body };
    } catch (error) {
      const status = Number(error.message.match(/^HTTP (\d+)/)?.[1]);
      if (status) return { status, body: "" };
      throw error;
    }
  }
});
const icps = new Map();
const sources = new Map();
const jobs = new Map();
const companies = new Map();
const scrapedDomains = new Set();
const sourceCandidates = new Map();
const googleOAuthStates = new Map();
const googleConnections = new Map();
const discoveryState = {
  lastRunAt: null,
  lastRunSummary: null,
  lastError: "",
  lastPublicDirectoryRetrievalAt: null,
  lastPublicDirectoryRetrievalSummary: null,
  lastPublicDirectoryRetrievalError: "",
  activeSourceDiscoveryJobId: null,
  lastSourceDiscoveryAt: null,
  lastSourceDiscoverySummary: null,
  lastSourceDiscoveryError: "",
  nextRunAt: null,
  activeJobId: null
};
const engineState = {
  enabled: true,
  mode: "daily",
  intervalMinutes: 15,
  status: "idle",
  cycleCount: 0,
  currentActivity: "Daily autonomous engine initialized and ready",
  lastCycleAt: null,
  nextRunAt: null,
  totalProspectsFound: 0
};
const engineLiveEvents = [];
const sseClients = new Set();
const backgroundTasks = createBackgroundTaskTracker();
let isShuttingDown = false;
let dailyDiscoveryTimeout = null;
let httpServer = null;

function broadcastEngineEvent(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

function recordEngineEvent(type, message, details = {}) {
  const event = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    message,
    ...details
  };
  engineLiveEvents.push(event);
  if (engineLiveEvents.length > 80) engineLiveEvents.shift();
  broadcastEngineEvent(event);
}

let nextFreeSearchStartedAt = 0;
let freeSearchQueue = Promise.resolve();

function persistState() {
  stateStore.saveSnapshot({
    icps: [...icps.values()],
    sources: [...sources.values()],
    jobs: [...jobs.values()],
    companies: [...companies.values()],
    scrapedDomains: [...scrapedDomains].map(domain => ({ id: domain })),
    sourceCandidates: [...sourceCandidates.values()],
    googleConnections: [...googleConnections.entries()].map(([sessionId, connection]) => ({
      id: sessionId,
      encryptedTokens: connection.encryptedTokens,
      spreadsheetId: connection.spreadsheetId,
      spreadsheetUrl: connection.spreadsheetUrl
    })),
    discoveryState: { ...discoveryState, engine: engineState }
  });
}

function restoreState() {
  let state = stateStore.loadSnapshot();
  let importedLegacyState = false;
  if (!state && LEGACY_STATE_FILE && fs.existsSync(LEGACY_STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(LEGACY_STATE_FILE, "utf8"));
    importedLegacyState = true;
  }
  if (!state) return;
  const values = (collection) => Array.isArray(collection)
    ? collection.flatMap(item => Array.isArray(item?.value) ? item.value : [item])
    : Array.isArray(collection?.value)
      ? collection.value
      : [];
  for (const value of values(state.icps)) icps.set(value.id, value);
  for (const value of values(state.sources)) sources.set(value.id, value);
  for (const value of values(state.jobs)) jobs.set(value.id, value);
  for (const value of values(state.companies)) companies.set(value.id, value);
  const directoryOnlyDomains = new Set([...companies.values()]
    .filter(company => company.legitimacy?.status === "directory_only")
    .map(company => company.id));
  for (const value of values(state.scrapedDomains)) {
    if (!directoryOnlyDomains.has(value.id)) scrapedDomains.add(value.id);
  }
  for (const [domain, company] of companies) {
    if (company.legitimacy?.status !== "directory_only") scrapedDomains.add(domain);
  }
  for (const value of values(state.sourceCandidates)) sourceCandidates.set(value.id, value);
  for (const value of values(state.googleConnections)) {
    googleConnections.set(value.id, {
      tokens: decryptOAuthTokens(value.encryptedTokens, GOOGLE_TOKEN_ENCRYPTION_KEY),
      encryptedTokens: value.encryptedTokens,
      spreadsheetId: value.spreadsheetId || "",
      spreadsheetUrl: value.spreadsheetUrl || ""
    });
  }
  Object.assign(discoveryState, state.discoveryState || {});
  if (state.discoveryState?.engine) {
    Object.assign(engineState, state.discoveryState.engine);
  }
  if (discoveryState.lastRunSummary) {
    const summary = discoveryState.lastRunSummary;
    summary.qualifiedProspectsAdded ??= summary.newQualifiedProspects || 0;
    delete summary.newQualifiedProspects;
  }
  if (discoveryState.activeJobId) {
    const interruptedJob = jobs.get(discoveryState.activeJobId);
    if (interruptedJob && ["running", "queued"].includes(interruptedJob.status)) {
      interruptedJob.status = "interrupted";
      interruptedJob.completedAt = new Date().toISOString();
      interruptedJob.error = "Server restarted while this discovery job was running.";
    }
    discoveryState.activeJobId = null;
  }
  if (discoveryState.activeSourceDiscoveryJobId) {
    const interruptedJob = jobs.get(discoveryState.activeSourceDiscoveryJobId);
    if (interruptedJob && ["running", "queued"].includes(interruptedJob.status)) {
      interruptedJob.status = "interrupted";
      interruptedJob.completedAt = new Date().toISOString();
      interruptedJob.error = "Server restarted while source discovery was running.";
    }
    discoveryState.activeSourceDiscoveryJobId = null;
  }
  for (const interruptedJob of jobs.values()) {
    if (["running", "queued"].includes(interruptedJob.status)) {
      interruptedJob.status = "interrupted";
      interruptedJob.completedAt = new Date().toISOString();
      interruptedJob.error = "Server restarted before this job completed.";
    }
  }
  if (importedLegacyState) {
    persistState();
    console.log(`Imported legacy JSON state from ${LEGACY_STATE_FILE} into SQLite.`);
  }
}

restoreState();
persistState();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (IS_PRODUCTION) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 2400,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

app.get("/api/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!stateStore.healthCheck()) throw new Error("SQLite health check failed.");
    res.json({ status: "ok" });
  } catch (error) {
    console.error("Health check failed:", error.message);
    res.status(503).json({ status: "unavailable" });
  }
});

function timingSafeTextEqual(actual, expected) {
  const actualDigest = crypto.createHash("sha256").update(actual).digest();
  const expectedDigest = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

if (APP_USERNAME && APP_PASSWORD) {
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && origin) {
      try {
        if (new URL(origin).host !== req.get("host")) {
          return res.status(403).json({ error: "Cross-origin requests are not allowed." });
        }
      } catch {
        return res.status(403).json({ error: "Invalid request origin." });
      }
    }

    const [scheme, credentials] = (req.get("authorization") || "").split(" ");
    let username = "";
    let password = "";
    if (scheme === "Basic" && credentials) {
      const decoded = Buffer.from(credentials, "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        username = decoded.slice(0, separator);
        password = decoded.slice(separator + 1);
      }
    }
    if (timingSafeTextEqual(username, APP_USERNAME) && timingSafeTextEqual(password, APP_PASSWORD)) {
      return next();
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="Dakini ICP Scraper", charset="UTF-8"');
    res.status(401).json({ error: "Authentication required." });
  });
}

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.get("/", (req, res) => res.redirect(302, "/platform.html"));
app.use(express.static(path.join(__dirname, "public")));

const crawlRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many crawl requests. Wait before starting another run." }
});

function hasActiveCrawlJob() {
  return [...jobs.values()].some(job => ["queued", "running"].includes(job.status));
}

const ICP = z.object({
  name: z.string().min(1),
  industries: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  anyLocation: z.boolean().default(false),
  areas: z.array(z.string()).default([]),
  useCases: z.array(z.string()).default([])
});

const SOURCE = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  approved: z.boolean().default(false)
});

function id() {
  return crypto.randomUUID();
}

function normalizeDomain(url) {
  return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
}

function normalizeCompanyIdentityPart(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function companyIdentityKey(companyName, location) {
  const normalizedName = normalizeCompanyIdentityPart(companyName);
  const normalizedLocation = normalizeCompanyIdentityPart(location);
  return normalizedName && normalizedLocation ? `${normalizedName}|${normalizedLocation}` : "";
}

const DAKINI_WORKFLOW_RECOMMENDATIONS = {
  "customer support": "Use multilingual voice support for routine customer questions and complaints, with customer-context lookup and escalation for complex issues.",
  "lead qualification": "Qualify sales leads against agreed criteria, then route high-intent prospects to the sales team.",
  "sales follow-up": "Automate sales follow-ups and demo scheduling; Dakini's public site describes lead qualification and meeting scheduling.",
  "knowledge and FAQs": "Provide round-the-clock voice answers to repeat questions and procedures, escalating cases that need a person.",
  "product recommendations": "Use a conversational sales agent to answer product questions and make personalized recommendations; verify voice and catalog integration scope.",
  "appointment scheduling": "A voice agent could book or reschedule appointments; confirm the required calendar integration and workflow before pitching.",
  "order support": "Answer order, delivery, and return questions; verify access to the company's order-management data.",
  "branch and service queries": "Answer location, branch, and operating-hours questions in the customer's preferred supported language.",
  "reservations and bookings": "A voice agent could answer availability and booking questions; verify booking-system integration before proposing implementation.",
  "healthcare intake": "A voice agent could route enquiries and support appointment intake; verify privacy, clinical-safety, and integration requirements.",
  "technical support": "Resolve repeat troubleshooting and service questions, with complex issues transferred to a human support team.",
  "dispatch and field service": "A voice agent could coordinate service appointments and dispatch enquiries; verify scheduling and field-system integration."
};
const DAKINI_USE_CASE_PATTERNS = [
  ["customer support", /customer support|customer service|customer care|help ?desk|contact center|call center|customer helpline|inbound calls|customer quer(?:y|ies)|support requests|complaint handling/i],
  ["lead qualification", /lead qualification|qualify leads|sales enquiries|sales inquiries|prospect qualification/i],
  ["sales follow-up", /sales follow.?up|follow.?up calls|schedule demos?|demo booking|sales agent|sales calls/i],
  ["knowledge and FAQs", /knowledge agent|frequently asked questions|\bFAQs?\b|self.service|policy questions|process questions|answer(?:ing)? queries/i],
  ["appointment scheduling", /appointment|booking|schedule a visit|reschedule/i],
  ["order support", /order status|delivery updates|order support|returns|shipment tracking/i],
  ["branch and service queries", /branch locator|nearest branch|atm locator|business hours/i],
  ["reservations and bookings", /reservation|hotel booking|travel booking|room booking/i],
  ["healthcare intake", /patient intake|medical appointment|clinic appointment|healthcare helpline/i],
  ["technical support", /technical support|troubleshooting|IT help ?desk/i],
  ["dispatch and field service", /dispatch|field service|service appointment|repair booking/i],
  ["product recommendations", /product recommendations?|personalized shopping|product discovery|shopping assistant/i]
];

/*
  Very small rule-based extractor.
  It intentionally avoids a real LLM so the POC runs without an API key.
*/
function extract(text, sourceUrl, icp, companyNameOverride, directoryUrl, pageSources = []) {
  const analysisPages = pageSources.filter(page => page.sourceType !== "web search");
  if (analysisPages.length) text = analysisPages.map(page => page.text).join(" | ");
  const lower = text.toLowerCase();
  const sourceForOffset = (offset) => {
    let pageOffset = 0;
    for (const page of analysisPages.length ? analysisPages : pageSources) {
      if (offset < pageOffset + page.text.length) return page.url;
      pageOffset += page.text.length + 3;
    }
    return sourceUrl;
  };
  const allEmailMatches = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
    .filter(match => !/^(noreply|no-reply|donotreply)@/i.test(match[0]));
  const contactAlias = /^(info|contact|support|customercare|customer-care|help|enquir(?:y|ies)|grievance|feedback|business|corporate|sales|care)(?:[._+-]|$)/i;
  const isContactPage = url => /contact|support|customer-care|help|grievance/i.test(new URL(url).pathname);
  const contactEmailMatches = allEmailMatches
    .filter(match => contactAlias.test(match[0].split("@")[0]) || isContactPage(sourceForOffset(match.index)))
    .sort((a, b) => Number(contactAlias.test(b[0].split("@")[0])) - Number(contactAlias.test(a[0].split("@")[0])));
  const emails = [...new Set(contactEmailMatches.map(match => match[0].toLowerCase()))].slice(0, 5);
  const labeledPhoneMatches = [...text.matchAll(/(?:phone|telephone|tel|mobile|call|hotline|contact)\s*(?:number)?\s*[:\-]?\s*(\+?\d[\d\s().-]{6,}\d)/gi)]
    .map(match => match[1]);
  const internationalPhoneMatches = [...text.matchAll(/(?<!\w)\+\d{1,3}(?:[\s().-]*\d){7,14}(?!\w)/g)]
    .map(match => match[0]);
  const phones = normalizePhoneNumbers([...labeledPhoneMatches, ...internationalPhoneMatches]).slice(0, 5);
  const email = emails[0] || "";
  const phone = phones[0] || "";

  const industry =
    /digital marketing|seo agency|performance marketing|social media marketing|lead generation|content marketing|branding and web design|web design|paid media|growth marketing/i.test(text) ? "Digital Marketing" :
    /clinic|healthcare|hospital|medical center|medical centre|doctor|patient care/i.test(text) ? "Healthcare" :
    /recruitment|staffing|talent acquisition|placement agency|executive search/i.test(text) ? "Recruitment" :
    /banking|financial services|bank|fintech|credit union/i.test(text) ? "Banking & Financial Services" :
    /insurance|insurer|insurance broker/i.test(text) ? "Insurance" :
    /ecommerce|e-commerce|d2c|online store/i.test(text) ? "E-commerce" :
    /school|education|university|college/i.test(text) ? "Education" :
    /real estate|property management|realtor/i.test(text) ? "Real Estate" :
    /logistics|shipping|freight|courier/i.test(text) ? "Logistics" :
    /retail|retailer|store locations/i.test(text) ? "Retail" :
    /hotel|hospitality|travel|airline|tourism/i.test(text) ? "Travel & Hospitality" :
    /telecom|telecommunications|mobile network/i.test(text) ? "Telecommunications" :
    /utility|utilities|electricity provider|water provider/i.test(text) ? "Utilities" :
    /automotive|car dealership|vehicle service/i.test(text) ? "Automotive" :
    /manufacturing|manufacturer|factory/i.test(text) ? "Manufacturing" :
    /restaurant|food delivery|quick service restaurant/i.test(text) ? "Food & Restaurants" :
    /professional services|consulting|law firm|accounting firm/i.test(text) ? "Professional Services" :
    /software as a service|\bsaas\b|software company/i.test(text) ? "SaaS" : "Unknown";

  const detectedUseCases = DAKINI_USE_CASE_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
  const voiceUseCase = detectedUseCases.length > 0 ||
    /voice agent|voice automation|automated calls|high call volume|inbound calls|outbound calls/i.test(text);
  const voiceHiringSignal =
    /(?:hiring|careers|recruit(?:ing|ment)?)\s+(?:\w+\s+){0,3}(?:telecallers?|telesales|call center|contact center|customer support|customer service|support agents?|sales (?:agents?|representatives?))/i.test(text) ||
    /(?:telecallers?|telesales|call center|contact center|customer support|customer service|support agents?|sales (?:agents?|representatives?))\s+(?:\w+\s+){0,3}(?:hiring|careers|recruit(?:ing|ment)?)/i.test(text);
  const hiringSignal = /hiring|careers|recruit/i.test(text);
  const automationIntentEvidence = findBuyingIntentSignal(text);
  const automationIntent = Boolean(automationIntentEvidence);

  const expansionSignal =
    /expansion|new branch|branches|branch opening|branch opened|new location|new service|new product|acquisition|acquired|launch(?:ed)?|rapid growth|scaling(?: up)?/i.test(text);

  const languages = ["Hindi", "English", "Tamil", "Telugu", "Kannada", "Marathi", "Bengali", "Gujarati", "Malayalam", "Punjabi", "Odia"].filter(x =>
    lower.includes(x.toLowerCase())
  );

  const branchesMatch = text.match(/(\d{1,4})\s*(?:branches|branch)/i);
  const branches = branchesMatch ? Number(branchesMatch[1]) : 0;
  const locations = [...new Set([
    ...icp.locations.filter(location => lower.includes(location.toLowerCase())),
    ...findIndiaLocations(text)
  ])];
  const indiaMarketSignal = hasIndiaGeographicSignal(text);
  const multilingualSignal = languages.length >= 2 ||
    /multilingual|multiple languages|regional languages|local languages|dialects|accents/i.test(text);
  const callingTeam = /customer support team|customer service team|customer service representatives?|support agents?|sales team|sales representatives?|call center|contact center|telecallers?|telesales/i.test(text);
  const highCallVolume = /high[- ]volume calls?|large call volumes?|heavy call volumes?|thousands of calls|large customer base|millions of customers|peak (?:season|demand|shopping)|surge in (?:calls|enquiries|inquiries)|(?:hundreds|thousands|millions) of (?:customers|users|members)|serv(?:e|es|ing)\s+(?:over\s+)?\d[\d,.]*\s+(?:customers|users|members)/i.test(text);
  const extendedHours = dataHasExtendedHours(text);
  const telephonyOrCrm = /crm|freshdesk|salesforce|hubspot|zendesk|intercom|helpdesk|telephony|contact center platform|booking software/i.test(text);
  const systemIntegrationSignal = /integrat(?:e|es|ed|ing|ion)|API|customer (?:database|records|information)|existing systems|sales tools|CRM workflow|booking software|helpdesk/i.test(text);
  const aiSolutionProvider = isAiSolutionProviderEvidence([{ title: "", description: text }]);

  const companyName = companyNameOverride ||
    text.match(/(?:company|organisation|organization|business)\s*[:\-]\s*([^|.!?\n]{2,80})/i)?.[1]?.trim()
    || new URL(sourceUrl).hostname.replace(/^www\./, "");

  const evidence = [];
  const addEvidence = (field, pattern, confidence = 0.85) => {
    const match = text.match(pattern);
    if (match) {
      const blockStart = text.lastIndexOf("|", match.index) + 1;
      const blockEnd = text.indexOf("|", match.index);
      const start = blockStart;
      const end = blockEnd < 0 ? text.length : blockEnd;
      const quote = text.slice(start, end).trim();
      evidence.push({
        field,
        value: match[0],
        quote: quote.length > 180 ? `${quote.slice(0, 177)}...` : quote,
        source_url: sourceForOffset(match.index),
        confidence
      });
    }
  };
  if (industry !== "Unknown") addEvidence("industry", /digital marketing|seo agency|performance marketing|social media marketing|lead generation|content marketing|branding and web design|web design|paid media|growth marketing|clinic|healthcare|hospital|medical center|medical centre|recruitment|staffing|talent acquisition|banking|financial services|fintech|insurance|ecommerce|e-commerce|d2c|online store|school|education|university|college|real estate|property management|logistics|shipping|freight|courier|retail|hotel|hospitality|travel|airline|telecom|utilities|automotive|manufacturing|restaurant|professional services|consulting|law firm|software as a service|saas/i);
  if (detectedUseCases.length) addEvidence("voiceUseCase", /customer support|customer service|help ?desk|contact center|call center|appointment|booking|lead qualification|order status|sales follow.?up|knowledge agent|FAQs?/i);
  if (voiceHiringSignal) addEvidence("voiceHiring", /(?:hiring|careers|recruit(?:ing|ment)?).{0,60}(?:telecallers?|call center|contact center|customer support)|(?:telecallers?|call center|contact center|customer support).{0,60}(?:hiring|careers|recruit(?:ing|ment)?)/i);
  if (automationIntentEvidence) {
    const quoteStart = Math.max(0, automationIntentEvidence.index - 60);
    const quoteEnd = Math.min(text.length, automationIntentEvidence.index + automationIntentEvidence[0].length + 60);
    evidence.push({
      field: "automationIntent",
      value: automationIntentEvidence[0],
      quote: text.slice(quoteStart, quoteEnd).trim(),
      source_url: sourceForOffset(automationIntentEvidence.index),
      confidence: 0.85
    });
  }
  if (branches) addEvidence("operationalScale", /\d{1,4}\s*(?:branches|branch)/i);
  if (callingTeam) addEvidence("callingTeam", /customer support team|customer service team|customer service representatives?|support agents?|sales team|sales representatives?|call center|contact center|telecallers?|telesales/i);
  if (highCallVolume) addEvidence("highCallVolume", /high[- ]volume calls?|large call volumes?|heavy call volumes?|thousands of calls|large customer base|millions of customers|peak (?:season|demand|shopping)|surge in (?:calls|enquiries|inquiries)|(?:hundreds|thousands|millions) of (?:customers|users|members)|serv(?:e|es|ing)\s+(?:over\s+)?\d[\d,.]*\s+(?:customers|users|members)/i);
  if (extendedHours) addEvidence("extendedHours", /24\/7|24x7|around the clock|round.the.clock|extended hours|after.hours|outside normal business hours/i);
  if (indiaMarketSignal) addEvidence("indiaMarketFit", INDIA_GEOGRAPHIC_SIGNAL);
  if (multilingualSignal) addEvidence("multilingualFit", /multilingual|multiple languages|regional languages|local languages|dialects|accents|Hindi|Tamil|Telugu|Kannada|Marathi|Bengali|Gujarati|Malayalam|Punjabi|Odia/i);
  if (telephonyOrCrm) addEvidence("existingCustomerSystems", /crm|freshdesk|salesforce|hubspot|zendesk|intercom|helpdesk|telephony|contact center platform|booking software/i);
  if (systemIntegrationSignal) addEvidence("integrationReadiness", /integrat(?:e|es|ed|ing|ion)|API|customer (?:database|records|information)|existing systems|sales tools|CRM workflow|booking software|helpdesk/i);
  if (email) evidence.push({
    field: "roleEmail",
    value: email,
    quote: email,
    source_url: sourceForOffset(text.indexOf(email)),
    confidence: 0.95
  });
  if (phone) evidence.push({
    field: "phone",
    value: phone,
    quote: phone,
    source_url: sourceForOffset(text.indexOf(phone)),
    confidence: 0.95
  });
  for (const publicEmail of emails.slice(1)) evidence.push({
    field: "roleEmail",
    value: publicEmail,
    quote: publicEmail,
    source_url: sourceForOffset(text.indexOf(publicEmail)),
    confidence: 0.95
  });
  if (companyNameOverride) evidence.push({
    field: "companyName",
    value: companyNameOverride,
    quote: `${companyNameOverride} is listed in a public company directory.`,
    source_url: directoryUrl,
    confidence: 0.95
  });

  const confidence = evidence.length ? Math.min(0.85, 0.5 + evidence.length * 0.04) : 0.4;

  const data = {
    companyName,
    domain: normalizeDomain(sourceUrl),
    industry,
    voiceUseCase,
    detectedUseCases,
    companyActivities: summarizeActivities(text),
    dakiniRecommendations: getDakiniRecommendations(detectedUseCases),
    locations,
    sourceText: text,
    websiteWorkflowSignals: summarizeWebsiteWorkflowSignals(pageSources).workflows,
    callingTeam,
    branches,
    languages,
    multilingualSignal,
    indiaMarketSignal,
    highCallVolume,
    extendedHours,
    telephonyOrCrm,
    systemIntegrationSignal,
    hiringSignal,
    voiceHiringSignal,
    automationIntent,
    buyingSignal: automationIntent && !aiSolutionProvider,
    aiSolutionProvider,
    expansionSignal,
    fundingSignal: /funding|raised|series [a-z]/i.test(text),
    roleEmail: email,
    contactEmails: emails,
    phone,
    contactPhones: phones,
    contactPages: pageSources
      .filter(page => /contact|support|customer-care/i.test(new URL(page.url).pathname))
      .map(page => page.url),
    requiredFieldsComplete: Boolean(companyName && industry !== "Unknown"),
    confidence,
    evidence
  };

  const score = scoreLead(data, icp);
  delete data.sourceText;
  return { ...data, score };
}

function summarizeActivities(text) {
  const candidates = text.split(/\s*\|\s*|(?<=[.!?])\s+/)
    .map(value => value.replace(/\s+/g, " ").trim())
    .filter(value => value.length >= 35 && value.length <= 260)
    .filter(value => /customer|business|service|product|marketing|sales|support|lead|agency|growth|operations|campaign|brand/i.test(value))
    .filter(value => !/cookie|privacy policy|terms and conditions|javascript|copyright/i.test(value));
  return [...new Set(candidates)].slice(0, 3);
}

function getDakiniRecommendations(useCases) {
  return [...new Set(useCases.map(useCase => DAKINI_WORKFLOW_RECOMMENDATIONS[useCase]).filter(Boolean))];
}

function extractPageText(html) {
  const $ = cheerio.load(html);
  const contactLinks = $("a[href]").map((_, element) => {
    const href = $(element).attr("href") || "";
    if (/^mailto:/i.test(href)) return `Email: ${href.slice(7).split("?")[0]}`;
    if (/^tel:/i.test(href)) return `Phone: ${href.slice(4).split("?")[0]}`;
    return "";
  }).get().filter(Boolean);
  $("script, style, noscript, svg").remove();
  const title = $("title").text().trim();
  const description = $('meta[name="description"]').attr("content")?.trim() || "";
  const bodySegments = $("body").find("h1, h2, h3, p, li, th, td, address").map((_, element) =>
    $(element).text().replace(/\s+/g, " ").trim()
  ).get().filter(Boolean);
  const body = [...new Set(bodySegments)].join(" | ") || $("body").text().replace(/\s+/g, " ").trim();
  const text = [title, description, body, ...new Set(contactLinks)].filter(Boolean).join(" | ");
  return {
    $,
    title,
    text: text.slice(0, 100000),
    websiteWorkflowSignals: detectWebsiteWorkflowSignals(html)
  };
}

function companyNameFromWebsite(homepage, url) {
  const siteName = homepage.$('meta[property="og:site_name"]').attr("content")?.trim() ||
    homepage.$('meta[name="application-name"]').attr("content")?.trim() ||
    homepage.$('[itemprop="name"]').first().attr("content")?.trim() ||
    homepage.$('[itemprop="name"]').first().text().trim();
  if (siteName && siteName.length <= 100) return siteName;
  const titleName = homepage.title.split(/\s+[|:–—]\s+/)[0].trim();
  if (titleName && titleName.length <= 100 && !/^(home|homepage|welcome|official website)$/i.test(titleName)) {
    return titleName;
  }
  return new URL(url).hostname.replace(/^www\./i, "");
}

function extractRelevantPageLinks($, baseUrl) {
  const base = new URL(baseUrl);
  const baseDomain = normalizeDomain(baseUrl);
  const candidates = new Map();
  const relevantPath = /about|who-we-are|our-story|product|service|solution|business|contact|support|customer-care|help|career|job|investor|integration|platform|agent|faq|knowledge|case-stud|customer|industry|pricing|news|press|book|appointment|reservation|schedule/i;

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const label = $(element).text().replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) return;

    try {
      const url = new URL(href, baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) return;
      if (normalizeDomain(url.href) !== baseDomain) return;
      if (!relevantPath.test(`${url.pathname} ${label}`)) return;
      if (/\.(pdf|jpg|jpeg|png|gif|zip|docx?)(?:$|\?)/i.test(url.pathname)) return;
      url.hash = "";
      const normalizedUrl = url.href;
      if (normalizedUrl === base.href || candidates.has(normalizedUrl)) return;
      candidates.set(normalizedUrl, {
        url: normalizedUrl,
        label,
        priority: /contact|customer-care|help|grievance|support/i.test(`${url.pathname} ${label}`) ? 5 :
          /product|service|solution|agent|platform|integration|case-stud|customer|industry|knowledge|faq/i.test(`${url.pathname} ${label}`) ? 4 :
          /career|job|contact|about|who-we-are|our-story|business/i.test(`${url.pathname} ${label}`) ? 3 : 1
      });
    } catch {
      return;
    }
  });

  return [...candidates.values()].sort((a, b) => b.priority - a.priority).map(({ url }) => url);
}

function extractGenericDirectoryCompanies($, sourceUrl) {
  const baseDomain = normalizeDomain(sourceUrl);
  const seenDomains = new Set();
  const companies = [];
  $("a[href]").each((_, element) => {
    const name = $(element).text().replace(/\s+/g, " ").trim();
    const href = $(element).attr("href") || "";
    if (!name || name.length < 2 || name.length > 120 ||
        /^(home|about|contact|privacy|terms|login|sign in|read more|website|visit)$/i.test(name) ||
        /\.(pdf|jpg|jpeg|png|gif|zip|docx?)(?:$|\?)/i.test(href)) return;
    try {
      const url = new URL(href, sourceUrl);
      const domain = normalizeDomain(url.href);
      if (!isEligibleProspectUrl(url.href) || domain === baseDomain || seenDomains.has(domain)) return;
      seenDomains.add(domain);
      companies.push({ name, url: url.href });
    } catch {
      return;
    }
  });
  return companies;
}

function extractPublicDirectoryCompanies($, sourceUrl, source = {}) {
  if (source.directoryMode === "generic") {
    return extractGenericDirectoryCompanies($, sourceUrl);
  }
  return [];
}

function normalizeDirectoryNicheText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NON_PROSPECT_DOMAINS = new Set([
  "google.com", "bing.com", "brave.com", "duckduckgo.com",
  "youtube.com", "facebook.com", "instagram.com", "x.com", "twitter.com",
  "linkedin.com", "reddit.com", "wikipedia.org", "crunchbase.com",
  "techcrunch.com", "g2.com", "capterra.com", "amazon.com", "quora.com",
  "indeed.com", "glassdoor.com", "naukri.com", "ambitionbox.com"
]);
const PUBLIC_SOURCE_CATALOG = [];
const SOURCE_DISCOVERY_QUERY_TEMPLATES = [
  '"{industry}" "{location}" company directory and business listings',
  '"{industry}" "{location}" business directory company list',
  '"{industry}" "{location}" association member directory companies',
  '"{industry}" "{location}" company listings and service providers',
  '"{industry}" "{location}" directory company websites'
];

function isEligibleProspectUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const domain = normalizeDomain(value);
    return ![...NON_PROSPECT_DOMAINS].some(blocked =>
      domain === blocked || domain.endsWith(`.${blocked}`)
    );
  } catch {
    return false;
  }
}

function scoreSearchEvidence(evidence) {
  const text = evidence.map(item => `${item.title} ${item.description}`).join(" ").toLowerCase();
  return (
    (/\b(rfp|request for proposal|looking for|seeking|pilot|vendor|deployment|implement(?:ation|ing)?)\b/.test(text) ? 5 : 0) +
    (/\bvoice ai|ai voice|voice agent|voice bot|voice automation\b/.test(text) ? 5 : 0) +
    (/\b(customer support|customer service|customer care|lead qualification|sales follow-up|call center|contact center|faq|knowledge agent)\b/.test(text) ? 4 : 0) +
    (/\b(multilingual|indian languages|hindi|tamil|telugu|marathi|24\/7|high[- ]volume|thousands of calls)\b/.test(text) ? 3 : 0) +
    Math.min(evidence.length, 4)
  );
}

function isAiSolutionProviderEvidence(evidence) {
  const text = evidence.map(item => `${item.title} ${item.description}`).join(" ").toLowerCase();
  return /\b(?:voice[- ]ai|ai voice|voice agent|conversational ai|contact[- ]center|call[- ]center)\s+(?:agent|platform|software|solution|api|technology|provider|vendor|product|tool)s?\b/i.test(text) ||
    /\b(?:we (?:build|offer|provide|sell|develop|power)|our (?:platform|software|product|solution)|leading provider of)\b.{0,100}\b(?:voice ai|voice agent|conversational ai|contact center automation|ai sales agent)\b/i.test(text) ||
    /\b(?:best|top)\s+\d*\s*(?:ai voice|voice ai|voice agent|ai sales agent|contact center software)\b/i.test(text);
}

async function waitForSearchRateLimit() {
  if (BRAVE_SEARCH_API_KEY || FIRECRAWL_API_KEY) return;
  const previous = freeSearchQueue;
  let release;
  freeSearchQueue = new Promise(resolve => {
    release = resolve;
  });
  await previous;
  try {
    const waitMs = Math.max(0, nextFreeSearchStartedAt - Date.now());
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    nextFreeSearchStartedAt = Date.now() + 1500;
  } finally {
    release();
  }
}

function decodeBingUrl(href) {
  try {
    const url = new URL(href);
    if (url.hostname.includes("bing.com") && url.pathname.includes("/ck/a")) {
      const u = url.searchParams.get("u");
      if (u) {
        let base64Part = u.startsWith("a1") ? u.slice(2) : u;
        base64Part = base64Part.replace(/-/g, "+").replace(/_/g, "/");
        while (base64Part.length % 4 !== 0) {
          base64Part += "=";
        }
        const decoded = Buffer.from(base64Part, "base64").toString("utf-8");
        if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
          return decoded;
        }
      }
    }
  } catch {}
  return href;
}

async function searchBing(query, limit = 20) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!response.ok) throw new Error(`Bing returned HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const results = [];
  $("li.b_algo").each((_, el) => {
    if (results.length >= limit) return false;
    const title = $(el).find("h2 a").text().trim();
    const href = $(el).find("h2 a").attr("href") || "";
    const snippet = $(el).find(".b_caption p").text().trim() || $(el).find("p").text().trim();
    if (title && href) {
      const finalUrl = decodeBingUrl(href);
      if (finalUrl.startsWith("http")) {
        results.push({
          url: finalUrl,
          title: title.slice(0, 240),
          description: snippet.slice(0, 1000)
        });
      }
    }
  });
  return results;
}

async function searchDuckDuckGo(query, limit = 20) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const results = [];
  $(".result__body").each((_, el) => {
    if (results.length >= limit) return false;
    const title = $(el).find(".result__title a").text().trim();
    const rawHref = $(el).find(".result__title a").attr("href") || "";
    let finalUrl = rawHref;
    try {
      const parsedUrl = new URL(rawHref, "https://duckduckgo.com");
      const uddg = parsedUrl.searchParams.get("uddg");
      if (uddg) finalUrl = decodeURIComponent(uddg);
    } catch {}
    const snippet = $(el).find(".result__snippet").text().trim();
    if (title && finalUrl && finalUrl.startsWith("http")) {
      results.push({
        url: finalUrl,
        title: title.slice(0, 240),
        description: snippet.slice(0, 1000)
      });
    }
  });
  return results;
}

async function searchWeb(query, limit = MAX_RESULTS_PER_SEARCH) {
  if (BRAVE_SEARCH_API_KEY) {
    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(limit));
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_SEARCH_API_KEY }
      });
      if (response.ok) {
        const data = await response.json();
        const results = data.web?.results || [];
        return results
          .filter(result => result.url && isEligibleProspectUrl(result.url))
          .map(result => ({
            url: result.url,
            title: String(result.title || "").slice(0, 240),
            description: String(result.description || result.snippet || "").slice(0, 1000)
          }));
      }
    } catch (err) {
      console.warn("Brave search failed, falling back to live search:", err.message);
    }
  }

  if (FIRECRAWL_API_KEY) {
    try {
      const response = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": `Bearer ${FIRECRAWL_API_KEY}`
        },
        body: JSON.stringify({ query, limit, sources: ["web"] })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success !== false) {
          const results = data.data?.web || [];
          return results
            .filter(result => result.url && isEligibleProspectUrl(result.url))
            .map(result => ({
              url: result.url,
              title: String(result.title || "").slice(0, 240),
              description: String(result.description || result.snippet || "").slice(0, 1000)
            }));
        }
      }
    } catch (err) {
      console.warn("Firecrawl search failed, falling back to live search:", err.message);
    }
  }

  try {
    const liveResults = await searchBing(query, Math.min(limit, 20));
    if (liveResults.length > 0) {
      return liveResults.filter(result => result.url && isEligibleProspectUrl(result.url));
    }
  } catch (err) {
    console.warn("Bing live search failed, trying DuckDuckGo fallback:", err.message);
  }

  try {
    const ddgResults = await searchDuckDuckGo(query, Math.min(limit, 20));
    return ddgResults.filter(result => result.url && isEligibleProspectUrl(result.url));
  } catch (err) {
    console.warn("DuckDuckGo fallback also failed:", err.message);
    return [];
  }
}

function createDiscoveryJob(kind) {
  const targetProfiles = [...icps.values()];
  const configuredIndustries = [...new Set(targetProfiles
    .flatMap(profile => Array.isArray(profile.industries) ? profile.industries : [])
    .filter(industry => typeof industry === "string" && industry.trim())
    .map(industry => industry.trim()))];
  const anyLocation = targetProfiles.some(profile =>
    profile.anyLocation === true || !Array.isArray(profile.locations) || profile.locations.length === 0
  );
  const allowNonIndianCompanies = anyLocation || targetProfiles.some(profile => {
    const locations = (Array.isArray(profile.locations) ? profile.locations : [])
      .filter(location => typeof location === "string" && location.trim());
    return locations.some(location =>
      !isIndiaTargetLocation(location) &&
      !INDIA_CITIES.some(city => city.toLowerCase() === location.toLowerCase())
    );
  });
  const selectedIndustries = configuredIndustries.some(industry =>
    /^(?:all(?:\s+(?:industr(?:y|ies)|sectors?))?|any\s+industry)$/i.test(industry)
  ) ? DISCOVERY_INDUSTRIES : configuredIndustries;
  const searchLocations = dailyDiscoveryLocations();
  const searchIndustries = selectedIndustries.length ? selectedIndustries : DISCOVERY_INDUSTRIES;
  const dailyTargetEnabled = kind === "daily_web_discovery" ||
    (kind === "engine_web_discovery" && engineState.mode === "daily");
  const searchQueries = selectDailyDiscoveryQueries(
    new Date(),
    searchLocations,
    searchIndustries,
    anyLocation,
    0
  );
  return {
    id: id(),
    kind,
    status: "queued",
    anyLocation,
    allowNonIndianCompanies,
    dailyTargetEnabled,
    dailyQualifiedProspectsTarget: dailyTargetEnabled
      ? DAILY_QUALIFIED_PROSPECT_TARGET
      : null,
    dailyWindowEndsAt: dailyTargetEnabled
      ? getNextDiscoveryRun().toISOString()
      : null,
    dailySearchLocations: searchLocations,
    dailySearchIndustries: searchIndustries,
    dailyBatchIndex: 0,
    searchBatches: 0,
    totalSearchesCompleted: 0,
    completedSearchQueries: [],
    searchesCompleted: 0,
    totalSearchQueries: searchQueries.length,
    searchQueries,
    searchResults: 0,
    companiesVisited: 0,
    pages: 0,
    records: 0,
    newHighPotentialProspects: 0,
    qualifiedProspectsAdded: 0,
    companiesSaved: 0,
    rateLimited: false,
    maxPagesPerCompany: MAX_PAGES_PER_COMPANY,
    discoveredCompanies: [],
    errors: []
  };
}

function dailyDiscoveryLocations() {
  const locations = [];
  for (const profile of icps.values()) {
    const profileLocations = Array.isArray(profile.locations) ? profile.locations : [];
    locations.push(...profileLocations.filter(location =>
      typeof location === "string" && location.trim()
    ));
    locations.push(...(Array.isArray(profile.areas) ? profile.areas : []));
    if (profileLocations.some(location =>
      typeof location === "string" && location.toLowerCase() === "india"
    )) {
      locations.push(...INDIA_DISCOVERY_LOCATIONS);
    }
  }
  return [...new Set(locations
    .filter(location => typeof location === "string")
    .map(location => location.trim())
    .filter(Boolean))];
}

async function runDiscoveryJob(job) {
  const genericVoiceAgentIcp = {
    industries: [],
    locations: job.allowNonIndianCompanies ? [] : INDIA_DISCOVERY_LOCATIONS,
    anyLocation: Boolean(job.allowNonIndianCompanies),
    useCases: [
      "customer support",
      "appointment scheduling",
      "lead qualification",
      "order support",
      "branch and service queries",
      "reservations and bookings",
      "healthcare intake",
      "technical support",
      "dispatch and field service"
    ]
  };
  job.maxPagesPerCompany = MAX_PAGES_PER_COMPANY;
  const prospectsByDomain = new Map((job.discoveredCompanies || [])
    .filter(prospect => prospect?.domain && prospect?.url)
    .map(prospect => [prospect.domain, {
      domain: prospect.domain,
      url: prospect.url,
      evidence: Array.isArray(prospect.evidence) ? prospect.evidence : []
    }]));
  const completedSearchIndexes = new Set(job.completedSearchQueryIndexes || []);
  job.completedSearchQueries ??= [...completedSearchIndexes]
    .map(index => job.searchQueries[index])
    .filter(Boolean);
  const completedSearchQueries = new Set(job.completedSearchQueries);
  for (const queryIndex of completedSearchIndexes) {
    const query = job.searchQueries[queryIndex];
    if (query) completedSearchQueries.add(query);
  }
  job.completedSearchQueries = [...completedSearchQueries];
  const completedCompanyDomains = new Set(job.completedCompanyDomains || []);
  const resuming = job.status === "interrupted";
  job.status = "running";
  job.startedAt ||= new Date().toISOString();
  if (resuming) job.resumedAt = new Date().toISOString();
  job.searchQueries ||= [];
  job.rateLimited = false;
  discoveryState.activeJobId = job.id;
  discoveryState.lastError = "";
  persistState();

  try {
    const searchConcurrency = BRAVE_SEARCH_API_KEY || FIRECRAWL_API_KEY
      ? AUTHENTICATED_SEARCH_CONCURRENCY
      : 1;
    await runWithConcurrency(job.searchQueries, searchConcurrency, async (query, queryIndex) => {
      if (completedSearchIndexes.has(queryIndex)) return;
      if (job.rateLimited) return;
      job.currentQuery = query;
      const wasCompleted = completedSearchIndexes.has(queryIndex);
      engineState.currentActivity = `Live search: ${query}`;
      recordEngineEvent("search", `Search query: ${query}`);
      try {
        await waitForSearchRateLimit();
        const results = await searchWeb(query);
        for (const result of results) {
          const domain = normalizeDomain(result.url);
          const existing = prospectsByDomain.get(domain) || {
            domain,
            url: new URL(result.url).origin,
            evidence: []
          };
          const matchingEvidence = existing.evidence.find(item => item.url === result.url);
          if (matchingEvidence) {
            matchingEvidence.queries ??= matchingEvidence.query ? [matchingEvidence.query] : [];
            if (!matchingEvidence.queries.includes(query)) matchingEvidence.queries.push(query);
          } else {
            existing.evidence.push({
              url: result.url,
              title: result.title,
              description: result.description,
              queries: [query]
            });
          }
          prospectsByDomain.set(domain, existing);
        }
        completedSearchIndexes.add(queryIndex);
      } catch (error) {
        job.errors.push({ query, reason: error.message });
        if (/HTTP 429\b/.test(error.message)) {
          job.rateLimited = true;
        } else {
          completedSearchIndexes.add(queryIndex);
        }
      }
      if (!wasCompleted && completedSearchIndexes.has(queryIndex)) {
        job.totalSearchesCompleted = (job.totalSearchesCompleted || 0) + 1;
        completedSearchQueries.add(query);
        job.completedSearchQueries = [...completedSearchQueries];
      }
      job.completedSearchQueryIndexes = [...completedSearchIndexes].sort((a, b) => a - b);
      job.searchesCompleted = completedSearchIndexes.size;
      job.searchResults = [...prospectsByDomain.values()].length;
      job.discoveredCompanies = [...prospectsByDomain.values()];
      persistState();
    });

    const prospects = [...prospectsByDomain.values()]
      .filter(prospect => !isAiSolutionProviderEvidence(prospect.evidence))
      .filter(prospect =>
        job.kind === "manual_geographic_discovery" ||
        hasRelevantDiscoveryEvidence(prospect.evidence)
      )
      .sort((a, b) => scoreSearchEvidence(b.evidence) - scoreSearchEvidence(a.evidence) ||
        b.evidence.length - a.evidence.length)
      .filter(prospect =>
        !scrapedDomains.has(prospect.domain) &&
        !completedCompanyDomains.has(prospect.domain)
      );
    job.discoveredCompanies = prospects;
    job.completedCompanyDomains = [...completedCompanyDomains];
    persistState();
    recordEngineEvent("found", `Discovered ${prospects.length} candidate company websites to crawl and score`);
    engineState.currentActivity = `Evaluating ${prospects.length} live candidates against Dakini AI ICP`;

    let nextProspectIndex = 0;
    let activeDailyTargetReservations = 0;
    const workerCount = Math.min(DISCOVERY_CRAWL_CONCURRENCY, prospects.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextProspectIndex < prospects.length) {
        if (job.dailyTargetEnabled) {
          const qualifiedToday = countDailyQualifiedProspects(
            companies,
            new Date(),
            DISCOVERY_TIME_ZONE
          );
          if (qualifiedToday + activeDailyTargetReservations >=
              job.dailyQualifiedProspectsTarget) {
            break;
          }
          activeDailyTargetReservations += 1;
        }
        const prospect = prospects[nextProspectIndex];
        nextProspectIndex += 1;
        engineState.currentActivity = `Crawling ${prospect.url} (${nextProspectIndex}/${prospects.length})`;
        recordEngineEvent("crawl", `Crawling ${prospect.url}`, { domain: prospect.domain });
        const evidencePages = prospect.evidence.map(item => ({
          url: item.url,
          title: item.title,
          text: `${item.title}. ${item.description}`.trim(),
          sourceType: "web search"
        }));
        const companyRecord = await crawlCompanySite(
          job,
          prospect.url,
          genericVoiceAgentIcp,
          undefined,
          "",
          WEB_SEARCH_PROVIDER.toLowerCase().replaceAll(" ", "-"),
          undefined,
          evidencePages,
          true
        );
        const indianCompany = companyRecord &&
          (companyRecord.indiaMarketSignal || /\.in$/i.test(companyRecord.domain));
        if (companyRecord?.industry !== "Unknown" &&
            (job.allowNonIndianCompanies || indianCompany)) {
          job.companiesSaved += 1;
          const isQualifiedLead = companyRecord.legitimacy?.canAutoQualify &&
            (job.dailyTargetEnabled
              ? companyRecord.score.tier === "Priority" &&
                companyRecord.score.score >= HIGH_POTENTIAL_SCORE_THRESHOLD
              : ["Priority", "Review"].includes(companyRecord.score.tier));
          if (isQualifiedLead) {
            job.qualifiedProspectsAdded += 1;
            engineState.totalProspectsFound += 1;
            if (companyRecord.score.tier === "Priority") job.newHighPotentialProspects += 1;
            recordEngineEvent("prospect_added", `Qualified Lead: ${companyRecord.companyName} (${companyRecord.score.tier} · ${companyRecord.score.score}/100) — Workflows: ${companyRecord.score.dakiniWorkflowMatches?.join(", ") || "Customer Service"}`, {
              companyName: companyRecord.companyName,
              tier: companyRecord.score.tier,
              score: companyRecord.score.score,
              domain: prospect.domain,
              sourceUrl: companyRecord.sourceUrl
            });
          } else {
            recordEngineEvent("candidate_review", `Candidate not counted as a high-potential lead: ${companyRecord.companyName} (${companyRecord.score.tier} · ${companyRecord.score.score}/100 ICP fit · ${companyRecord.legitimacy?.status || "not assessed"} · ${companyRecord.legitimacy?.score || 0}/100 evidence)`, {
              companyName: companyRecord.companyName,
              tier: companyRecord.score.tier,
              score: companyRecord.score.score,
              legitimacy: companyRecord.legitimacy,
              domain: prospect.domain,
              sourceUrl: companyRecord.sourceUrl
            });
          }
          if (job.dailyTargetEnabled) {
            job.dailyQualifiedProspects = countDailyQualifiedProspects(
              companies,
              new Date(),
              DISCOVERY_TIME_ZONE
            );
          }
        } else if (companyRecord) {
          companies.delete(normalizeDomain(prospect.url));
        }
        if (companyRecord) completedCompanyDomains.add(prospect.domain);
        job.completedCompanyDomains = [...completedCompanyDomains];
        if (job.dailyTargetEnabled) activeDailyTargetReservations -= 1;
        persistState();
      }
    }));

    job.status = job.errors.length ? "completed_with_errors" : "completed";
    job.completedAt = new Date().toISOString();
    discoveryState.lastRunAt = job.completedAt;
    discoveryState.lastRunSummary = {
      qualifiedProspectsAdded: job.qualifiedProspectsAdded,
      companiesSaved: job.companiesSaved,
      newHighPotentialProspects: job.newHighPotentialProspects,
      sitesVisited: job.companiesVisited,
      pagesScanned: job.pages,
      errors: job.errors.length,
      rateLimited: Boolean(job.rateLimited)
    };
    if (job.errors.length) {
      discoveryState.lastError = `${job.errors.length} search or website fetch error(s); see the discovery job for details.`;
      if (job.rateLimited) {
        discoveryState.lastError += " Search provider quota/rate limit reached; configure an authenticated provider for higher-volume daily discovery.";
      }
    } else {
      discoveryState.lastError = "";
    }
  } catch (error) {
    job.status = "failed";
    job.error = error.message;
    job.completedAt = new Date().toISOString();
    discoveryState.lastError = error.message;
  } finally {
    discoveryState.activeJobId = null;
    discoveryState.nextRunAt = getNextDiscoveryRun().toISOString();
    persistState();
  }
  while (jobs.size > 120) jobs.delete(jobs.keys().next().value);
}

async function runDailyDiscoveryUntilTarget(job) {
  job.dailyTargetEnabled = true;
  job.dailyQualifiedProspectsTarget ??= DAILY_QUALIFIED_PROSPECT_TARGET;
  job.dailyWindowEndsAt ||= getNextDiscoveryRun().toISOString();
  job.dailySearchLocations ??= dailyDiscoveryLocations();
  job.dailySearchIndustries ??= DISCOVERY_INDUSTRIES;
  job.dailyBatchIndex ??= 0;
  job.searchBatches ??= 0;
  job.totalSearchesCompleted ??= 0;
  job.completedSearchQueries ??= [];
  let resumeCurrentBatch = job.status === "interrupted";
  let stopReason = "";

  while (true) {
    const qualifiedToday = countDailyQualifiedProspects(
      companies,
      new Date(),
      DISCOVERY_TIME_ZONE
    );
    job.dailyQualifiedProspects = qualifiedToday;
    if (qualifiedToday >= job.dailyQualifiedProspectsTarget) {
      stopReason = "target_reached";
      break;
    }
    if (Date.now() >= Date.parse(job.dailyWindowEndsAt)) {
      stopReason = "daily_window_ended";
      break;
    }
    if (job.rateLimited) {
      stopReason = "provider_rate_limit";
      break;
    }

    if (!resumeCurrentBatch && job.searchBatches > 0) {
      job.dailyBatchIndex += 1;
      const batchQueries = selectDailyDiscoveryQueries(
        new Date(),
        job.dailySearchLocations,
        job.dailySearchIndustries,
        Boolean(job.anyLocation),
        job.dailyBatchIndex
      );
      const completedQueries = new Set(job.completedSearchQueries);
      job.searchQueries = batchQueries.filter(query => !completedQueries.has(query));
      if (!job.searchQueries.length) {
        stopReason = "search_space_exhausted";
        break;
      }
      job.totalSearchQueries = job.searchQueries.length;
      job.completedSearchQueryIndexes = [];
      job.searchesCompleted = 0;
      job.discoveredCompanies = [];
    }

    resumeCurrentBatch = false;
    if (job.status !== "interrupted") job.searchBatches += 1;
    job.status = "queued";
    job.rateLimited = false;
    discoveryState.activeJobId = job.id;
    engineState.currentActivity =
      `Daily target: ${qualifiedToday}/${job.dailyQualifiedProspectsTarget} qualified prospects · search batch ${job.searchBatches}`;
    persistState();
    await runDiscoveryJob(job);
    if (job.status === "failed") {
      stopReason = "discovery_failed";
      break;
    }
  }

  const finalQualifiedToday = countDailyQualifiedProspects(
    companies,
    new Date(),
    DISCOVERY_TIME_ZONE
  );
  job.dailyQualifiedProspects = finalQualifiedToday;
  job.dailyTargetMet = finalQualifiedToday >= job.dailyQualifiedProspectsTarget;
  job.dailyTargetShortfall = Math.max(
    0,
    job.dailyQualifiedProspectsTarget - finalQualifiedToday
  );
  job.dailyTargetStopReason = stopReason;
  job.completedAt = new Date().toISOString();
  if (job.status !== "failed") {
    job.status = job.errors?.length ? "completed_with_errors" : "completed";
  }
  discoveryState.activeJobId = null;
  discoveryState.lastRunAt = job.completedAt;
  discoveryState.lastRunSummary = {
    qualifiedProspectsAdded: job.qualifiedProspectsAdded || 0,
    companiesSaved: job.companiesSaved || 0,
    newHighPotentialProspects: job.newHighPotentialProspects || 0,
    sitesVisited: job.companiesVisited || 0,
    pagesScanned: job.pages || 0,
    dailyQualifiedProspects: finalQualifiedToday,
    dailyTarget: job.dailyQualifiedProspectsTarget,
    dailyTargetMet: job.dailyTargetMet,
    dailyTargetShortfall: job.dailyTargetShortfall,
    dailyTargetStopReason: stopReason,
    searchBatches: job.searchBatches,
    totalSearchesCompleted: job.totalSearchesCompleted || 0,
    errors: job.errors?.length || 0,
    rateLimited: Boolean(job.rateLimited)
  };
  if (stopReason === "target_reached") {
    engineState.currentActivity = `Daily target reached: ${finalQualifiedToday}/${job.dailyQualifiedProspectsTarget}`;
    recordEngineEvent(
      "cycle_done",
      `Daily qualified-prospect target reached: ${finalQualifiedToday}/${job.dailyQualifiedProspectsTarget}`
    );
  } else if (stopReason !== "discovery_failed") {
    engineState.currentActivity =
      `Daily target shortfall: ${finalQualifiedToday}/${job.dailyQualifiedProspectsTarget} · ${stopReason}`;
    recordEngineEvent(
      "info",
      `Daily discovery stopped (${stopReason}): ${finalQualifiedToday}/${job.dailyQualifiedProspectsTarget} qualified prospects`
    );
  }
  persistState();
  return job;
}

function getNextDiscoveryRun(now = new Date()) {
  const [hour, minute] = DISCOVERY_TIME.split(":").map(Number);
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: DISCOVERY_TIME_ZONE }));
  const localTarget = new Date(localNow);
  localTarget.setHours(hour, minute, 0, 0);
  if (localTarget <= localNow) localTarget.setDate(localTarget.getDate() + 1);
  return new Date(now.getTime() + (localTarget.getTime() - localNow.getTime()));
}

function scheduleDailyDiscovery() {
  scheduleDailyDiscoveryAt(getNextDiscoveryRun());
}

let engineTimeout = null;

function scheduleNextEngineCycle() {
  if (isShuttingDown) return;
  if (engineTimeout) {
    clearTimeout(engineTimeout);
    engineTimeout = null;
  }
  if (!engineState.enabled) {
    engineState.status = "paused";
    engineState.currentActivity = "Engine paused by operator";
    persistState();
    return;
  }

  let delayMs = 25000;
  if (engineState.mode === "continuous") {
    delayMs = 25000;
  } else if (engineState.mode === "interval") {
    delayMs = Math.max(1, Number(engineState.intervalMinutes || 15)) * 60 * 1000;
  } else if (engineState.mode === "daily") {
    const nextRun = getNextDiscoveryRun();
    delayMs = Math.max(1000, nextRun.getTime() - Date.now());
  }

  const nextDate = new Date(Date.now() + delayMs);
  engineState.nextRunAt = nextDate.toISOString();
  engineState.status = "idle";
  engineState.currentActivity = engineState.mode === "continuous"
    ? `Idle · Next autonomous cycle in ${Math.round(delayMs / 1000)}s`
    : `Scheduled for ${new Intl.DateTimeFormat("en-US", { timeStyle: "short", dateStyle: "short", timeZone: DISCOVERY_TIME_ZONE }).format(nextDate)}`;
  discoveryState.nextRunAt = engineState.nextRunAt;
  persistState();

  engineTimeout = setTimeout(async () => {
    await backgroundTasks.track(triggerEngineCycle(), "Autonomous engine cycle");
  }, Math.min(delayMs, 2147483647));
}

async function triggerEngineCycle(force = false) {
  if (isShuttingDown || (!engineState.enabled && !force)) return;
  if (discoveryState.activeJobId || hasActiveCrawlJob() || discoveryState.activeSourceDiscoveryJobId) {
    recordEngineEvent("info", "Engine waiting: another job is currently active");
    scheduleNextEngineCycle();
    return;
  }

  engineState.status = "running";
  engineState.cycleCount += 1;
  recordEngineEvent("cycle_start", `Autonomous scraping cycle #${engineState.cycleCount} started`);
  engineState.currentActivity = `Cycle #${engineState.cycleCount} in progress · Searching & scraping live prospects`;
  persistState();

  try {
    if (engineState.mode === "daily" || engineState.cycleCount % 5 === 1) {
      recordEngineEvent("info", "Source discovery was scrapped; skipping public-directory scanning");
      try {
        await runScheduledPublicDirectoryRetrieval("daily_public_directory_retrieval", null, true);
      } catch (e) {
        console.warn("Directory scan error:", e.message);
      }
    }

    const job = createDiscoveryJob("engine_web_discovery");
    jobs.set(job.id, job);
    discoveryState.activeJobId = job.id;
    persistState();

    if (job.dailyTargetEnabled) {
      await runDailyDiscoveryUntilTarget(job);
    } else {
      await runDiscoveryJob(job);
    }

    engineState.lastCycleAt = new Date().toISOString();
    recordEngineEvent("cycle_done", `Cycle #${engineState.cycleCount} complete. +${job.qualifiedProspectsAdded || 0} qualified prospects (${job.companiesVisited} sites scanned)`);
  } catch (error) {
    recordEngineEvent("error", `Cycle #${engineState.cycleCount} error: ${error.message}`);
    engineState.currentActivity = `Cycle #${engineState.cycleCount} error: ${error.message}`;
  } finally {
    persistState();
    scheduleNextEngineCycle();
  }
}

function scheduleDailyDiscoveryAt(nextRun) {
  if (isShuttingDown) return;
  if (dailyDiscoveryTimeout) clearTimeout(dailyDiscoveryTimeout);
  discoveryState.nextRunAt = nextRun.toISOString();
  persistState();
  const delay = Math.min(nextRun.getTime() - Date.now(), 2147483647);
  dailyDiscoveryTimeout = setTimeout(async () => {
    dailyDiscoveryTimeout = null;
    if (discoveryState.activeJobId || hasActiveCrawlJob()) {
      scheduleDailyDiscoveryAt(new Date(Date.now() + 60000));
      return;
    }
    await backgroundTasks.track((async () => {
      try {
        await runSourceDiscoveryJob("daily_source_discovery");
        await runScheduledPublicDirectoryRetrieval("daily_public_directory_retrieval", null, true);
        const job = createDiscoveryJob("daily_web_discovery");
        jobs.set(job.id, job);
        await runDailyDiscoveryUntilTarget(job);
      } catch (error) {
        discoveryState.lastError = `Scheduled discovery failed: ${error.message}`;
        persistState();
      } finally {
        if (!isShuttingDown) scheduleDailyDiscovery();
      }
    })(), "Scheduled daily discovery");
  }, delay);
}

function dataHasExtendedHours(text) {
  return /24\/7|24x7|around the clock|round.the.clock|extended hours|after.hours|outside normal business hours/i.test(text);
}
async function fetchPage(url) {
  await robotsPolicy.beforeFetch(url);
  return fetchPublicPage(url);
}

async function runJob(job) {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.completedCompanyDomains ??= [];
  job.discoveredCompanies ??= [];
  job.errors ??= [];
  persistState();
  const visitedDomains = new Set();
  const completedCompanyDomains = new Set(job.completedCompanyDomains);

  for (const sourceId of job.sourceIds) {
    const source = sources.get(sourceId);
    if (!source || !source.approved) {
      job.errors.push({ sourceId, reason: "Source is not approved" });
      continue;
    }

    try {
      const icp = icps.get(source.icpId || job.icpId);
      if (!icp) throw new Error("ICP not found");
      const html = DEMO_MODE
        ? DEMO_HTML
        : await fetchPage(source.url);

      const $ = cheerio.load(html);
      const directoryCompanies = DEMO_MODE ? [] : extractPublicDirectoryCompanies($, source.url, source);
      if (directoryCompanies.length) {
        const newCompanies = directoryCompanies.filter(company => {
          const domain = normalizeDomain(company.url);
          if (visitedDomains.has(domain)) return false;
          visitedDomains.add(domain);
          if (completedCompanyDomains.has(domain)) return false;
          if (scrapedDomains.has(domain)) return false;
          return true;
        });
        if (job.directoryRetrieval) {
          source.lastRetrievedAt = new Date().toISOString();
          source.lastCompanyLinksFound = directoryCompanies.length;
          source.lastNewCompaniesFound = newCompanies.length;
          source.lastRetrievalError = "";
          persistState();
        }
        const discoveredDomains = new Set(job.discoveredCompanies.map(company => company.domain));
        for (const company of newCompanies) {
          const domain = normalizeDomain(company.url);
          if (discoveredDomains.has(domain)) continue;
          discoveredDomains.add(domain);
          job.discoveredCompanies.push({ ...company, domain });
        }
        persistState();
        let nextCompanyIndex = 0;
        const workerCount = Math.min(DISCOVERY_CRAWL_CONCURRENCY, newCompanies.length);
        await Promise.all(Array.from({ length: workerCount }, async () => {
          while (nextCompanyIndex < newCompanies.length) {
            const company = newCompanies[nextCompanyIndex];
            nextCompanyIndex += 1;
            const companyRecord = await crawlCompanySite(
              job,
              company.url,
              icp,
              company.name,
              source.url,
              sourceId
            );
            if (job.directoryRetrieval && companyRecord &&
                companyRecord.legitimacy?.canAutoQualify &&
                ["Priority", "Review"].includes(companyRecord.score.tier)) {
              job.qualifiedProspectsAdded += 1;
            } else if (job.directoryRetrieval && companyRecord) {
              recordEngineEvent("candidate_review", `Candidate retained for legitimacy review: ${companyRecord.companyName} (${companyRecord.legitimacy?.status || "not assessed"} · ${companyRecord.legitimacy?.score || 0}/100 evidence)`, {
                companyName: companyRecord.companyName,
                legitimacy: companyRecord.legitimacy,
                domain: normalizeDomain(company.url),
                sourceUrl: companyRecord.sourceUrl
              });
            }
            if (companyRecord) {
              completedCompanyDomains.add(normalizeDomain(company.url));
              job.completedCompanyDomains = [...completedCompanyDomains];
            }
            persistState();
          }
        }));
      } else {
        if (job.directoryRetrieval) {
          source.lastRetrievedAt = new Date().toISOString();
          source.lastCompanyLinksFound = 0;
          source.lastNewCompaniesFound = 0;
          source.lastRetrievalError = "No external company links were found.";
          persistState();
          job.errors.push({ sourceId, reason: source.lastRetrievalError });
        } else {
          const domain = normalizeDomain(source.url);
          if (!visitedDomains.has(domain) && !scrapedDomains.has(domain)) {
            visitedDomains.add(domain);
            await crawlCompanySite(job, source.url, icp, undefined, undefined, sourceId, html);
          }
        }
      }
    } catch (error) {
      job.errors.push({ sourceId, reason: error.message });
      if (job.directoryRetrieval) {
        source.lastRetrievedAt = new Date().toISOString();
        source.lastRetrievalError = error.message;
        persistState();
      }
    }
  }

  if (job.status === "running") {
    job.status = job.errors.length ? "completed_with_errors" : "completed";
  }
  job.completedAt = new Date().toISOString();
  persistState();
}

function ensureScheduledPublicDirectorySources() {
  const approvedSources = [];
  let changed = false;
  for (const catalogEntry of PUBLIC_SOURCE_CATALOG) {
    let source = [...sources.values()].find(item => item.url === catalogEntry.url);
    if (!source) {
      source = {
        id: id(),
        name: catalogEntry.name,
        url: catalogEntry.url,
        approved: true,
        domain: normalizeDomain(catalogEntry.url),
        createdAt: new Date().toISOString()
      };
      sources.set(source.id, source);
      changed = true;
    }
    if (source.approved) approvedSources.push(source);
  }
  if (changed) persistState();
  const discoveredDirectorySources = [...sources.values()].filter(source =>
    source.approved && source.directoryMode === "generic"
  );
  return [...new Map(
    [...approvedSources, ...discoveredDirectorySources].map(source => [source.url, source])
  ).values()];
}

async function runScheduledPublicDirectoryRetrieval(
  kind = "daily_public_directory_retrieval",
  existingJob = null,
  includeCuratedSources = false
) {
  const directorySources = existingJob
    ? existingJob.sourceIds.map(sourceId => sources.get(sourceId)).filter(source => source?.approved)
    : includeCuratedSources
      ? ensureScheduledPublicDirectorySources()
      : [...sources.values()].filter(source =>
        source.approved &&
        (source.directoryMode === "generic" ||
          PUBLIC_SOURCE_CATALOG.some(catalogEntry => catalogEntry.url === source.url))
      );
  if (!directorySources.length) {
    discoveryState.lastPublicDirectoryRetrievalError =
      "No public directory sources are approved for retrieval.";
    if (existingJob) {
      existingJob.status = "failed";
      existingJob.completedAt = new Date().toISOString();
      existingJob.error = discoveryState.lastPublicDirectoryRetrievalError;
    }
    persistState();
    return;
  }

  let icp = existingJob
    ? icps.get(existingJob.icpId)
    : [...icps.values()].find(profile => profile.locations.includes("India")) ||
      [...icps.values()][0];
  if (!icp) {
    icp = {
      id: id(),
      name: "Dakini AI prospecting - India",
      industries: DISCOVERY_INDUSTRIES,
      locations: ["India"],
      useCases: []
    };
    icps.set(icp.id, icp);
  }

  const job = existingJob || {
    id: id(),
    kind,
    directoryRetrieval: true,
    status: "queued",
    sourceIds: directorySources.map(source => source.id),
    icpId: icp.id,
    maxPagesPerCompany: MAX_PAGES_PER_COMPANY,
    pages: 0,
    records: 0,
    companiesVisited: 0,
    qualifiedProspectsAdded: 0,
    completedCompanyDomains: [],
    discoveredCompanies: [],
    errors: []
  };
  job.status = "queued";
  job.completedAt = null;
  job.error = "";
  job.directoryRetrieval = true;
  job.sourceIds = directorySources.map(source => source.id);
  job.icpId = icp.id;
  job.errors ??= [];
  jobs.set(job.id, job);
  discoveryState.lastPublicDirectoryRetrievalError = "";
  persistState();
  await runJob(job);

  discoveryState.lastPublicDirectoryRetrievalAt = job.completedAt;
  discoveryState.lastPublicDirectoryRetrievalSummary = {
    companiesDiscovered: job.discoveredCompanies.length,
    companiesVisited: job.companiesVisited,
    qualifiedProspectsAdded: job.qualifiedProspectsAdded,
    records: job.records,
    errors: job.errors.length
  };
  discoveryState.lastPublicDirectoryRetrievalError = job.errors.length
    ? `${job.errors.length} public directory or company-site fetch error(s); see the retrieval job for details.`
    : "";
  persistState();
}

function sourceDiscoveryQueries() {
  const dayNumber = Math.floor(Date.now() / 86400000);
  return buildSourceDiscoveryQueries({
    profiles: [...icps.values()],
    defaultIndustries: DISCOVERY_INDUSTRIES,
    templates: SOURCE_DISCOVERY_QUERY_TEMPLATES,
    dayNumber,
    queriesPerRun: SOURCE_DISCOVERY_SEARCHES_PER_RUN
  });
}

function sourceCandidateKey(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.href.toLowerCase();
}

function hasTrustedDirectoryHost(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  return /\.gov(?:\.[a-z]{2,})?$/.test(hostname) ||
    /\.gov\.[a-z]{2,}$/.test(hostname) ||
    /\.edu(?:\.[a-z]{2,})?$/.test(hostname) ||
    /\.edu\.[a-z]{2,}$/.test(hostname);
}

function isDirectorySearchResult(result) {
  const evidence = `${result.title} ${result.description}`.toLowerCase();
  const industrySignal = /\b(digital marketing|marketing agency|seo agency|performance marketing|paid media|social media agency|content marketing agency|banking|financial services|insurance|healthcare|clinic|medical|recruitment|staffing|retail|e-commerce|ecommerce|education|real estate|hospitality|hotel|logistics|telecom|professional services|manufacturing|automotive|travel|saas)\b/.test(evidence);
  const directorySignal = /\b(directory|directories|agency list|agency listings|top agencies|best agencies|company list|list of companies|agency ranking|marketing firms|business directory|service providers|firms)\b/.test(evidence);
  return industrySignal && directorySignal;
}

async function validateSourceCandidate(result, searchContext) {
  const industryMatches = /digital marketing|marketing agency|seo|performance marketing|paid media|social media marketing|content marketing|lead generation|branding and web design|ecommerce marketing|saas marketing|banking|financial services|insurance|healthcare|clinic|medical|recruitment|staffing|retail|e-commerce|ecommerce|education|real estate|hospitality|hotel|logistics|telecom|professional services|manufacturing|automotive|travel|saas/i.test(searchContext.industry);
  if (!industryMatches) {
    return null;
  }
  const key = sourceCandidateKey(result.url);
  const prior = [...sourceCandidates.values()].find(candidate =>
    sourceCandidateKey(candidate.url) === key
  );
  if (prior) {
    prior.lastSeenAt = new Date().toISOString();
    prior.searchEvidence = {
      title: result.title,
      description: result.description,
      query: searchContext.query
    };
    prior.lastSeenIndustry = searchContext.industry;
    prior.lastSeenLocation = searchContext.location;
    prior.lastSeenIcpId = searchContext.icpId;
    return prior;
  }

  const html = await fetchPage(result.url);
  const page = extractPageText(html);
  const listedCompanies = extractGenericDirectoryCompanies(page.$, result.url);
  const directoryText = `${result.title} ${result.description} ${page.title} ${page.text}`;
  const hasDirectorySignal = /\b(directory|directories|agency list|agency listings|top agencies|best agencies|company list|list of companies|agency ranking|marketing firms|portfolio)\b/i.test(directoryText);
  const hasIndustrySignal = /\b(digital marketing|marketing agency|seo agency|performance marketing|paid media|social media agency|content marketing agency|banking|financial services|insurance|healthcare|clinic|medical|recruitment|staffing|retail|e-commerce|ecommerce|education|real estate|hospitality|hotel|logistics|telecom|professional services|manufacturing|automotive|travel|saas)\b/i.test(directoryText);
  if (listedCompanies.length < 2 || !hasDirectorySignal || !hasIndustrySignal) {
    return null;
  }

  const confidence = Math.min(99, 45 +
    (hasTrustedDirectoryHost(result.url) ? 15 : 0) +
    (/\b(association|chamber of commerce|federation|council|industry body)\b/i.test(directoryText) ? 10 : 0) +
    Math.min(listedCompanies.length, 10) * 2
  );
  const candidate = {
    id: id(),
    name: result.title || page.title || new URL(result.url).hostname,
    url: result.url,
    domain: normalizeDomain(result.url),
    authorityDomain: new URL(result.url).hostname,
    description: result.description || "",
    evidence: page.text.slice(0, 500),
    searchQuery: searchContext.query,
    icpId: searchContext.icpId,
    targetIndustry: searchContext.industry,
    targetLocation: searchContext.location,
    listedCompanyLinks: listedCompanies.length,
    confidence,
    status: "pending",
    discoveredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };
  sourceCandidates.set(candidate.id, candidate);
  return candidate;
}

async function runSourceDiscoveryJob(kind = "daily_source_discovery", existingJob = null) {
  if (hasActiveCrawlJob()) return null;
  const queries = existingJob
    ? existingJob.searchQueries.map(context => typeof context === "string"
      ? { query: context, icpId: null, industry: "", location: "" }
      : context)
    : sourceDiscoveryQueries();
  const job = existingJob || {
    id: id(),
    kind,
    status: "queued",
    searchQueries: queries,
    searchesCompleted: 0,
    candidatesChecked: 0,
    candidatesDiscovered: 0,
    candidateIds: [],
    errors: [],
    startedAt: new Date().toISOString()
  };
  job.searchQueries = queries;
  job.candidateIds ??= [];
  job.errors ??= [];
  job.searchesCompleted = Math.min(job.searchesCompleted || 0, queries.length);
  jobs.set(job.id, job);
  discoveryState.activeSourceDiscoveryJobId = job.id;
  persistState();

  try {
    job.status = "running";
    const searchConcurrency = BRAVE_SEARCH_API_KEY || FIRECRAWL_API_KEY
      ? AUTHENTICATED_SEARCH_CONCURRENCY
      : 1;
    await runWithConcurrency(queries.slice(job.searchesCompleted), searchConcurrency, async searchContext => {
      if (job.rateLimited) return;
      job.currentQuery = searchContext.query;
      try {
        await waitForSearchRateLimit();
        const results = await searchWeb(searchContext.query);
        const candidateResults = results.filter(isDirectorySearchResult);
        await runWithConcurrency(candidateResults, Math.min(4, DISCOVERY_CRAWL_CONCURRENCY), async result => {
          job.candidatesChecked += 1;
          try {
            const candidate = await validateSourceCandidate(result, searchContext);
            if (candidate && !job.candidateIds.includes(candidate.id)) {
              job.candidateIds.push(candidate.id);
              job.candidatesDiscovered += 1;
            }
          } catch (error) {
            job.errors.push({ url: result.url, reason: error.message });
          }
        });
      } catch (error) {
        job.errors.push({ query: searchContext.query, reason: error.message });
        if (/HTTP 429\b/.test(error.message)) job.rateLimited = true;
      }
      job.searchesCompleted += 1;
      persistState();
    });
    job.status = job.errors.length ? "completed_with_errors" : "completed";
  } catch (error) {
    job.status = "failed";
    job.error = error.message;
  } finally {
    job.completedAt = new Date().toISOString();
    discoveryState.activeSourceDiscoveryJobId = null;
    discoveryState.lastSourceDiscoveryAt = job.completedAt;
    discoveryState.lastSourceDiscoverySummary = {
      searchesCompleted: job.searchesCompleted,
      candidatesChecked: job.candidatesChecked,
      candidatesDiscovered: job.candidatesDiscovered,
      errors: job.errors.length
    };
    discoveryState.lastSourceDiscoveryError = job.errors.length
      ? `${job.errors.length} source discovery search or validation error(s); see the source-discovery job for details.`
      : "";
    persistState();
  }
  while (jobs.size > 120) jobs.delete(jobs.keys().next().value);
  return job;
}

async function crawlCompanySite(
  job,
  homeUrl,
  icp,
  companyName,
  directoryUrl,
  sourceId,
  homeHtml,
  discoveryEvidence = [],
  liveCrawl = !DEMO_MODE,
  { refreshExisting = false } = {}
) {
  if (!refreshExisting && scrapedDomains.has(normalizeDomain(homeUrl))) return null;
  const pages = [...discoveryEvidence];
  try {
    const html = homeHtml || await fetchPage(homeUrl);
    const homepage = extractPageText(html);
    pages.push({
      url: homeUrl,
      title: homepage.title,
      text: homepage.text,
      sourceType: "company website",
      websiteWorkflowSignals: homepage.websiteWorkflowSignals
    });
    job.pages += 1;

    const internalLinks = liveCrawl
      ? extractRelevantPageLinks(homepage.$, homeUrl).slice(0, job.maxPagesPerCompany - 1)
      : [];
    for (const pageUrl of internalLinks) {
      try {
        const pageHtml = await fetchPage(pageUrl);
        const page = extractPageText(pageHtml);
        pages.push({
          url: pageUrl,
          title: page.title,
          text: page.text,
          sourceType: "company website",
          websiteWorkflowSignals: page.websiteWorkflowSignals
        });
        job.pages += 1;
      } catch (error) {
        job.errors.push({ sourceId, company: companyName || normalizeDomain(homeUrl), url: pageUrl, reason: error.message });
      }
    }

    const verifiedCompanyName = companyName || companyNameFromWebsite(homepage, homeUrl);
    const companyRecord = saveCompany(pages, homeUrl, icp, verifiedCompanyName, directoryUrl);
    job.records += 1;
    job.companiesVisited += 1;
    return companyRecord;
  } catch (error) {
    job.errors.push({ sourceId, company: companyName || normalizeDomain(homeUrl), url: homeUrl, reason: error.message });
    return null;
  }
}

function saveCompany(pages, sourceUrl, icp, companyName, directoryUrl) {
  const preparedContext = prepareCompanyContext(pages, icp);
  const pageSources = preparedContext.pages
    .filter(page => page.sourceType !== "web search" && page.text)
    .map(({ url, text, sourceType, websiteWorkflowSignals }) => ({
      url,
      text,
      sourceType,
      websiteWorkflowSignals
    }));
  const text = pageSources.map(page => page.text).filter(Boolean).join(" | ");
  const record = extract(text, sourceUrl, icp, companyName, directoryUrl, pageSources);
  const companyStartEvidence = findCompanyStartYear(pages);
  if (companyStartEvidence) {
    record.companyStartYear = companyStartEvidence.startYear;
    record.evidence.push({
      field: "companyStartYear",
      value: companyStartEvidence.startYear,
      quote: companyStartEvidence.quote,
      source_url: companyStartEvidence.sourceUrl,
      confidence: 0.8
    });
  } else {
    record.companyStartYear = null;
  }
  record.contactPages = pages
    .filter(page => /contact|support|customer-care/i.test(new URL(page.url).pathname))
    .map(page => page.url);
  const preprocessingSummary = { ...preparedContext };
  delete preprocessingSummary.pages;
  record.contextPreparation = preprocessingSummary;
  record.title = pages[0]?.title || "";
  record.sourceUrl = sourceUrl;
  record.directoryUrl = directoryUrl || "";
  record.pagesScanned = pages.map(({ url, title, sourceType }) => ({ url, title, sourceType: sourceType || "company website" }));
  record.websiteWorkflowAudit = summarizeWebsiteWorkflowSignals(pages);
  record.legitimacy = assessCompanyLegitimacy({
    companyName: record.companyName,
    domain: record.domain,
    pages
  });
  record.capturedAt = new Date().toISOString();
  record.lastResearchedAt = record.capturedAt;
  record.scoreVersion = SCORE_VERSION;

  const companyId = normalizeDomain(sourceUrl);
  companies.set(companyId, { id: companyId, ...record });
  scrapedDomains.add(companyId);
  return record;
}

function recalculateStoredScores() {
  let changed = false;
  const broadIcp = { industries: [], locations: [], useCases: [] };
  for (const company of companies.values()) {
    if (company.scoreVersion === SCORE_VERSION) continue;
    const evidenceText = [
      ...(company.companyActivities || []),
      ...(company.evidence || []).map(item => item.quote || "")
    ].join(" | ");
    refreshStoredLegitimacy(company);
    const detectedUseCases = DAKINI_USE_CASE_PATTERNS
      .filter(([, pattern]) => pattern.test(evidenceText))
      .map(([useCase]) => useCase);
    company.detectedUseCases = detectedUseCases;
    company.dakiniRecommendations = getDakiniRecommendations(detectedUseCases);
    company.expansionSignal =
      /expansion|new branch|branches|branch opening|branch opened|new location|new service|new product|acquisition|acquired|launch(?:ed)?|rapid growth|scaling(?: up)?/i.test(evidenceText);
    company.telephonyOrCrm = Boolean(company.telephonyOrCrm) ||
      /crm|freshdesk|salesforce|hubspot|zendesk|intercom|helpdesk|telephony|contact center platform|booking software/i.test(evidenceText);
    company.systemIntegrationSignal = Boolean(company.systemIntegrationSignal) ||
      /integrat(?:e|es|ed|ing|ion)|API|customer (?:database|records|information)|existing systems|sales tools|CRM workflow|booking software|helpdesk/i.test(evidenceText);
    const aiSolutionProvider = isAiSolutionProviderEvidence([{
      title: company.title || "",
      description: evidenceText
    }]);
    company.aiSolutionProvider = aiSolutionProvider;
    const buyingIntent = Boolean(findBuyingIntentSignal(evidenceText));
    company.automationIntent = buyingIntent;
    company.buyingSignal = buyingIntent && !aiSolutionProvider;
    company.score = scoreLead({
      industry: company.industry || "Unknown",
      detectedUseCases,
      sourceText: "",
      locations: company.locations || [],
      roleEmail: company.roleEmail || "",
      phone: company.phone || "",
      callingTeam: Boolean(company.callingTeam),
      branches: Number(company.branches) || 0,
      highCallVolume: /high[- ]volume calls?|large call volumes?|heavy call volumes?|thousands of calls|large customer base|millions of customers|peak (?:season|demand|shopping)|surge in (?:calls|enquiries|inquiries)|(?:hundreds|thousands|millions) of (?:customers|users|members)|serv(?:e|es|ing)\s+(?:over\s+)?\d[\d,.]*\s+(?:customers|users|members)/i.test(evidenceText),
      extendedHours: Boolean(company.extendedHours),
      indiaMarketSignal: hasIndiaGeographicSignal(evidenceText),
      multilingualSignal: (company.languages || []).length >= 2 ||
        /multilingual|multiple languages|regional languages|local languages|dialects|accents/i.test(evidenceText),
      telephonyOrCrm: Boolean(company.telephonyOrCrm),
      systemIntegrationSignal: Boolean(company.systemIntegrationSignal),
      automationIntent: buyingIntent,
      voiceHiringSignal: Boolean(company.voiceHiringSignal) ||
        /(?:hiring|careers|recruit(?:ing|ment)?).{0,60}(?:telecallers?|telesales|call center|contact center|customer support|customer service|support agents?|sales (?:agents?|representatives?))|(?:telecallers?|telesales|call center|contact center|customer support|customer service|support agents?|sales (?:agents?|representatives?)).{0,60}(?:hiring|careers|recruit(?:ing|ment)?)/i.test(evidenceText),
      expansionSignal: Boolean(company.expansionSignal),
      buyingSignal: company.buyingSignal,
      websiteWorkflowSignals: company.websiteWorkflowAudit?.workflows || {},
      aiSolutionProvider
    }, broadIcp);
    company.scoreVersion = SCORE_VERSION;
    changed = true;
  }
  if (changed) persistState();
}

/* Health */
app.get("/healthz", (req, res) => res.json({ ok: true }));
function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function sourceReferenceType(company) {
  const sourceReference = company.directoryUrl || company.sourceUrl || "";
  try {
    const url = new URL(sourceReference);
    if (/(^|\.)bing\.com$/i.test(url.hostname) && url.pathname.toLowerCase() === "/search") {
      return "Search-results page (discovery only; not a direct company listing)";
    }
  } catch {
    return company.directoryUrl ? "Directory/discovery source" : "Company website";
  }
  return company.directoryUrl ? "Directory/discovery source" : "Company website";
}

function createGoogleOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function readGoogleSessionId(req) {
  const match = req.headers.cookie?.match(/(?:^|;\s*)dakini_google_session=([^;]+)/);
  return match?.[1] || "";
}

function setGoogleSessionCookie(res, sessionId) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `dakini_google_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`
  );
}

function saveGoogleConnection(sessionId, connection) {
  connection.encryptedTokens = encryptOAuthTokens(connection.tokens, GOOGLE_TOKEN_ENCRYPTION_KEY);
  googleConnections.set(sessionId, connection);
  persistState();
}

app.get("/api/config", (req, res) => res.json({
  demoMode: DEMO_MODE,
  googleConfigured: isGoogleConfigured(),
  webSearchConfigured: true,
  webSearchProvider: WEB_SEARCH_PROVIDER,
  authenticatedSearchConfigured: Boolean(BRAVE_SEARCH_API_KEY || FIRECRAWL_API_KEY),
  targetStates: INDIA_DISCOVERY_LOCATIONS,
  targetAreas: INDIA_CITIES
}));

app.get("/api/discovery/status", (req, res) => {
  const activeJob = discoveryState.activeJobId ? jobs.get(discoveryState.activeJobId) : null;
  const activeSourceDiscovery = discoveryState.activeSourceDiscoveryJobId
    ? jobs.get(discoveryState.activeSourceDiscoveryJobId)
    : null;
  const activePublicDirectoryRetrieval = [...jobs.values()].find(job =>
    job.directoryRetrieval &&
    ["running", "queued"].includes(job.status)
  );
  const approvedDirectorySources = [...sources.values()].filter(source =>
    source.approved &&
    (source.directoryMode === "generic" ||
      PUBLIC_SOURCE_CATALOG.some(catalogEntry => catalogEntry.url === source.url))
  );
  res.json({
    provider: WEB_SEARCH_PROVIDER,
    apiKeyRequired: false,
    configured: true,
    authenticatedSearchConfigured: Boolean(BRAVE_SEARCH_API_KEY || FIRECRAWL_API_KEY),
    dailyScheduleEnabled: true,
    schedule: `${DISCOVERY_TIME} ${DISCOVERY_TIME_ZONE}`,
    nextRunAt: discoveryState.nextRunAt,
    dailyQualifiedProspectsTarget: DAILY_QUALIFIED_PROSPECT_TARGET,
    dailyQualifiedProspects: countDailyQualifiedProspects(
      companies,
      new Date(),
      DISCOVERY_TIME_ZONE
    ),
    localDate: dateKeyInTimeZone(new Date(), DISCOVERY_TIME_ZONE),
    lastRunAt: discoveryState.lastRunAt,
    lastRunSummary: discoveryState.lastRunSummary,
    lastError: discoveryState.lastError,
    publicDirectoryRetrievalEnabled: true,
    publicDirectorySources: PUBLIC_SOURCE_CATALOG.map(source => ({
      id: source.id,
      name: source.name,
      approved: [...sources.values()].some(item => item.url === source.url && item.approved)
    })),
    lastPublicDirectoryRetrievalAt: discoveryState.lastPublicDirectoryRetrievalAt,
    lastPublicDirectoryRetrievalSummary: discoveryState.lastPublicDirectoryRetrievalSummary,
    lastPublicDirectoryRetrievalError: discoveryState.lastPublicDirectoryRetrievalError,
    sourceDiscoveryEnabled: true,
    sourceDiscoverySearchesPerRun: SOURCE_DISCOVERY_SEARCHES_PER_RUN,
    activeSourceDiscovery: activeSourceDiscovery ? {
      id: activeSourceDiscovery.id,
      status: activeSourceDiscovery.status,
      searchesCompleted: activeSourceDiscovery.searchesCompleted,
      totalSearchQueries: activeSourceDiscovery.searchQueries.length,
      candidatesChecked: activeSourceDiscovery.candidatesChecked,
      candidatesDiscovered: activeSourceDiscovery.candidatesDiscovered,
      errors: activeSourceDiscovery.errors.length
    } : null,
    lastSourceDiscoveryAt: discoveryState.lastSourceDiscoveryAt,
    lastSourceDiscoverySummary: discoveryState.lastSourceDiscoverySummary,
    lastSourceDiscoveryError: discoveryState.lastSourceDiscoveryError,
    pendingSourceCandidates: [...sourceCandidates.values()].filter(candidate =>
      candidate.status === "pending"
    ).length,
    approvedDirectorySources: approvedDirectorySources.map(source => ({
      id: source.id,
      name: source.name,
      url: source.url,
      directoryMode: source.directoryMode || "curated",
      ...publicSourceRetrievalStatus(source.url)
    })),
    activePublicDirectoryRetrieval: activePublicDirectoryRetrieval ? {
      id: activePublicDirectoryRetrieval.id,
      status: activePublicDirectoryRetrieval.status,
      companiesDiscovered: activePublicDirectoryRetrieval.discoveredCompanies.length,
      companiesVisited: activePublicDirectoryRetrieval.companiesVisited,
      companiesCompleted: activePublicDirectoryRetrieval.completedCompanyDomains?.length || 0,
      pages: activePublicDirectoryRetrieval.pages,
      errors: activePublicDirectoryRetrieval.errors.length
    } : null,
    activeJob: activeJob ? {
      id: activeJob.id,
      kind: activeJob.kind,
      status: activeJob.status,
      currentActivity: activeJob.currentActivity || "",
      geographicCity: activeJob.geographicCity || "",
      geographicState: activeJob.geographicState || "",
      geographicCountry: activeJob.geographicCountry || "",
      geographicCategory: activeJob.geographicCategory || "",
      geographicCandidatesFound: activeJob.geographicCandidatesFound || 0,
      geographicSourceStats: activeJob.geographicSourceStats || {},
      geographicSourceNotes: activeJob.geographicSourceNotes || [],
      searchesCompleted: activeJob.searchesCompleted,
      totalSearchQueries: activeJob.totalSearchQueries || DAILY_DISCOVERY_QUERIES_PER_RUN,
      companiesVisited: activeJob.companiesVisited,
      companiesDiscovered: activeJob.discoveredCompanies.length,
      qualifiedProspectsAdded: activeJob.qualifiedProspectsAdded || 0,
      newHighPotentialProspects: activeJob.newHighPotentialProspects || 0,
      dailyTargetEnabled: Boolean(activeJob.dailyTargetEnabled),
      dailyQualifiedProspects: activeJob.dailyQualifiedProspects || 0,
      dailyQualifiedProspectsTarget: activeJob.dailyQualifiedProspectsTarget || null,
      dailyTargetStopReason: activeJob.dailyTargetStopReason || "",
      dailyWindowEndsAt: activeJob.dailyWindowEndsAt || null,
      searchBatches: activeJob.searchBatches || 0,
      totalSearchesCompleted: activeJob.totalSearchesCompleted || 0,
      rateLimited: Boolean(activeJob.rateLimited),
      pages: activeJob.pages,
      errors: activeJob.errors.length
    } : null,
    resultsPerQuery: MAX_RESULTS_PER_SEARCH,
    dailySearchQueries: DAILY_DISCOVERY_QUERIES_PER_RUN,
    maxPagesPerCompany: MAX_PAGES_PER_COMPANY,
    crawlConcurrency: DISCOVERY_CRAWL_CONCURRENCY,
    searchConcurrency: BRAVE_SEARCH_API_KEY || FIRECRAWL_API_KEY
      ? AUTHENTICATED_SEARCH_CONCURRENCY
      : 1,
    engine: engineState
  });
});

app.get("/api/operations/diagnostics", (req, res) => {
  const allJobs = [...jobs.values()];
  const statusCounts = {};
  for (const job of allJobs) {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
  }
  const recentJobs = allJobs.slice(-10).reverse().map(job => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    errorCount: Array.isArray(job.errors) ? job.errors.length : 0
  }));
  let databaseStatus = "ok";
  try {
    if (!stateStore.healthCheck()) databaseStatus = "unavailable";
  } catch {
    databaseStatus = "unavailable";
  }
  res.json({
    status: databaseStatus === "ok" ? "ok" : "degraded",
    uptimeSeconds: Math.floor(process.uptime()),
    database: databaseStatus,
    jobs: {
      total: allJobs.length,
      active: allJobs.filter(job => ["running", "queued"].includes(job.status)).length,
      byStatus: statusCounts,
      recent: recentJobs
    },
    discovery: {
      activeJobId: discoveryState.activeJobId,
      activeSourceDiscoveryJobId: discoveryState.activeSourceDiscoveryJobId,
      lastRunAt: discoveryState.lastRunAt,
      lastError: discoveryState.lastError || ""
    }
  });
});

app.get("/api/engine/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (res.flushHeaders) res.flushHeaders();

  res.write(`data: ${JSON.stringify({
    type: "init",
    engine: engineState,
    busy: Boolean(
      discoveryState.activeJobId ||
      discoveryState.activeSourceDiscoveryJobId ||
      hasActiveCrawlJob()
    ),
    recentEvents: engineLiveEvents.slice(-30)
  })}\n\n`);

  sseClients.add(res);
  req.on("close", () => {
    sseClients.delete(res);
  });
});

app.get("/api/engine/status", (req, res) => {
  const activeJob = discoveryState.activeJobId ? jobs.get(discoveryState.activeJobId) : null;
  res.json({
    engine: engineState,
    recentEvents: engineLiveEvents.slice(-30),
    busy: Boolean(
      discoveryState.activeJobId ||
      discoveryState.activeSourceDiscoveryJobId ||
      hasActiveCrawlJob()
    ),
    activeJob: activeJob ? {
      id: activeJob.id,
      status: activeJob.status,
      searchesCompleted: activeJob.searchesCompleted,
      totalSearchQueries: activeJob.totalSearchQueries || DAILY_DISCOVERY_QUERIES_PER_RUN,
      companiesVisited: activeJob.companiesVisited,
      companiesDiscovered: activeJob.discoveredCompanies.length,
      qualifiedProspectsAdded: activeJob.qualifiedProspectsAdded || 0,
      newHighPotentialProspects: activeJob.newHighPotentialProspects || 0,
      dailyTargetEnabled: Boolean(activeJob.dailyTargetEnabled),
      dailyQualifiedProspects: activeJob.dailyQualifiedProspects || 0,
      dailyQualifiedProspectsTarget: activeJob.dailyQualifiedProspectsTarget || null,
      dailyWindowEndsAt: activeJob.dailyWindowEndsAt || null,
      searchBatches: activeJob.searchBatches || 0,
      totalSearchesCompleted: activeJob.totalSearchesCompleted || 0,
      rateLimited: Boolean(activeJob.rateLimited),
      pages: activeJob.pages,
      errors: activeJob.errors.length
    } : null
  });
});

app.post("/api/engine/start", (req, res) => {
  engineState.enabled = true;
  engineState.status = "running";
  recordEngineEvent("info", "Autonomous research engine started");
  if (!discoveryState.activeJobId && !hasActiveCrawlJob()) {
    void backgroundTasks.track(triggerEngineCycle(), "Autonomous engine cycle");
  } else {
    scheduleNextEngineCycle();
  }
  persistState();
  res.json({ success: true, engine: engineState });
});

app.post("/api/engine/pause", (req, res) => {
  pauseEngineState(engineState);
  if (engineTimeout) {
    clearTimeout(engineTimeout);
    engineTimeout = null;
  }
  if (dailyDiscoveryTimeout) {
    clearTimeout(dailyDiscoveryTimeout);
    dailyDiscoveryTimeout = null;
  }
  recordEngineEvent("info", "Autonomous research engine paused");
  persistState();
  res.json({ success: true, engine: engineState });
});

app.post("/api/engine/configure", (req, res) => {
  const schema = z.object({
    mode: z.enum(["continuous", "interval", "daily"]).optional(),
    intervalMinutes: z.number().int().min(1).max(1440).optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.mode) engineState.mode = parsed.data.mode;
  if (parsed.data.intervalMinutes) engineState.intervalMinutes = parsed.data.intervalMinutes;
  recordEngineEvent("info", `Engine configured to ${engineState.mode} mode`);
  scheduleNextEngineCycle();
  persistState();
  res.json({ success: true, engine: engineState });
});

app.post("/api/engine/run-now", crawlRateLimit, (req, res) => {
  if (discoveryState.activeJobId || hasActiveCrawlJob()) {
    return res.status(409).json({ error: "A discovery or crawl job is already running." });
  }
  void backgroundTasks.track(triggerEngineCycle(true), "Autonomous engine cycle");
  res.status(202).json({ success: true, message: "Engine cycle started" });
});

function publicSourceRetrievalStatus(url) {
  const source = [...sources.values()].find(item => item.url === url);
  if (!source) return {};
  return {
    lastRetrievedAt: source.lastRetrievedAt || null,
    lastCompanyLinksFound: source.lastCompanyLinksFound ?? null,
    lastNewCompaniesFound: source.lastNewCompaniesFound ?? null,
    lastRetrievalError: source.lastRetrievalError || ""
  };
}

app.post("/api/discovery/run-now", crawlRateLimit, (req, res) => {
  if (discoveryState.activeJobId || hasActiveCrawlJob()) {
    return res.status(409).json({ error: "A discovery or company crawl is already running." });
  }

  const job = createDiscoveryJob("manual_web_discovery");
  jobs.set(job.id, job);
  discoveryState.activeJobId = job.id;
  persistState();
  void backgroundTasks.track(runDiscoveryJob(job), "Manual web discovery");
  res.status(202).json({ id: job.id, status: job.status });
});

app.post("/api/geographic-discovery/run-now", crawlRateLimit, (req, res) => {
  if (discoveryState.activeJobId || hasActiveCrawlJob()) {
    return res.status(409).json({ error: "A discovery or company crawl is already running." });
  }
  const parsed = z.object({
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().max(100).default(""),
    country: z.string().trim().min(1).max(100).default("India"),
    category: z.string().trim().min(1).max(100).default("all"),
    limit: z.number().int().min(1).max(200).default(GEOGRAPHIC_RESULT_LIMIT)
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const job = {
    id: id(),
    kind: "manual_geographic_discovery",
    status: "queued",
    anyLocation: true,
    allowNonIndianCompanies: true,
    dailyTargetEnabled: false,
    geographicCity: parsed.data.city,
    geographicState: parsed.data.state,
    geographicCountry: parsed.data.country,
    geographicCategory: parsed.data.category,
    geographicResultLimit: parsed.data.limit,
    geographicCandidatesFound: 0,
    geographicSourceStats: {},
    geographicSourceNotes: [],
    searchQueries: [],
    discoveredCompanies: [],
    completedCompanyDomains: [],
    searchResults: 0,
    searchesCompleted: 0,
    totalSearchQueries: 0,
    pages: 0,
    records: 0,
    companiesVisited: 0,
    companiesSaved: 0,
    qualifiedProspectsAdded: 0,
    newHighPotentialProspects: 0,
    errors: []
  };
  jobs.set(job.id, job);
  discoveryState.activeJobId = job.id;
  persistState();
  void backgroundTasks.track((async () => {
    try {
      job.currentActivity = `Looking up ${parsed.data.category} businesses in ${parsed.data.city} on OpenStreetMap`;
      const discovery = await discoverGeographicalBusinesses({
        city: parsed.data.city,
        state: parsed.data.state,
        country: parsed.data.country,
        category: parsed.data.category,
        limit: parsed.data.limit
      });
      job.geographicSourceStats = discovery.sourceStats;
      job.geographicSourceNotes = discovery.notes;
      const candidates = discovery.businesses;
      const query = `${parsed.data.city} ${parsed.data.state} ${parsed.data.country} ${parsed.data.category} geographic business discovery`;
      job.discoveredCompanies = candidates
        .filter(candidate => isEligibleProspectUrl(candidate.url))
        .map(candidate => ({
          domain: normalizeDomain(candidate.url),
          url: new URL(candidate.url).origin,
          evidence: (candidate.sourceCitations || [candidate.sourceUrl]).map(sourceUrl => ({
            url: sourceUrl,
            title: candidate.title,
            description: `${candidate.description} Discovery source: ${candidate.source}.`,
            query,
            queries: [query]
          }))
        }));
      job.geographicCandidatesFound = job.discoveredCompanies.length;
      job.searchResults = job.geographicCandidatesFound;
      persistState();
      await runDiscoveryJob(job);
    } catch (error) {
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      job.error = error.message;
      job.errors.push({ provider: "OpenStreetMap Overpass", reason: error.message });
      discoveryState.lastError = error.message;
      if (discoveryState.activeJobId === job.id) discoveryState.activeJobId = null;
      persistState();
      console.error(`Geographic discovery failed: ${error.message}`);
    }
  })(), "OpenStreetMap geographic discovery");
  res.status(202).json({ id: job.id, status: job.status });
});

app.post("/api/source-discovery/run-now", crawlRateLimit, (req, res) => {
  if (hasActiveCrawlJob() || discoveryState.activeSourceDiscoveryJobId) {
    return res.status(409).json({ error: "A discovery or company crawl is already running." });
  }
  const run = backgroundTasks.track(
    runSourceDiscoveryJob("manual_source_discovery"),
    "Manual source discovery"
  );
  const job = jobs.get(discoveryState.activeSourceDiscoveryJobId);
  if (!job) return res.status(500).json({ error: "Could not create the source discovery job." });
  res.status(202).json({ id: job.id, status: job.status });
  void run;
});

app.post("/api/source-retrieval/run-now", crawlRateLimit, (req, res) => {
  if (hasActiveCrawlJob() || discoveryState.activeSourceDiscoveryJobId) {
    return res.status(409).json({ error: "A discovery or company crawl is already running." });
  }
  const parsed = z.object({ includeCuratedSources: z.boolean().default(false) }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const hasApprovedDirectory = [...sources.values()].some(source => source.approved &&
    (source.directoryMode === "generic" ||
      PUBLIC_SOURCE_CATALOG.some(catalogEntry => catalogEntry.url === source.url)));
  const canIncludeCuratedSources =
    parsed.data.includeCuratedSources && PUBLIC_SOURCE_CATALOG.length > 0;
  if (!hasApprovedDirectory && !canIncludeCuratedSources) {
    return res.status(409).json({ error: "No public directory sources are approved for retrieval." });
  }
  const run = runScheduledPublicDirectoryRetrieval(
    "manual_public_directory_retrieval",
    null,
    parsed.data.includeCuratedSources
  );
  void backgroundTasks.track(run.catch(error => {
    console.error("Manual approved-directory retrieval failed:", error.message);
    discoveryState.lastPublicDirectoryRetrievalError =
      `Manual approved-directory retrieval failed: ${error.message}`;
    persistState();
  }), "Manual approved-directory retrieval");
  const job = [...jobs.values()].filter(item =>
    item.kind === "manual_public_directory_retrieval"
  ).at(-1);
  if (!job) return res.status(500).json({ error: "Could not create the directory retrieval job." });
  res.status(202).json({ id: job.id, status: job.status });
});

app.get("/api/source-candidates", (req, res) => {
  res.json([...sourceCandidates.values()].sort((a, b) =>
    b.confidence - a.confidence || b.lastSeenAt.localeCompare(a.lastSeenAt)
  ));
});

app.post("/api/source-candidates/:candidateId/approve", (req, res) => {
  const candidate = sourceCandidates.get(req.params.candidateId);
  if (!candidate) return res.status(404).json({ error: "Source candidate not found." });
  if (candidate.status === "rejected") {
    return res.status(409).json({ error: "This source candidate was dismissed." });
  }
  const existing = [...sources.values()].find(source => source.url === candidate.url);
  const source = existing || {
    id: id(),
    name: candidate.name,
    url: candidate.url,
    approved: true,
    domain: candidate.domain,
    directoryMode: "generic",
    sourceCandidateId: candidate.id,
    icpId: candidate.icpId || undefined,
    createdAt: new Date().toISOString()
  };
  source.approved = true;
  source.directoryMode = "generic";
  source.sourceCandidateId = candidate.id;
  sources.set(source.id, source);
  candidate.status = "approved";
  candidate.approvedAt = new Date().toISOString();
  persistState();
  res.json({ candidate, source });
});

app.post("/api/source-candidates/:candidateId/dismiss", (req, res) => {
  const candidate = sourceCandidates.get(req.params.candidateId);
  if (!candidate) return res.status(404).json({ error: "Source candidate not found." });
  candidate.status = "rejected";
  candidate.dismissedAt = new Date().toISOString();
  persistState();
  res.json({ candidate });
});

app.get("/api/google/status", (req, res) => {
  const connection = googleConnections.get(readGoogleSessionId(req));
  res.json({
    configured: isGoogleConfigured(),
    connected: Boolean(connection),
    spreadsheetUrl: connection?.spreadsheetUrl || ""
  });
});

app.get("/auth/google", (req, res) => {
  if (!isGoogleConfigured()) {
    return res.redirect(`/?googleError=${encodeURIComponent("Google Sheets is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.")}`);
  }

  const sessionId = readGoogleSessionId(req) || crypto.randomBytes(32).toString("hex");
  setGoogleSessionCookie(res, sessionId);
  const state = crypto.randomBytes(32).toString("hex");
  googleOAuthStates.set(state, { sessionId, createdAt: Date.now() });

  const oauth = createGoogleOAuthClient();
  const authorizationUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file"
    ],
    state
  });
  res.redirect(authorizationUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const stateRecord = googleOAuthStates.get(state);
  googleOAuthStates.delete(state);
  const sessionId = readGoogleSessionId(req);

  if (!stateRecord || stateRecord.sessionId !== sessionId ||
      Date.now() - stateRecord.createdAt > 10 * 60 * 1000) {
    return res.redirect(`/?googleError=${encodeURIComponent("Google sign-in expired. Please connect again.")}`);
  }
  if (req.query.error) {
    return res.redirect(`/?googleError=${encodeURIComponent("Google authorization was not completed.")}`);
  }
  if (typeof req.query.code !== "string") {
    return res.redirect(`/?googleError=${encodeURIComponent("Google did not return an authorization code.")}`);
  }

  try {
    const oauth = createGoogleOAuthClient();
    const { tokens } = await oauth.getToken(req.query.code);
    saveGoogleConnection(sessionId, { tokens, spreadsheetId: "", spreadsheetUrl: "" });
    res.redirect("/?google=connected");
  } catch (error) {
    console.error("Google OAuth callback failed:", error.message);
    res.redirect(`/?googleError=${encodeURIComponent("Google sign-in failed. Please try again.")}`);
  }
});

app.post("/api/google/sheets", async (req, res) => {
  const sessionId = readGoogleSessionId(req);
  const connection = googleConnections.get(sessionId);
  if (!connection) return res.status(401).json({ error: "Connect your Google account before syncing." });

  const companiesToSync = [...companies.values()].sort((a, b) => b.score.score - a.score.score);
  if (!companiesToSync.length) return res.status(400).json({ error: "There are no prospect results to sync yet." });

  try {
    const oauth = createGoogleOAuthClient();
    oauth.setCredentials(connection.tokens);
    oauth.on("tokens", tokens => {
      connection.tokens = { ...connection.tokens, ...tokens };
      saveGoogleConnection(sessionId, connection);
    });
    const sheets = google.sheets({ version: "v4", auth: oauth });
    let spreadsheetId = connection.spreadsheetId;

    if (!spreadsheetId) {
      const created = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: "Dakini AI Prospects" },
          sheets: [{ properties: { title: "Prospects", gridProperties: { frozenRowCount: 1 } } }]
        }
      });
      spreadsheetId = created.data.spreadsheetId;
      connection.spreadsheetId = spreadsheetId;
      connection.spreadsheetUrl = created.data.spreadsheetUrl;
      saveGoogleConnection(sessionId, connection);
    }

    const values = [
      [
        "Rank", "Company", "Heuristic fit score (not purchase probability)", "Fit tier", "Industry", "Extracted company activities",
        "Legitimacy evidence status", "Legitimacy evidence score (not legal verification)", "Legitimacy review notes",
        "Detected workflow signal", "Public website workflow check (not proof of a gap)", "Potential Dakini fit (suggested, not confirmed)", "Public business emails", "Public business phones",
        "Contact page", "Company website", "Discovery/source reference", "Source reference type",
        "Evidence basis", "Data checked", "Pages scanned", "Source excerpts",
        "Business start year (first-party evidence)", "Business age (calendar-year estimate)", "Start-year source"
      ],
      ...companiesToSync.map((company, index) => [
        index + 1,
        company.companyName,
        company.score.score,
        company.score.tier,
        company.industry,
        company.companyActivities.join(" | "),
        company.legitimacy?.status ||
          (company.pagesScanned?.some(page => page.sourceType === "public directory listing")
            ? "directory_only"
            : "not_assessed"),
        company.legitimacy?.score ?? "",
        (company.legitimacy?.reasons || []).join(" | "),
        company.score.matchedUseCases.join(" | ") || company.detectedUseCases.join(" | "),
        company.websiteWorkflowAudit
          ? `${Object.entries(company.websiteWorkflowAudit.workflows || {})
            .map(([workflow, status]) => `${workflow}: ${status}`)
            .join(" | ")} | scanned pages: ${company.websiteWorkflowAudit.scannedPages ?? 0}`
          : "",
        company.dakiniRecommendations.join(" | "),
        company.contactEmails.join(" | "),
        company.contactPhones.join(" | "),
        company.contactPages[0] || "",
        company.sourceUrl,
        company.directoryUrl || company.sourceUrl,
        sourceReferenceType(company),
        company.pagesScanned?.length &&
          company.pagesScanned.every(page => page.sourceType === "public directory listing")
          ? "Directory listing only; company operations not independently checked"
          : company.evidence?.some(item => item.quote && item.field !== "roleEmail" && item.field !== "phone")
            ? `${company.evidence.filter(item => item.quote && item.field !== "roleEmail" && item.field !== "phone").length} quoted signal(s); source statements not independently verified`
            : "Limited cited evidence; source review recommended",
        company.capturedAt || "",
        company.pagesScanned?.length || 0,
        (company.evidence || [])
          .filter(item => item.quote && item.field !== "roleEmail" && item.field !== "phone")
          .map(item => `${item.field}: ${item.quote}${item.source_url ? ` (${item.source_url})` : ""}`)
          .join(" | "),
        company.companyStartYear ?? "",
        company.companyStartYear ? new Date().getFullYear() - company.companyStartYear : "",
        company.evidence?.find(item => item.field === "companyStartYear")?.source_url || ""
      ].map(value => String(value ?? "").replace(/^[\s]*[=+\-@]/, "'$&")))
    ];

    if (connection.spreadsheetUrl) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: "Prospects!A:Z"
      });
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Prospects!A1",
      valueInputOption: "RAW",
      requestBody: { values }
    });

    saveGoogleConnection(sessionId, connection);
    res.json({
      spreadsheetUrl: connection.spreadsheetUrl,
      rows: companiesToSync.length
    });
  } catch (error) {
    console.error("Google Sheets sync failed:", error.message);
    res.status(502).json({ error: "Could not sync to Google Sheets. Check the OAuth setup and try again." });
  }
});

/* ICP */
app.get("/api/icps", (req, res) => res.json([...icps.values()]));

app.post("/api/icps", (req, res) => {
  const parsed = ICP.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const item = { id: id(), ...parsed.data };
  icps.set(item.id, item);
  persistState();
  res.status(201).json(item);
});

/* Sources */
app.get("/api/sources", (req, res) => res.json([...sources.values()]));

app.delete("/api/sources", (req, res) => {
  const removed = [...sources.values()].filter(source => source.approved).map(source => {
    source.approved = false;
    source.lastRetrievedAt = null;
    source.lastCompanyLinksFound = null;
    source.lastNewCompaniesFound = null;
    source.lastRetrievalError = "";
    return { id: source.id, name: source.name, url: source.url, approved: source.approved };
  });
  if (removed.length) persistState();
  res.json({ removedCount: removed.length, removed });
});

app.get("/api/public-sources", (req, res) => {
  const builtInSources = PUBLIC_SOURCE_CATALOG.map(source => ({
    ...source,
    added: [...sources.values()].some(item => item.url === source.url && item.approved),
    ...publicSourceRetrievalStatus(source.url)
  }));
  const discoveredSources = [...sources.values()]
    .filter(source => source.directoryMode === "generic")
    .map(source => ({
      id: source.sourceCandidateId,
      name: source.name,
      url: source.url,
      description: "Discovered directory; approved for company-list retrieval.",
      added: true,
      ...publicSourceRetrievalStatus(source.url)
    }));
  res.json([...builtInSources, ...discoveredSources]);
});

app.post("/api/public-sources/:sourceId", (req, res) => {
  const source = PUBLIC_SOURCE_CATALOG.find(item => item.id === req.params.sourceId);
  if (!source) return res.status(404).json({ error: "Public data source not found." });
  const existing = [...sources.values()].find(item => item.url === source.url);
  if (existing?.approved) return res.json({ ...existing, alreadyAdded: true });
  if (existing) {
    existing.approved = true;
    persistState();
    return res.json(existing);
  }

  const item = {
    id: id(),
    name: source.name,
    url: source.url,
    approved: true,
    domain: normalizeDomain(source.url),
    createdAt: new Date().toISOString()
  };
  sources.set(item.id, item);
  persistState();
  res.status(201).json(item);
});

app.post("/api/sources", (req, res) => {
  const parsed = SOURCE.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const item = {
    id: id(),
    ...parsed.data,
    domain: normalizeDomain(parsed.data.url),
    createdAt: new Date().toISOString()
  };
  sources.set(item.id, item);
  persistState();
  res.status(201).json(item);
});

app.delete("/api/sources/:sourceId", (req, res) => {
  const source = sources.get(req.params.sourceId);
  if (!source) return res.status(404).json({ error: "Source not found." });

  source.approved = false;
  source.lastRetrievedAt = null;
  source.lastCompanyLinksFound = null;
  source.lastNewCompaniesFound = null;
  source.lastRetrievalError = "";
  persistState();
  res.json({ ...source, removed: true });
});

/* Crawl job */
app.post("/api/jobs", crawlRateLimit, (req, res) => {
  if (discoveryState.activeJobId || hasActiveCrawlJob()) {
    return res.status(409).json({ error: "A discovery or company crawl is already running." });
  }

  const schema = z.object({
    sourceIds: z.array(z.string()).min(1),
    maxPagesPerCompany: z.number().int().positive().max(10).default(MAX_PAGES_PER_COMPANY),
    icpId: z.string().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const icpId = parsed.data.icpId || [...icps.keys()].at(-1);
  if (!icpId || !icps.has(icpId)) {
    return res.status(400).json({ error: "Create an ICP before starting a crawl." });
  }

  const job = {
    id: id(),
    ...parsed.data,
    icpId,
    pages: 0,
    records: 0,
    companiesVisited: 0,
    discoveredCompanies: [],
    errors: [],
    status: "queued"
  };

  jobs.set(job.id, job);
  persistState();
  void backgroundTasks.track(runJob(job), "Manual company crawl");
  res.status(202).json(job);
});

async function runLowerFitResearch(job) {
  const waitInterval = milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds));
  const hasOtherActiveWork = () =>
    Boolean(discoveryState.activeJobId || discoveryState.activeSourceDiscoveryJobId) ||
    [...jobs.values()].some(other =>
      other.id !== job.id && ["queued", "running"].includes(other.status)
    );

  while (!isShuttingDown && hasOtherActiveWork()) {
    job.status = "queued";
    job.currentActivity = "Waiting for the active discovery/crawl to finish";
    persistState();
    await waitInterval(5000);
  }
  if (isShuttingDown) return;

  job.status = "running";
  job.startedAt ||= new Date().toISOString();
  const staleResearch = job.kind === "stale_lead_research";
  job.currentActivity = staleResearch
    ? "Rechecking stale saved company websites and refreshing evidence"
    : "Rechecking saved company websites and refreshing evidence";
  const completedTargetIds = new Set(job.completedTargetIds || []);
  const broadIcp = { industries: [], locations: [], useCases: [], anyLocation: true };
  const targets = job.targets.filter(target => !completedTargetIds.has(target.id));
  persistState();

  try {
    await runWithConcurrency(targets, 2, async target => {
      if (isShuttingDown) return;
      job.currentTargets = [...(job.currentTargets || []).slice(-1), target.companyName];
      const existing = companies.get(target.id);
      if (!existing) {
        job.errors.push({
          company: target.companyName,
          url: target.sourceUrl,
          reason: "Saved prospect was removed before its research started."
        });
      } else {
        const originalCapturedAt = existing.capturedAt;
        const originalTier = existing.score?.tier;
        const record = await crawlCompanySite(
          job,
          target.sourceUrl,
          broadIcp,
          target.companyName,
          target.directoryUrl,
          job.id,
          undefined,
          [],
          true,
          { refreshExisting: true }
        );
        if (record) {
          const refreshedRecord = companies.get(normalizeDomain(target.sourceUrl));
          if (refreshedRecord && originalCapturedAt) {
            refreshedRecord.capturedAt = originalCapturedAt;
          }
          if (refreshedRecord) refreshedRecord.lastResearchedAt = new Date().toISOString();
          job.researchedCompanies += 1;
          if (originalTier === "Low fit" && record.score.tier === "Priority") {
            job.upgradedToPriority += 1;
          } else if (originalTier === "Low fit" && record.score.tier === "Review") {
            job.upgradedToReview += 1;
          }
        }
      }

      completedTargetIds.add(target.id);
      job.completedTargetIds = [...completedTargetIds];
      job.completedTargets = completedTargetIds.size;
      job.currentActivity = staleResearch
        ? `Rechecked ${job.completedTargets}/${job.totalTargets} stale prospects`
        : `Researched ${job.completedTargets}/${job.totalTargets} lower-fit prospects`;
      persistState();
    });

    if (isShuttingDown) {
      job.status = "interrupted";
      job.error = "Research paused during server shutdown; completed records are saved for restart recovery.";
    } else {
      job.status = job.errors.length ? "completed_with_errors" : "completed";
      job.completedAt = new Date().toISOString();
      job.currentActivity = staleResearch
        ? `Stale-lead refresh complete: ${job.researchedCompanies}/${job.totalTargets} sites refreshed`
        : `Lower-fit research complete: ${job.researchedCompanies}/${job.totalTargets} sites refreshed`;
      recordEngineEvent(
        "info",
        staleResearch
          ? `Stale-lead refresh complete: ${job.researchedCompanies}/${job.totalTargets} sites refreshed`
          : `Lower-fit re-research complete: ${job.researchedCompanies}/${job.totalTargets} sites refreshed; ${job.upgradedToReview + job.upgradedToPriority} upgraded to Research or High potential`
      );
    }
  } catch (error) {
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    job.error = `${staleResearch ? "Stale-lead refresh" : "Lower-fit research"} failed: ${error.message}`;
    console.error(job.error);
  } finally {
    job.currentTargets = [];
    persistState();
  }
}

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Research job not found." });
  res.json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    geographicCity: job.geographicCity || "",
    geographicState: job.geographicState || "",
    geographicCountry: job.geographicCountry || "",
    geographicCategory: job.geographicCategory || "",
    geographicCandidatesFound: job.geographicCandidatesFound || 0,
    geographicSourceStats: job.geographicSourceStats || {},
    geographicSourceNotes: job.geographicSourceNotes || [],
    totalTargets: job.totalTargets || 0,
    completedTargets: job.completedTargets || 0,
    researchedCompanies: job.researchedCompanies || 0,
    upgradedToReview: job.upgradedToReview || 0,
    upgradedToPriority: job.upgradedToPriority || 0,
    pages: job.pages || 0,
    companiesVisited: job.companiesVisited || 0,
    currentTargets: job.currentTargets || [],
    currentActivity: job.currentActivity || "",
    skippedInvalidUrl: job.skippedInvalidUrl || 0,
    skippedDuplicateDomain: job.skippedDuplicateDomain || 0,
    errors: job.errors?.length || 0,
    error: job.error || ""
  });
});

app.get("/api/jobs", (req, res) => res.json([...jobs.values()]));

/* Companies */
app.get("/api/companies", (req, res) => res.json([...companies.values()]));

app.post("/api/companies/research-lower-fit", crawlRateLimit, (req, res) => {
  const parsed = z.object({
    companyIds: z.array(z.string().min(1).max(255)).min(1).max(5000).optional()
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const activeJob = [...jobs.values()].find(job =>
    ["lower_fit_research", "stale_lead_research"].includes(job.kind) &&
    ["queued", "running"].includes(job.status)
  );
  if (activeJob) {
    return res.status(409).json({
      error: "Lower-fit re-research is already queued or running.",
      jobId: activeJob.id
    });
  }

  let requestedIds;
  if (parsed.data.companyIds) {
    requestedIds = [...new Set(parsed.data.companyIds)];
    const missingIds = requestedIds.filter(companyId => !companies.has(companyId));
    if (missingIds.length) {
      return res.status(409).json({
        error: `${missingIds.length} requested prospects are no longer in the saved portfolio.`,
        missingCount: missingIds.length
      });
    }
  }

  const selection = createLowerFitResearchTargets(companies.values(), requestedIds);
  if (!selection.targets.length) {
    return res.status(409).json({
      error: "No lower-fit prospects with valid HTTP(S) company websites are available to research.",
      skippedInvalidUrl: selection.skippedInvalidUrl,
      skippedDuplicateDomain: selection.skippedDuplicateDomain
    });
  }

  const timestamp = new Date().toISOString();
  const job = {
    id: id(),
    kind: "lower_fit_research",
    status: "queued",
    createdAt: timestamp,
    startedAt: timestamp,
    targets: selection.targets,
    totalTargets: selection.targets.length,
    completedTargets: 0,
    completedTargetIds: [],
    researchedCompanies: 0,
    upgradedToReview: 0,
    upgradedToPriority: 0,
    skippedInvalidUrl: selection.skippedInvalidUrl,
    skippedDuplicateDomain: selection.skippedDuplicateDomain,
    pages: 0,
    records: 0,
    companiesVisited: 0,
    currentTargets: [],
    errors: []
  };
  jobs.set(job.id, job);
  persistState();
  void backgroundTasks.track(
    runLowerFitResearch(job),
    "Lower-fit prospect research"
  );
  res.status(202).json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    totalTargets: job.totalTargets,
    skippedInvalidUrl: job.skippedInvalidUrl,
    skippedDuplicateDomain: job.skippedDuplicateDomain
  });
});

app.post("/api/companies/research-stale", crawlRateLimit, (req, res) => {
  const parsed = z.object({
    staleAfterDays: z.number().int().min(1).max(3650).default(90)
  }).strict().safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const activeJob = [...jobs.values()].find(job =>
    ["lower_fit_research", "stale_lead_research"].includes(job.kind) &&
    ["queued", "running"].includes(job.status)
  );
  if (activeJob) {
    return res.status(409).json({
      error: "A saved-company re-research job is already queued or running.",
      jobId: activeJob.id
    });
  }

  const selection = createStaleCompanyResearchTargets(companies.values(), {
    staleAfterDays: parsed.data.staleAfterDays
  });
  if (!selection.targets.length) {
    return res.status(409).json({
      error: `No saved prospects older than ${selection.staleAfterDays} days with valid HTTP(S) company websites are available to research.`,
      skippedInvalidUrl: selection.skippedInvalidUrl,
      skippedDuplicateDomain: selection.skippedDuplicateDomain
    });
  }

  const timestamp = new Date().toISOString();
  const job = {
    id: id(),
    kind: "stale_lead_research",
    staleAfterDays: selection.staleAfterDays,
    status: "queued",
    createdAt: timestamp,
    startedAt: timestamp,
    targets: selection.targets,
    totalTargets: selection.targets.length,
    completedTargets: 0,
    completedTargetIds: [],
    researchedCompanies: 0,
    upgradedToReview: 0,
    upgradedToPriority: 0,
    skippedInvalidUrl: selection.skippedInvalidUrl,
    skippedDuplicateDomain: selection.skippedDuplicateDomain,
    pages: 0,
    records: 0,
    companiesVisited: 0,
    currentTargets: [],
    errors: []
  };
  jobs.set(job.id, job);
  persistState();
  void backgroundTasks.track(runLowerFitResearch(job), "Stale-lead refresh");
  res.status(202).json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    totalTargets: job.totalTargets,
    staleAfterDays: job.staleAfterDays,
    skippedInvalidUrl: job.skippedInvalidUrl,
    skippedDuplicateDomain: job.skippedDuplicateDomain
  });
});

app.post("/api/companies/import-directory", (req, res) => {
  if (hasActiveCrawlJob()) {
    return res.status(409).json({ error: "Wait for active discovery or crawling before importing prospects." });
  }

  const componentsSchema = z.object({
    serviceFit: z.number().int().min(0).max(35),
    operatingScale: z.number().int().min(0).max(20),
    indiaMarketFit: z.number().int().min(0).max(15),
    integrationReadiness: z.number().int().min(0).max(10),
    buyingSignals: z.literal(0),
    reachability: z.number().int().min(0).max(5)
  }).strict();
  const profileUrlSchema = z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "clutch.co" && /^\/profile\/[^/]+\/?$/i.test(url.pathname);
  }, "Must be an HTTPS Clutch company profile URL.");
  const schema = z.object({
    companies: z.array(z.object({
      companyName: z.string().trim().min(1).max(200),
      sourceUrl: z.string().url().refine(value => ["http:", "https:"].includes(new URL(value).protocol), "Company website must use HTTP or HTTPS."),
      profileUrl: profileUrlSchema,
      location: z.string().trim().min(2).max(120).refine(value => /,\s*India$/i.test(value), "Location must be an India city listing."),
      services: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
      phones: z.array(z.string().trim().min(3).max(80)).max(10),
      workflowEvidence: z.array(z.string().trim().min(1).max(120)).max(10),
      score: z.number().int().min(0).max(69),
      tier: z.enum(["Review", "Low fit"]),
      components: componentsSchema,
      scoreBasis: z.string().trim().min(1).max(1000)
    }).strict()).min(1).max(500)
  }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.companies.some(company =>
    company.tier !== (company.score >= 45 ? "Review" : "Low fit") ||
    company.components.buyingSignals !== 0 ||
    company.components.reachability !== (normalizePhoneNumbers(company.phones).length ? 2 : 0) ||
    company.components.serviceFit + company.components.operatingScale +
      company.components.indiaMarketFit + company.components.integrationReadiness +
      company.components.buyingSignals + company.components.reachability !== company.score
  )) {
    return res.status(400).json({ error: "Score tiers and components must match the supplied directory-only estimates." });
  }

  const timestamp = new Date().toISOString();
  let imported = 0;
  let skipped = 0;
  const importedIdentities = new Set();
  for (const company of parsed.data.companies) {
    const id = normalizeDomain(company.sourceUrl);
    const identity = companyIdentityKey(company.companyName, company.location);
    const identityExists = identity && (
      importedIdentities.has(identity) ||
      [...companies.values()].some(existing =>
        companyIdentityKey(existing.companyName, existing.location) === identity
      )
    );
    if (companies.has(id) || identityExists) {
      skipped += 1;
      continue;
    }

    if (identity) importedIdentities.add(identity);
    const workflowEvidence = company.workflowEvidence;
    const contactPhones = normalizePhoneNumbers(company.phones);
    const record = {
      id,
      companyName: company.companyName,
      industry: "Digital Marketing Agency",
      title: "Clutch India digital-marketing directory profile",
      sourceUrl: company.sourceUrl,
      directoryUrl: company.profileUrl,
      location: company.location,
      companyActivities: company.services,
      dakiniRecommendations: workflowEvidence.length
        ? [`Potential areas to research: ${workflowEvidence.join(", ")}. Inferred from listed services, not a verified company need.`]
        : ["No Dakini AI workflow is confirmed; research company operations before outreach."],
      detectedUseCases: [],
      contactEmails: [],
      contactPhones,
      contactPages: contactPhones.length ? [company.profileUrl] : [],
      score: {
        score: company.score,
        tier: company.tier,
        matchedUseCases: workflowEvidence,
        components: company.components
      },
      evidence: [{
        field: "directoryScoreEstimate",
        quote: `${company.scoreBasis} Buying intent is unverified; this score is not a purchase probability.`,
        source_url: company.profileUrl
      }],
      pagesScanned: [{
        url: company.profileUrl,
        title: "Clutch company profile",
        sourceType: "public directory listing"
      }],
      qualificationNote: "Directory-only, rule-based fit estimate. Buying intent and company operations are unverified; location is city-level only.",
      legitimacy: {
        status: "directory_only",
        score: null,
        components: {},
        reasons: ["A third-party directory profile was provided; the first-party company website has not been crawled."],
        firstPartyPagesScanned: 0,
        identityMatch: false,
        businessEvidence: true,
        canAutoQualify: false
      },
      scoreVersion: SCORE_VERSION,
      capturedAt: timestamp
    };
    companies.set(id, record);
    imported += 1;
  }

  persistState();
  res.json({ imported, skipped, total: companies.size });
});

app.post("/api/companies/clear-exported", (req, res) => {
  if (hasActiveCrawlJob()) {
    return res.status(409).json({ error: "Wait for the active scrape to finish before clearing downloaded prospects." });
  }

  const parsed = z.object({
    companyIds: z.array(z.string().min(1).max(255)).min(1).max(10000)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const companyIds = [...new Set(parsed.data.companyIds)];
  if (companyIds.some(companyId => !companies.has(companyId))) {
    return res.status(409).json({ error: "The prospect list changed before it could be cleared. Refresh and download again." });
  }

  for (const companyId of companyIds) companies.delete(companyId);
  persistState();
  res.json({ removed: companyIds.length, remaining: companies.size });
});

app.delete("/api/companies", (req, res) => {
  if (hasActiveCrawlJob()) {
    return res.status(409).json({ error: "Wait for the active scrape to finish before clearing scraped data." });
  }
  const removed = companies.size;
  companies.clear();
  scrapedDomains.clear();
  persistState();
  res.json({ removed, remaining: companies.size });
});

/* Dashboard */
app.get("/api/dashboard", (req, res) => {
  const list = [...companies.values()];
  res.json({
    companies: list.length,
    priority: list.filter(x => x.score.tier === "Priority").length,
    review: list.filter(x => x.score.tier === "Review").length,
    lowFit: list.filter(x => x.score.tier === "Low fit").length,
    jobs: jobs.size
  });
});

const DEMO_HTML = `
<!doctype html>
<html>
<head><title>Demo Digital Marketing Agency</title></head>
<body>
  <h1>Example Digital Growth Agency</h1>
  <p>Company: Example Digital Growth Pvt Ltd</p>
  <p>We are a digital marketing agency serving businesses across India.</p>
  <p>We run multi-channel campaigns across SEO, paid media, and content marketing.</p>
  <p>Our customer support and sales teams are hiring marketing coordinators and telecallers.</p>
  <p>We are evaluating AI voice automation to handle high call volumes for lead qualification and customer support.</p>
  <p>We support Hindi, Tamil and Kannada.</p>
  <p>Customer support operates 8 AM to 8 PM.</p>
  <p>Our CRM uses Freshdesk.</p>
  <p>Email: hello@exampleagency.in</p>
  <p>Phone: +919876543210</p>
</body>
</html>`;

async function resumeInterruptedAutomation() {
  for (const job of selectRecoverableAutomationJobs(jobs.values())) {
    try {
      if (job.directoryRetrieval || job.kind.includes("public_directory_retrieval")) {
        await runScheduledPublicDirectoryRetrieval(job.kind, job);
      } else if (["lower_fit_research", "stale_lead_research"].includes(job.kind)) {
        await runLowerFitResearch(job);
      } else if (job.kind.endsWith("_web_discovery")) {
        if (job.dailyTargetEnabled || job.kind === "daily_web_discovery" ||
            (job.kind === "engine_web_discovery" && engineState.mode === "daily")) {
          await runDailyDiscoveryUntilTarget(job);
        } else {
          await runDiscoveryJob(job);
        }
      } else {
        discoveryState.activeSourceDiscoveryJobId = job.id;
        await runSourceDiscoveryJob(job.kind, job);
      }
    } catch (error) {
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      job.error = `Automatic restart recovery failed: ${error.message}`;
      if (discoveryState.activeSourceDiscoveryJobId === job.id) {
        discoveryState.activeSourceDiscoveryJobId = null;
      }
      if (["lower_fit_research", "stale_lead_research"].includes(job.kind)) {
        recordEngineEvent("error", job.error, { jobId: job.id });
      } else {
        discoveryState.lastSourceDiscoveryError = job.error;
        discoveryState.lastPublicDirectoryRetrievalError = job.error;
      }
      persistState();
      console.error(job.error);
    }
  }
}

function stopSchedulers() {
  if (engineTimeout) {
    clearTimeout(engineTimeout);
    engineTimeout = null;
  }
  if (dailyDiscoveryTimeout) {
    clearTimeout(dailyDiscoveryTimeout);
    dailyDiscoveryTimeout = null;
  }
}

const shutdownServer = createGracefulShutdown({
  stopSchedulers: () => {
    isShuttingDown = true;
    stopSchedulers();
  },
  closeEventStreams: () => {
    for (const client of sseClients) client.end();
    sseClients.clear();
  },
  closeServer: () => {
    if (!httpServer?.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      httpServer.close(error => error ? reject(error) : resolve());
    });
  },
  drainTasks: () => backgroundTasks.drain(),
  persistState,
  closeStateStore: () => stateStore.close(),
  log: message => console.log(message)
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("Request failed:", error.message);
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body exceeds the 1 MB limit." });
  }
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must contain valid JSON." });
  }
  res.status(500).json({ error: "An unexpected server error occurred." });
});

if (require.main === module) {
  recalculateStoredScores();
  process.once("SIGINT", () => {
    void shutdownServer("SIGINT").catch(error => {
      console.error("Graceful shutdown failed:", error.message);
      process.exitCode = 1;
    });
  });
  process.once("SIGTERM", () => {
    void shutdownServer("SIGTERM").catch(error => {
      console.error("Graceful shutdown failed:", error.message);
      process.exitCode = 1;
    });
  });
  httpServer = app.listen(PORT, HOST, () => {
    console.log(`Dakini ICP Scraper running at http://${HOST}:${PORT}`);
    void backgroundTasks.track(
      resumeInterruptedAutomation(),
      "Automation recovery"
    )
      .finally(() => {
        if (isShuttingDown) return;
        if (process.env.NODE_ENV !== "test") {
          scheduleNextEngineCycle();
        } else {
          scheduleDailyDiscovery();
        }
      });
  });
}

module.exports = app;
