const { INDIA_DISCOVERY_LOCATIONS } = require("./india-geography");

const ALL_INDUSTRY_VALUES = /^(?:all(?:\s+(?:industr(?:y|ies)|sectors?))?|any\s+industry)$/i;

function normalizeIndustryList(industries = []) {
  return (Array.isArray(industries) ? industries : [])
    .map(industry => typeof industry === "string" ? industry.trim() : "")
    .filter(Boolean);
}

function hasAllIndustrySelection(industries = []) {
  const normalized = normalizeIndustryList(industries);
  return normalized.length === 0 || normalized.some(industry => ALL_INDUSTRY_VALUES.test(industry));
}

function buildSourceDiscoveryQueries({
  profiles = [],
  defaultIndustries = [],
  templates = [],
  dayNumber = 0,
  queriesPerRun = 8
} = {}) {
  const normalizedDefaultIndustries = normalizeIndustryList(defaultIndustries);
  const broadDefaults = normalizedDefaultIndustries;
  const usableProfiles = profiles.flatMap(profile => {
    const normalizedIndustries = normalizeIndustryList(profile.industries);
    const industries = hasAllIndustrySelection(normalizedIndustries)
      ? broadDefaults
      : normalizedIndustries;
    const areaLocations = (Array.isArray(profile.areas) ? profile.areas : [])
      .map(location => typeof location === "string" ? location.trim() : "")
      .filter(Boolean);
    const requestedLocations = [
      ...(Array.isArray(profile.locations) ? profile.locations : []),
      ...areaLocations
    ]
      .map(location => typeof location === "string" ? location.trim() : "")
      .filter(Boolean)
      .filter((location, index, values) =>
        values.findIndex(value => value.toLowerCase() === location.toLowerCase()) === index
      );
    const locations = profile.anyLocation || !requestedLocations.length ? [""] : requestedLocations;
    const targetLocations = locations.some(location => location.toLowerCase() === "india")
      ? [...new Set([...INDIA_DISCOVERY_LOCATIONS, ...locations])]
      : locations;
    return industries.length && targetLocations.length
      ? [{ id: profile.id, industries, locations: targetLocations }]
      : [];
  });
  const targetProfiles = usableProfiles.length
    ? usableProfiles
    : [{ id: "", industries: broadDefaults, locations: INDIA_DISCOVERY_LOCATIONS }];

  const targets = [];
  const seenTargets = new Set();
  for (const profile of targetProfiles) {
    for (const industry of profile.industries) {
      for (const location of profile.locations) {
        const key = `${profile.id}|${industry}|${location}`.toLowerCase();
        if (seenTargets.has(key)) continue;
        seenTargets.add(key);
        targets.push({ icpId: profile.id || null, industry, location });
      }
    }
  }

  const targetsByLocation = new Map();
  for (const target of targets) {
    const locationTargets = targetsByLocation.get(target.location) || [];
    locationTargets.push(target);
    targetsByLocation.set(target.location, locationTargets);
  }
  const locationGroups = [...targetsByLocation.values()];
  const orderedTargets = [];
  for (let visit = 0; visit < Math.max(0, ...locationGroups.map(group => group.length)); visit += 1) {
    locationGroups.forEach((group, locationIndex) => {
      if (group[visit]) {
        orderedTargets.push(group[(visit + locationIndex + Math.max(0, dayNumber)) % group.length]);
      }
    });
  }

  const queryPool = [];
  const seenQueries = new Set();
  for (const template of templates) {
    for (const target of orderedTargets) {
      const query = template
        .replaceAll("{industry}", target.industry)
        .replaceAll("{location}", target.location)
        .replaceAll('""', "")
        .replace(/\s+/g, " ")
        .trim();
      if (seenQueries.has(query)) continue;
      seenQueries.add(query);
      queryPool.push({ ...target, query });
    }
  }
  if (!queryPool.length) return [];

  const queryCount = Math.min(Math.max(1, queriesPerRun), queryPool.length);
  const offset = (Math.max(0, dayNumber) * queryCount) % queryPool.length;
  const selected = Array.from({ length: queryCount }, (_, index) =>
    queryPool[(offset + index) % queryPool.length]
  );

  return selected.map(({ query, icpId, industry, location }) => ({
    query,
    icpId,
    industry,
    location
  }));
}

module.exports = { buildSourceDiscoveryQueries };
