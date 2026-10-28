const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildSourceDiscoveryQueries } = require("../source-discovery");
const { INDIA_DISCOVERY_LOCATIONS } = require("../india-geography");

const templates = [
  '"{industry}" "{location}" digital marketing agency directory list',
  '"{industry}" "{location}" SEO and performance marketing agencies directory',
  '"{industry}" "{location}" marketing company websites'
];
const defaultIndustries = [
  "digital marketing agency",
  "SEO agency",
  "performance marketing agency",
  "BFSI"
];

test("source discovery searches configured industries across target regions", () => {
  const queries = buildSourceDiscoveryQueries({
    profiles: [
      { id: "marketing-icp", industries: ["digital marketing agency"], locations: ["India"] },
      { id: "healthcare-icp", industries: ["Healthcare"], locations: ["India"] },
      { id: "overseas-seo-icp", industries: ["SEO agency"], locations: ["Singapore"] }
    ],
    defaultIndustries,
    templates,
    dayNumber: 0,
    queriesPerRun: 100
  });

  assert.equal(queries.length, 100);
  assert.ok(queries.some(query => query.icpId === "marketing-icp"));
  assert.ok(queries.some(query => query.icpId === "healthcare-icp" && query.industry === "Healthcare"));
  assert.ok(queries.some(query => query.icpId === "overseas-seo-icp"));
  assert.ok(queries.every(query =>
    ["digital marketing agency", "Healthcare", "SEO agency"].includes(query.industry)
  ));
  assert.ok(queries.some(query => query.location === "Singapore"));
  assert.ok(queries.some(query => query.location === "India"));
  assert.ok(queries.some(query => query.location === "Andhra Pradesh"));
  assert.ok(queries.some(query => /singapore/i.test(query.query)));
});

test("broad all-industry ICPs include the full sector range from banking to ecommerce", () => {
  const broadDefaultIndustries = [
    "Banking & Financial Services",
    "Insurance",
    "Healthcare",
    "Retail",
    "E-commerce",
    "Education",
    "Real Estate"
  ];

  const queries = buildSourceDiscoveryQueries({
    profiles: [{ id: "broad", industries: ["all industries"], locations: ["India"] }],
    defaultIndustries: broadDefaultIndustries,
    templates,
    dayNumber: 2,
    queriesPerRun: 100
  });

  assert.equal(queries.length, Math.min(
    100,
    broadDefaultIndustries.length * 37 * templates.length
  ));
  assert.ok(queries.every(query => query.icpId === "broad"));
  assert.ok(queries.some(query => /banking|financial/i.test(query.industry)));
  assert.ok(queries.some(query => /e-commerce|ecommerce|retail/i.test(query.industry)));
  assert.ok(queries.some(query => query.location === "India"));
  assert.ok(queries.some(query => query.location === "West Bengal"));
});

test("falls back to India queries from the default broad sector list when no usable ICP exists", () => {
  const broadDefaultIndustries = [
    "Banking & Financial Services",
    "Insurance",
    "Healthcare",
    "Retail",
    "E-commerce",
    "Education",
    "Real Estate"
  ];

  const queries = buildSourceDiscoveryQueries({
    profiles: [],
    defaultIndustries: broadDefaultIndustries,
    templates,
    dayNumber: 2,
    queriesPerRun: 100
  });

  assert.equal(queries.length, Math.min(
    100,
    broadDefaultIndustries.length * 37 * templates.length
  ));
  assert.ok(queries.every(query => query.icpId === null));
  assert.ok(queries.some(query => query.location === "India"));
  assert.ok(queries.some(query => query.location === "West Bengal"));
  assert.ok(queries.some(query => /banking|financial/i.test(query.industry)));
  assert.ok(queries.some(query => /e-commerce|ecommerce|retail/i.test(query.industry)));
});

test("limits the run to available templates without duplicate queries", () => {
  const queries = buildSourceDiscoveryQueries({
    profiles: [{ id: "single", industries: ["digital marketing agency"], locations: ["Mumbai"] }],
    defaultIndustries,
    templates,
    dayNumber: 0,
    queriesPerRun: 100
  });

  assert.equal(queries.length, templates.length);
  assert.equal(new Set(queries.map(item => item.query)).size, templates.length);
  assert.ok(queries.every(item => item.location === "Mumbai"));
});

test("source discovery accepts every Indian state and union territory as a target", () => {
  const locations = [
    "Arunachal Pradesh",
    "Jammu and Kashmir",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Puducherry"
  ];
  const queries = buildSourceDiscoveryQueries({
    profiles: [{ id: "all-india", industries: ["digital marketing agency"], locations }],
    defaultIndustries,
    templates,
    dayNumber: 0,
    queriesPerRun: 100
  });

  assert.equal(queries.length, locations.length * templates.length);
  for (const location of locations) {
    const locationQueries = queries.filter(query => query.location === location);
    assert.equal(locationQueries.length, templates.length);
    assert.ok(locationQueries.every(query => query.query.includes(`"${location}"`)));
  }
});

test("source discovery includes selected areas alongside Indian state targets", () => {
  const queries = buildSourceDiscoveryQueries({
    profiles: [{
      id: "regional",
      industries: ["digital marketing agency"],
      locations: ["Karnataka", "Bengaluru", "Mysuru"],
      areas: ["Bengaluru", "Mysuru"]
    }],
    defaultIndustries,
    templates,
    dayNumber: 0,
    queriesPerRun: 100
  });

  assert.ok(queries.some(query => query.location === "Karnataka"));
  assert.ok(queries.some(query => query.location === "Bengaluru"));
  assert.ok(queries.some(query => query.location === "Mysuru"));
  assert.ok(queries.every(query => query.icpId === "regional"));
});

test("custom location targets can be searched without an India selection", () => {
  const queries = buildSourceDiscoveryQueries({
    profiles: [{
      id: "area-without-region",
      industries: ["digital marketing agency"],
      locations: ["Whitefield"],
      areas: ["Whitefield"]
    }],
    defaultIndustries,
    templates,
    dayNumber: 0,
    queriesPerRun: 100
  });

  assert.ok(queries.some(query => query.location === "Whitefield"));
});

test("India-wide ICPs distribute source searches across every state and union territory", () => {
  const queries = buildSourceDiscoveryQueries({
    profiles: [{ id: "countrywide", industries: ["digital marketing agency"], locations: ["India"] }],
    defaultIndustries,
    templates,
    dayNumber: 0,
    queriesPerRun: 50
  });

  assert.equal(new Set(queries.map(query => query.location)).size, INDIA_DISCOVERY_LOCATIONS.length);
  assert.ok(INDIA_DISCOVERY_LOCATIONS.every(location =>
    queries.some(query => query.location === location)
  ));
});

test("supports source discovery in locations outside India", () => {
  const queries = buildSourceDiscoveryQueries({
    profiles: [{ id: "overseas", industries: ["digital marketing agency"], locations: ["Singapore"] }],
    defaultIndustries,
    templates,
    dayNumber: 0,
    queriesPerRun: 3
  });

  assert.ok(queries.every(query => query.location === "Singapore"));
});

test("supports location-independent industry source discovery", () => {
  const queries = buildSourceDiscoveryQueries({
    profiles: [{ id: "global", industries: ["Healthcare"], locations: [], anyLocation: true }],
    defaultIndustries,
    templates,
    dayNumber: 0,
    queriesPerRun: 3
  });

  assert.equal(queries.length, 3);
  assert.ok(queries.every(query => query.icpId === "global"));
  assert.ok(queries.every(query => query.location === ""));
  assert.ok(queries.every(query => !/india|singapore/i.test(query.query)));
});
