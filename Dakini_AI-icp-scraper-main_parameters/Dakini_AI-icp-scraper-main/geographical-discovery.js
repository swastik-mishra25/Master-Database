const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
const NOMINATIM_API_URL = "https://nominatim.openstreetmap.org/search";
const WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php";
const DEFAULT_RESULT_LIMIT = 50;
const MAX_RESULT_LIMIT = 200;
const MAX_SEARXNG_RESULTS = 25;
const boundsCache = new Map();
let nextNominatimRequestAt = 0;
let nominatimQueue = Promise.resolve();

const CATEGORY_TAGS = {
  all: [
    ["office", null], ["shop", null], ["amenity", null], ["healthcare", null],
    ["tourism", null], ["craft", null], ["leisure", null], ["landuse", "retail"]
  ],
  healthcare: [["healthcare", null], ["amenity", "clinic"], ["amenity", "hospital"], ["amenity", "doctors"]],
  clinics: [["healthcare", null], ["amenity", "clinic"], ["amenity", "doctors"]],
  retail: [["shop", null], ["landuse", "retail"]],
  "e-commerce": [["shop", null]],
  ecommerce: [["shop", null]],
  hospitality: [["tourism", "hotel"], ["tourism", "guest_house"], ["amenity", "restaurant"]],
  hotels: [["tourism", "hotel"], ["tourism", "guest_house"]],
  "real estate": [["office", "estate_agent"]],
  "real estate agencies": [["office", "estate_agent"]],
  recruitment: [["office", "employment_agency"]],
  "recruitment firms": [["office", "employment_agency"]],
  logistics: [["office", "logistics"], ["landuse", "industrial"]],
  "professional services": [["office", null]],
  manufacturing: [["craft", null], ["landuse", "industrial"]],
  automotive: [["shop", "car"], ["shop", "car_repair"]],
  travel: [["office", "travel_agent"]],
  saas: [["office", "company"]],
  "digital marketing agency": [["office", "company"], ["office", "advertising_agency"]]
};

function isWikidataEnabled() {
  return process.env.GEOGRAPHIC_WIKIDATA_ENABLED !== "false";
}

function configuredSearxngUrl() {
  return (process.env.SEARXNG_URL || "").trim().replace(/\/+$/, "");
}

function normalizeInput(value, field, maxLength, allowEmpty = false) {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string.`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if ((!allowEmpty && !normalized) || normalized.length > maxLength ||
      /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new TypeError(`${field} must contain ${allowEmpty ? "0" : "1"} to ${maxLength} printable characters.`);
  }
  return normalized;
}

function validateLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULT_LIMIT) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_RESULT_LIMIT}.`);
  }
}

function escapeOverpassString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function categoryTags(category) {
  const key = category.toLowerCase().replace(/\s+/g, " ");
  return CATEGORY_TAGS[key] || CATEGORY_TAGS.all;
}

function buildOverpassQuery({
  city,
  state = "",
  country = "India",
  bounds,
  category = "all",
  limit = DEFAULT_RESULT_LIMIT
}) {
  const location = normalizeInput(city, "city", 100);
  const normalizedState = normalizeInput(state, "state", 100, true);
  const normalizedCountry = normalizeInput(country, "country", 100);
  const normalizedCategory = normalizeInput(category, "category", 100);
  validateLimit(limit);

  const selectors = categoryTags(normalizedCategory).flatMap(([key, value]) =>
    ["website", "contact:website"].flatMap(websiteTag =>
      ["node", "way", "relation"].map(type =>
        `  ${type}(${bounds
          ? `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
          : "area.searchArea"})["name"]["${key}"${value ? `="${value}"` : ""}]["${websiteTag}"];`
      )
    )
  );
  const areaQuery = [
    location,
    normalizedState,
    normalizedCountry
  ].filter(Boolean).map(escapeOverpassString);
  return [
    "[out:json][timeout:60];",
    ...(bounds ? [] : [
      `area["name"="${areaQuery[0]}"]["boundary"="administrative"]->.searchArea;`
    ]),
    "(",
    ...selectors,
    ");",
    `out tags ${limit};`
  ].join("\n");
}

function normalizeWebsite(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const candidate = value.trim().startsWith("//") ? `https:${value.trim()}` : value.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(candidate) ? candidate : `https://${candidate}`);
    if (!["http:", "https:"].includes(url.protocol) ||
        !url.hostname.includes(".") ||
        url.username ||
        url.password) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function normalizeDomain(value) {
  return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
}

function mapOverpassElements(elements, {
  city,
  state = "",
  country = "India",
  category,
  limit = DEFAULT_RESULT_LIMIT
} = {}) {
  if (!Array.isArray(elements)) throw new TypeError("Overpass response must contain an elements array.");
  const normalizedCity = normalizeInput(city, "city", 100);
  const normalizedState = normalizeInput(state, "state", 100, true);
  const normalizedCountry = normalizeInput(country, "country", 100);
  const normalizedCategory = normalizeInput(category, "category", 100);
  validateLimit(limit);
  const seenDomains = new Set();
  const results = [];

  for (const element of elements) {
    const tags = element?.tags || {};
    const website = normalizeWebsite(tags.website || tags["contact:website"]);
    const name = typeof tags.name === "string" ? tags.name.trim() : "";
    if (!website || !name) continue;

    const domain = normalizeDomain(website);
    if (seenDomains.has(domain)) continue;
    seenDomains.add(domain);

    const osmUrl = `https://www.openstreetmap.org/${encodeURIComponent(element.type)}/${encodeURIComponent(String(element.id))}`;
    const address = [
      tags["addr:city"],
      tags["addr:state"],
      tags["addr:country"]
    ].filter(value => typeof value === "string" && value.trim()).join(", ");
    const details = [
      `Listed as ${name} in OpenStreetMap.`,
      `Target: ${normalizedCategory} in ${[normalizedCity, normalizedState, normalizedCountry].filter(Boolean).join(", ")}.`,
      address ? `OSM address: ${address}.` : "",
      tags.phone || tags["contact:phone"] ? `Public phone listed in OSM: ${tags.phone || tags["contact:phone"]}.` : "",
      tags.email || tags["contact:email"] ? `Public email listed in OSM: ${tags.email || tags["contact:email"]}.` : "",
      `Map listing: ${osmUrl}`
    ].filter(Boolean).join(" ");

    results.push({
      url: website,
      domain,
      title: name,
      description: details,
      sourceUrl: osmUrl,
      source: "OpenStreetMap",
      city: normalizedCity,
      state: normalizedState,
      country: normalizedCountry,
      category: normalizedCategory
    });
    if (results.length >= limit) break;
  }

  return results;
}

async function fetchJson(fetchImpl, url, options, sourceName) {
  const response = await fetchImpl(url, options);
  if (!response.ok) throw new Error(`${sourceName} returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${sourceName} returned invalid JSON: ${error.message}`);
  }
}

async function resolveCityBounds({ city, state, country, fetchImpl }) {
  const key = [city, state, country].map(value => value.toLowerCase()).join("|");
  if (boundsCache.has(key)) return boundsCache.get(key);

  const url = new URL(NOMINATIM_API_URL);
  url.searchParams.set("q", [city, state, country].filter(Boolean).join(", "));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  if (country.toLowerCase() === "india") url.searchParams.set("countrycodes", "in");
  const previous = nominatimQueue;
  let release;
  nominatimQueue = new Promise(resolve => {
    release = resolve;
  });
  await previous;
  let places;
  try {
    const delay = Math.max(0, nextNominatimRequestAt - Date.now());
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    nextNominatimRequestAt = Date.now() + 1100;
    places = await fetchJson(fetchImpl, url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "Accept": "application/json",
        "User-Agent": "DakiniICPResearch/1.0 (public business discovery)"
      }
    }, "OpenStreetMap Nominatim");
  } finally {
    release();
  }
  const validPlaces = (Array.isArray(places) ? places : [])
    .filter(place => Array.isArray(place.boundingbox) && place.boundingbox.length === 4)
    .map(place => {
      const [south, north, west, east] = place.boundingbox.map(Number);
      if (![south, north, west, east].every(Number.isFinite) ||
          south < -90 || north > 90 || west < -180 || east > 180 ||
          south >= north || west >= east) return null;
      const name = String(place.name || "");
      const displayName = String(place.display_name || "");
      const cityMatch = `${name} ${displayName}`.toLowerCase().includes(city.toLowerCase());
      const stateMatch = !state || displayName.toLowerCase().includes(state.toLowerCase());
      const typePriority = ["city", "town", "municipality"].includes(place.addresstype) ? 0 : 1;
      const area = (north - south) * (east - west);
      return {
        bounds: { south, north, west, east },
        score: (cityMatch ? 0 : 10) + (stateMatch ? 0 : 5) + typePriority + area
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.score - right.score);
  if (!validPlaces.length) {
    throw new Error(`OpenStreetMap Nominatim could not resolve geographic bounds for ${[city, state, country].filter(Boolean).join(", ")}.`);
  }
  const bounds = validPlaces[0].bounds;
  boundsCache.set(key, bounds);
  if (boundsCache.size > 100) boundsCache.delete(boundsCache.keys().next().value);
  return bounds;
}

async function discoverOpenStreetMapBusinesses({
  city,
  state,
  country,
  category,
  limit,
  fetchImpl
}) {
  const bounds = await resolveCityBounds({ city, state, country, fetchImpl });
  const query = buildOverpassQuery({ city, state, country, bounds, category, limit });
  const url = new URL(OVERPASS_API_URL);
  const data = await fetchJson(fetchImpl, url, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "DakiniICPResearch/1.0 (public business discovery)",
      "Accept": "application/json"
    },
    body: `data=${encodeURIComponent(query)}`
  }, "OpenStreetMap Overpass");
  return {
    rawCount: Array.isArray(data.elements) ? data.elements.length : 0,
    businesses: mapOverpassElements(data.elements, { city, state, country, category, limit })
  };
}

function validateSearxngUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("SEARXNG_URL must be an HTTP(S) URL without embedded credentials.");
  }
  return url;
}

async function discoverSearxngBusinesses({
  city,
  state,
  country,
  category,
  limit,
  fetchImpl,
  endpoint = configuredSearxngUrl()
}) {
  if (!endpoint) return { status: "disabled", rawCount: 0, businesses: [] };
  const baseUrl = validateSearxngUrl(endpoint);
  const query = [category, city, state, country, "business official website"].filter(Boolean).join(" ");
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "en");
  url.searchParams.set("safesearch", "1");
  const data = await fetchJson(fetchImpl, url, {
    signal: AbortSignal.timeout(20000),
    headers: { "Accept": "application/json", "User-Agent": "DakiniICPResearch/1.0" }
  }, "SearXNG");
  const results = Array.isArray(data.results) ? data.results : [];
  const businesses = [];
  for (const item of results.slice(0, Math.min(limit, MAX_SEARXNG_RESULTS))) {
    const website = normalizeWebsite(item.url);
    const title = String(item.title || "").trim();
    if (!website || !title) continue;
    const description = String(item.content || item.snippet || "").slice(0, 1200);
    const citationUrl = new URL("/search", baseUrl);
    citationUrl.searchParams.set("q", query);
    businesses.push({
      url: website,
      domain: normalizeDomain(website),
      title: title.slice(0, 240),
      description: `SearXNG search result for ${query}. ${description}`,
      sourceUrl: citationUrl.href,
      source: "SearXNG Web Search",
      city,
      state,
      country,
      category
    });
  }
  return { status: "ok", rawCount: results.length, businesses };
}

function wikidataClaim(entity, property) {
  for (const claim of entity?.claims?.[property] || []) {
    const value = claim?.mainsnak?.datavalue?.value;
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

async function discoverWikidataBusinesses({
  city,
  state,
  country,
  category,
  limit,
  fetchImpl
}) {
  if (!isWikidataEnabled()) return { status: "disabled", rawCount: 0, businesses: [] };
  const searchUrl = new URL(WIKIDATA_API_URL);
  searchUrl.searchParams.set("action", "wbsearchentities");
  searchUrl.searchParams.set("search", `${category} ${city} ${state} ${country}`.trim());
  searchUrl.searchParams.set("language", "en");
  searchUrl.searchParams.set("uselang", "en");
  searchUrl.searchParams.set("type", "item");
  searchUrl.searchParams.set("limit", String(Math.min(20, limit)));
  searchUrl.searchParams.set("format", "json");
  const searchData = await fetchJson(fetchImpl, searchUrl, {
    signal: AbortSignal.timeout(15000),
    headers: { "Accept": "application/json", "User-Agent": "DakiniICPResearch/1.0" }
  }, "Wikidata");
  const items = Array.isArray(searchData.search) ? searchData.search : [];
  const ids = items.map(item => String(item.id || "")).filter(id => /^Q\d+$/.test(id)).slice(0, 50);
  if (!ids.length) return { status: "ok", rawCount: items.length, businesses: [] };

  const entityUrl = new URL(WIKIDATA_API_URL);
  entityUrl.searchParams.set("action", "wbgetentities");
  entityUrl.searchParams.set("ids", ids.join("|"));
  entityUrl.searchParams.set("props", "labels|descriptions|claims");
  entityUrl.searchParams.set("languages", "en");
  entityUrl.searchParams.set("format", "json");
  const entityData = await fetchJson(fetchImpl, entityUrl, {
    signal: AbortSignal.timeout(15000),
    headers: { "Accept": "application/json", "User-Agent": "DakiniICPResearch/1.0" }
  }, "Wikidata");
  const businesses = [];
  for (const [entityId, entity] of Object.entries(entityData.entities || {})) {
    const title = String(entity?.labels?.en?.value || "").trim();
    const description = String(entity?.descriptions?.en?.value || "").trim();
    const websiteClaim = wikidataClaim(entity, "P856");
    const website = normalizeWebsite(typeof websiteClaim === "string" ? websiteClaim : "");
    if (!title || !website) continue;
    const evidence = `${title} ${description}`.toLowerCase();
    if (!evidence.includes(city.toLowerCase()) &&
        !(state && evidence.includes(state.toLowerCase()))) continue;
    const sourceUrl = `https://www.wikidata.org/wiki/${encodeURIComponent(entityId)}`;
    businesses.push({
      url: website,
      domain: normalizeDomain(website),
      title,
      description: `Wikidata entry: ${description || "No description provided."} Location text matched ${city}${state ? `, ${state}` : ""}.`,
      sourceUrl,
      source: "Wikidata",
      city,
      state,
      country,
      category
    });
    if (businesses.length >= limit) break;
  }
  return { status: "ok", rawCount: items.length, businesses };
}

function mergeBusinessCandidates(groups, limit) {
  const byDomain = new Map();
  for (const business of groups.flatMap(group => group.businesses)) {
    const prior = byDomain.get(business.domain);
    if (!prior) {
      byDomain.set(business.domain, { ...business, sourceCitations: [business.sourceUrl] });
      continue;
    }
    if (!prior.sourceCitations.includes(business.sourceUrl)) {
      prior.sourceCitations.push(business.sourceUrl);
      prior.description = `${prior.description} Additional source (${business.source}): ${business.description}`;
    }
  }
  return [...byDomain.values()].slice(0, limit);
}

async function discoverGeographicalBusinesses({
  city,
  state = "",
  country = "India",
  category = "all",
  limit = DEFAULT_RESULT_LIMIT,
  fetchImpl = fetch,
  providers = ["openstreetmap", "searxng", "wikidata"],
  searxngUrl = configuredSearxngUrl()
} = {}) {
  const normalizedCity = normalizeInput(city, "city", 100);
  const normalizedState = normalizeInput(state, "state", 100, true);
  const normalizedCountry = normalizeInput(country, "country", 100);
  const normalizedCategory = normalizeInput(category, "category", 100);
  validateLimit(limit);
  if (!Array.isArray(providers) || providers.some(provider =>
    !["openstreetmap", "searxng", "wikidata"].includes(provider)
  )) throw new TypeError("providers contains an unsupported geographic source.");

  const providerTasks = providers.map(provider => {
    if (provider === "openstreetmap") {
      return discoverOpenStreetMapBusinesses({
        city: normalizedCity,
        state: normalizedState,
        country: normalizedCountry,
        category: normalizedCategory,
        limit,
        fetchImpl
      }).then(result => ({ provider, ...result, status: "ok" }));
    }
    if (provider === "searxng") {
      return discoverSearxngBusinesses({
        city: normalizedCity,
        state: normalizedState,
        country: normalizedCountry,
        category: normalizedCategory,
        limit,
        fetchImpl,
        endpoint: searxngUrl
      }).then(result => ({ provider, ...result }));
    }
    return discoverWikidataBusinesses({
      city: normalizedCity,
      state: normalizedState,
      country: normalizedCountry,
      category: normalizedCategory,
      limit,
      fetchImpl
    }).then(result => ({ provider, ...result }));
  });

  const settled = await Promise.allSettled(providerTasks);
  const groups = [];
  const sourceStats = {};
  const errors = [];
  settled.forEach((result, index) => {
    const provider = providers[index];
    if (result.status === "fulfilled") {
      groups.push(result.value);
      sourceStats[provider] = {
        status: result.value.status,
        raw: result.value.rawCount || 0,
        unique: result.value.businesses.length
      };
    } else {
      sourceStats[provider] = { status: "error", raw: 0, unique: 0, error: result.reason.message };
      errors.push(`${provider}: ${result.reason.message}`);
    }
  });
  const attemptedCount = providers.filter(provider =>
    provider === "openstreetmap" ||
    provider === "wikidata" && isWikidataEnabled() ||
    provider === "searxng" && Boolean(searxngUrl)
  ).length;
  const successfulCount = groups.filter(group => group.status === "ok").length;
  if (attemptedCount > 0 && successfulCount === 0) {
    throw new Error(`All geographic discovery sources failed. ${errors.join(" ")}`);
  }

  return {
    businesses: mergeBusinessCandidates(groups, limit),
    sourceStats,
    notes: errors
  };
}

module.exports = {
  DEFAULT_RESULT_LIMIT,
  MAX_RESULT_LIMIT,
  buildOverpassQuery,
  discoverGeographicalBusinesses,
  mapOverpassElements
};
