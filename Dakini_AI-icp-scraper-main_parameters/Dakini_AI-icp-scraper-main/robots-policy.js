const robotsParser = require("robots-parser");

const USER_AGENT = "Dakini-Research";
const DEFAULT_CRAWL_DELAY_MS = 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CRAWL_DELAY_MS = 60 * 60 * 1000;

function createRobotsPolicy({
  fetchRobots,
  userAgent = USER_AGENT,
  defaultCrawlDelayMs = DEFAULT_CRAWL_DELAY_MS,
  cacheTtlMs = CACHE_TTL_MS,
  now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  const cachedPolicies = new Map();
  const pendingPolicies = new Map();
  const originSchedules = new Map();

  async function getPolicy(url) {
    const parsed = new URL(url);
    const robotsUrl = `${parsed.origin}/robots.txt`;
    const cached = cachedPolicies.get(parsed.origin);
    if (cached && cached.expiresAt > now()) return cached;
    if (pendingPolicies.has(parsed.origin)) return pendingPolicies.get(parsed.origin);

    const pending = (async () => {
      let policy;
      try {
        const response = await fetchRobots(robotsUrl);
        if (response.status === 404 || response.status === 410) {
          policy = { parser: null, crawlDelayMs: defaultCrawlDelayMs, available: false };
        } else if (response.status !== 200) {
          throw new Error(`robots.txt returned HTTP ${response.status}; crawling is paused.`);
        } else {
          const parser = robotsParser(robotsUrl, response.body);
          const crawlDelay = parser.getCrawlDelay(userAgent);
          const crawlDelayMs = crawlDelay === undefined
            ? defaultCrawlDelayMs
            : Math.ceil(crawlDelay * 1000);
          if (!Number.isFinite(crawlDelayMs) || crawlDelayMs < 0 ||
              crawlDelayMs > MAX_CRAWL_DELAY_MS) {
            throw new Error("robots.txt specifies an invalid or excessive crawl delay.");
          }
          policy = { parser, crawlDelayMs, available: true };
        }
      } catch (error) {
        const notFound = /^HTTP (?:404|410)\b/.test(error.message);
        if (notFound) {
          policy = { parser: null, crawlDelayMs: defaultCrawlDelayMs, available: false };
        } else {
          throw error;
        }
      }

      const entry = { ...policy, expiresAt: now() + cacheTtlMs };
      cachedPolicies.set(parsed.origin, entry);
      return entry;
    })();

    pendingPolicies.set(parsed.origin, pending);
    try {
      return await pending;
    } finally {
      pendingPolicies.delete(parsed.origin);
    }
  }

  async function waitForCrawlSlot(origin, delayMs) {
    let schedule = originSchedules.get(origin);
    if (!schedule) {
      schedule = { tail: Promise.resolve(), nextRequestAt: 0 };
      originSchedules.set(origin, schedule);
    }

    let release;
    const previous = schedule.tail;
    schedule.tail = new Promise(resolve => {
      release = resolve;
    });
    await previous;
    try {
      const waitMs = Math.max(0, schedule.nextRequestAt - now());
      if (waitMs > 0) await sleep(waitMs);
      schedule.nextRequestAt = now() + delayMs;
    } finally {
      release();
    }
  }

  return {
    async beforeFetch(url) {
      const parsed = new URL(url);
      const policy = await getPolicy(url);
      if (policy.parser && policy.parser.isAllowed(url, userAgent) === false) {
        throw new Error(`robots.txt disallows crawling ${parsed.pathname}.`);
      }
      await waitForCrawlSlot(parsed.origin, policy.crawlDelayMs);
      return { robotsAvailable: policy.available, crawlDelayMs: policy.crawlDelayMs };
    },
    clearCache() {
      cachedPolicies.clear();
    }
  };
}

module.exports = { createRobotsPolicy };
