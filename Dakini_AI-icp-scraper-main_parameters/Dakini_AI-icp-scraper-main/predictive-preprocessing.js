const { INDIA_GEOGRAPHIC_SIGNAL } = require("./india-geography");

const PREPROCESSING_VERSION = 1;
const DEFAULT_MAX_CONTEXT_CHARS = 24000;
const DEFAULT_MAX_SEGMENTS = 80;

const SIGNAL_PATTERNS = [
  ["customer support", /customer support|customer service|customer care|help ?desk|contact center|call center|customer helpline|inbound calls|customer quer(?:y|ies)|support requests|complaints/i],
  ["lead qualification", /lead qualification|qualify leads|sales enquiries|sales inquiries|lead generation|prospect qualification/i],
  ["sales follow-up", /sales follow.?up|follow.?up calls|schedule demos?|demo booking|sales agent|sales calls/i],
  ["knowledge and FAQs", /knowledge agent|frequently asked questions|\bFAQs?\b|self.service|policy questions|process questions|answer(?:ing)? queries/i],
  ["product recommendations", /product recommendations?|personalized shopping|product discovery|shopping assistant/i],
  ["customer operations", /appointment|booking|order status|delivery updates|returns|branch locator|reservation|patient intake|technical support|troubleshooting|dispatch|field service/i],
  ["scale", /customer support team|customer service team|sales team|call center|contact center|telecallers?|high[- ]volume calls?|large call volumes?|thousands of calls|large customer base|millions of customers|24\/7|24x7|round.the.clock|extended hours|multiple branches/i],
  ["integration", /crm|freshdesk|salesforce|hubspot|telephony|contact center platform|integrat(?:e|es|ed|ing|ion)|\bAPI\b|customer (?:database|records|information)|existing systems|sales tools/i],
  ["automation intent", /evaluat(?:ing|e)|explor(?:ing|e)|implement(?:ing)?|deploy(?:ing)?|adopt(?:ing)?|looking for|request for proposal|seeking|piloting|voice automation|ai voice agent/i],
  ["language and market", new RegExp(`${INDIA_GEOGRAPHIC_SIGNAL.source}|multilingual|multiple languages|regional languages|local languages|dialects|accents|Hindi|Tamil|Telugu|Kannada|Marathi|Bengali|Gujarati|Malayalam|Punjabi|Odia`, "i")],
  ["growth", /hiring|careers|recruit|expansion|new branch|new location|launch|rapid growth|scaling(?: up)?/i],
  ["industry", /digital marketing|seo agency|performance marketing|social media marketing|lead generation|content marketing|ecommerce|e-commerce|real estate|logistics|retail|hotel|hospitality|travel|telecom|utilities|automotive|manufacturing|restaurant|professional services|education/i]
];

const BOILERPLATE_PATTERNS = [
  /^(?:accept|manage|reject) cookies?$/,
  /^(?:we use cookies|cookie preferences|privacy policy|terms (?:and|&) conditions|all rights reserved)\b/i,
  /^(?:skip to content|back to top|menu|navigation|home|read more|learn more|view more)$/i,
  /^(?:facebook|instagram|linkedin|youtube|twitter|copyright)\b/i
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLongSegment(segment, maxLength = 700) {
  if (segment.length <= maxLength) return [segment];
  const parts = [];
  let remaining = segment;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf(" ", maxLength);
    if (splitAt < Math.floor(maxLength * 0.6)) splitAt = maxLength;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function segmentPage(page) {
  const text = normalizeText([page.title, page.text].filter(Boolean).join(" | "));
  return text
    .split(/\s*\|\s*|(?<=[.!?])\s+/)
    .flatMap(value => splitLongSegment(normalizeText(value)))
    .filter(value => value.length >= 15 && !BOILERPLATE_PATTERNS.some(pattern => pattern.test(value)));
}

function scoreSegment(text, page, icpTerms) {
  const tags = SIGNAL_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([tag]) => tag);
  let score = tags.reduce((total, tag) => total + (
    ["customer support", "lead qualification", "sales follow-up", "knowledge and FAQs",
      "product recommendations", "automation intent"].includes(tag) ? 5 : 2
  ), 0);

  const normalized = text.toLowerCase();
  for (const term of icpTerms) {
    if (term && normalized.includes(term)) {
      score += 5;
      tags.push("ICP match");
    }
  }

  const pagePath = `${page.url || ""} ${page.title || ""}`.toLowerCase();
  if (/product|service|solution|customer|support|contact|integration|platform|case-stud|faq|knowledge/.test(pagePath)) {
    score += 2;
  }
  if (/contact|support|customer-care|help|grievance/.test(pagePath) &&
      /@|(?:\+?\d[\d\s().-]{6,}\d)/.test(text)) {
    score += 5;
    tags.push("public contact");
  }

  return { score, tags: [...new Set(tags)] };
}

function prepareCompanyContext(pageSources, icp = {}, options = {}) {
  const maxContextChars = Number.isInteger(options.maxContextChars) && options.maxContextChars > 0
    ? options.maxContextChars
    : DEFAULT_MAX_CONTEXT_CHARS;
  const maxSegments = Number.isInteger(options.maxSegments) && options.maxSegments > 0
    ? options.maxSegments
    : DEFAULT_MAX_SEGMENTS;
  const pages = Array.isArray(pageSources) ? pageSources : [];
  const analysisPages = pages.filter(page => page.sourceType !== "web search");
  const rawCharacters = analysisPages.reduce((total, page) =>
    total + String(page.title || "").length + String(page.text || "").length, 0);
  const icpTerms = [
    ...(icp.industries || []),
    ...(icp.locations || []),
    ...(icp.useCases || [])
  ].map(value => normalizeText(value).toLowerCase()).filter(Boolean);

  const seen = new Set();
  const candidates = [];
  const fallbackCandidates = [];
  let duplicateSegmentsRemoved = 0;
  let sequence = 0;
  for (const page of analysisPages) {
    for (const text of segmentPage(page)) {
      const order = sequence++;
      const key = text.toLowerCase();
      if (seen.has(key)) {
        duplicateSegmentsRemoved += 1;
        continue;
      }
      seen.add(key);
      fallbackCandidates.push({
        url: page.url,
        text,
        score: 0,
        tags: [],
        order,
        selectionReason: "fallback: no known relevance signal"
      });
      const relevance = scoreSegment(text, page, icpTerms);
      if (relevance.score > 0) {
        candidates.push({
          url: page.url,
          text,
          score: relevance.score,
          tags: relevance.tags,
          order,
          selectionReason: "matched relevance signals"
        });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.text.length - right.text.length);
  const usedFallback = candidates.length === 0;
  const rankedCandidates = usedFallback ? fallbackCandidates : candidates;
  const selected = [];
  let selectedCharacterBudget = 0;
  const homepage = analysisPages.find(page => {
    if (page.sourceType !== "company website") return false;
    try {
      return new URL(page.url).pathname === "/";
    } catch {
      return false;
    }
  });
  if (homepage && maxSegments > 0) {
    const overview = fallbackCandidates.find(candidate => candidate.url === homepage.url);
    if (overview && overview.text.length + 3 <= maxContextChars) {
      const relevantOverview = candidates.find(candidate =>
        candidate.url === overview.url && candidate.order === overview.order
      );
      selected.push({
        ...(relevantOverview || overview),
        selectionReason: "homepage coverage"
      });
      selectedCharacterBudget += overview.text.length + 3;
    }
  }
  for (const candidate of rankedCandidates) {
    if (selected.length >= maxSegments) break;
    if (selected.some(item => item.url === candidate.url && item.order === candidate.order)) continue;
    const addedLength = candidate.text.length + 3;
    if (selectedCharacterBudget + addedLength > maxContextChars) continue;
    selected.push(candidate);
    selectedCharacterBudget += addedLength;
  }
  selected.sort((left, right) => left.order - right.order);

  const selectedByUrl = new Map();
  for (const candidate of selected) {
    const snippets = selectedByUrl.get(candidate.url) || [];
    snippets.push(candidate.text);
    selectedByUrl.set(candidate.url, snippets);
  }
  const preparedPages = pages.map(page => ({
    ...page,
    text: (selectedByUrl.get(page.url) || []).join(" | ")
  }));

  const selectedSources = [...selectedByUrl.entries()].map(([url, snippets]) => ({
    url,
    segments: snippets.length,
    signals: [...new Set(selected
      .filter(candidate => candidate.url === url)
      .flatMap(candidate => candidate.tags))],
    selectionReasons: [...new Set(selected
      .filter(candidate => candidate.url === url)
      .map(candidate => candidate.selectionReason))]
  }));
  const selectedSignals = [...new Set(selected.flatMap(candidate => candidate.tags))];
  const selectedPageTexts = [...selectedByUrl.values()].map(snippets => snippets.join(" | "));
  const selectedCharacters = selectedPageTexts.reduce((total, text) => total + text.length, 0) +
    Math.max(0, selectedPageTexts.length - 1) * 3;

  return {
    version: PREPROCESSING_VERSION,
    method: "rule-based relevance ranking",
    sourcePages: analysisPages.length,
    candidateSegments: seen.size,
    selectedSegments: selected.length,
    fallbackUsed: usedFallback,
    fallbackReason: usedFallback ? "No known relevance signals matched; retained deduplicated text in source order." : "",
    duplicateSegmentsRemoved,
    rawCharacters,
    selectedCharacters,
    contextReductionPercent: rawCharacters
      ? Math.max(0, Math.min(100, Math.round((1 - selectedCharacters / rawCharacters) * 100)))
      : 0,
    signals: selectedSignals,
    sources: selectedSources,
    pages: preparedPages
  };
}

module.exports = {
  DEFAULT_MAX_CONTEXT_CHARS,
  PREPROCESSING_VERSION,
  prepareCompanyContext
};
