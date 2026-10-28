const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  DISCOVERY_INDUSTRIES,
  DAILY_DISCOVERY_QUERIES_PER_RUN,
  INDIA_DISCOVERY_LOCATIONS,
  hasRelevantDiscoveryEvidence,
  hasMarketingDiscoveryEvidence,
  selectDailyDiscoveryQueries
} = require("../discovery-queries");

test("selects 100 distinct daily queries with coverage across all Indian regions", () => {
  const queries = selectDailyDiscoveryQueries(new Date("2026-10-08T00:00:00Z"));
  const regionalQueries = queries.filter(query => !query.startsWith('"'));
  const signalQueries = queries.filter(query => query.startsWith('"'));
  const regionalCounts = INDIA_DISCOVERY_LOCATIONS.map(location =>
    regionalQueries.filter(query => query.startsWith(`${location} `)).length
  );

  assert.equal(DAILY_DISCOVERY_QUERIES_PER_RUN, 100);
  assert.equal(queries.length, DAILY_DISCOVERY_QUERIES_PER_RUN);
  assert.equal(new Set(queries).size, 100);
  assert.equal(regionalQueries.length + signalQueries.length, DAILY_DISCOVERY_QUERIES_PER_RUN);
  assert.ok(regionalCounts.every(count => count >= 2));
  assert.ok(queries.some(query => query.startsWith("Karnataka ")));
  assert.ok(queries.some(query => query.startsWith("Ladakh ")));
  assert.ok(queries.some(query => query.startsWith("Puducherry ")));
});

test("rotates regional industry and buying-signal queries between days", () => {
  const firstDay = selectDailyDiscoveryQueries(new Date("2026-10-08T00:00:00Z"));
  const secondDay = selectDailyDiscoveryQueries(new Date("2026-10-09T00:00:00Z"));
  assert.notDeepEqual(firstDay, secondDay);
  assert.ok(DISCOVERY_INDUSTRIES.some(industry =>
    firstDay.some(query => query.includes(industry)) &&
    secondDay.some(query => query.includes(industry))
  ));
});

test("limits all daily query types to explicitly configured target locations", () => {
  const locations = ["Karnataka", "Maharashtra"];
  const queries = selectDailyDiscoveryQueries(new Date("2026-10-08T00:00:00Z"), locations);

  assert.equal(queries.length, DAILY_DISCOVERY_QUERIES_PER_RUN);
  assert.ok(queries.every(query => locations.some(location => query.includes(location))));
  assert.ok(queries.some(query => query.startsWith("Karnataka ")));
  assert.ok(queries.some(query => query.startsWith("Maharashtra ")));
});

test("runs industry discovery without adding a location term when any-location mode is selected", () => {
  const queries = selectDailyDiscoveryQueries(
    new Date("2026-10-08T00:00:00Z"),
    [],
    ["Clinics"],
    true
  );

  assert.ok(queries.length > 60);
  assert.equal(new Set(queries).size, queries.length);
  assert.equal(new Set(queries).size, queries.length);
  assert.ok(queries.every(query => !/India|Karnataka|Bengaluru/i.test(query)));
  assert.ok(queries.every(query => /clinic/i.test(query)));
  assert.ok(queries.some(query => /appointments|booking/i.test(query)));
});

test("supports focused industry targeting with appointment, hiring, branch, and website signals", () => {
  const locations = ["Karnataka", "Bengaluru"];
  const industries = ["Digital Marketing Agency", "SEO Agency", "Performance Marketing"];
  const queries = selectDailyDiscoveryQueries(
    new Date("2026-10-08T00:00:00Z"),
    locations,
    industries
  );

  assert.equal(queries.length, 100);
  assert.equal(new Set(queries).size, queries.length);
  assert.ok(queries.every(query => locations.some(location => query.includes(location))));
  assert.ok(queries.slice(0, 60).every(query =>
    industries.some(industry => query.toLowerCase().includes(industry.toLowerCase()))
  ));
  assert.ok(queries.slice(60).every(query => hasRelevantDiscoveryEvidence([{
    title: "",
    description: "",
    query
  }])));
  assert.ok(queries.some(query => /appointment|booking/i.test(query)));
  assert.ok(queries.some(query => /hiring|telecaller|receptionist/i.test(query)));
  assert.ok(queries.some(query => /branches|locations|offices/i.test(query)));
  assert.ok(queries.some(query => /website|enquiry form|faq/i.test(query)));
});

test("rotating queries cover expansion, ecosystem, ecommerce, registries, contact routes, technology, news, franchises, and languages", () => {
  const queries = Array.from({ length: 4 }, (_, batchIndex) =>
    selectDailyDiscoveryQueries(
      new Date("2026-10-08T00:00:00Z"),
      ["Tamil Nadu"],
      ["E-commerce"],
      false,
      batchIndex
    )
  ).flat();
  const text = queries.join("\n").toLowerCase();

  for (const signal of [
    "new branch",
    "partners",
    "freshdesk",
    "order status",
    "company registry",
    "support email",
    "helpdesk",
    "business news",
    "franchise",
    "tamil"
  ]) {
    assert.ok(text.includes(signal), `expected rotating discovery query for ${signal}`);
  }
});

test("rotates to a fresh batch of location-independent industry queries", () => {
  const now = new Date("2026-10-08T00:00:00Z");
  const locations = [];
  const industries = ["Clinics", "Hotels", "Recruitment Firms", "Education Centres", "Real Estate Agencies"];
  const firstBatch = selectDailyDiscoveryQueries(now, locations, industries, true, 0);
  const secondBatch = selectDailyDiscoveryQueries(now, locations, industries, true, 1);
  const overlap = firstBatch.filter(query => secondBatch.includes(query));

  assert.equal(firstBatch.length, 100);
  assert.ok(secondBatch.length > 0);
  assert.equal(overlap.length, 0);
  assert.ok(secondBatch.some(query => /clinic|hotel|recruitment|education|real estate/i.test(query)));
});

test("uses marketing-targeted search context when snippets omit industry keywords", () => {
  assert.equal(hasMarketingDiscoveryEvidence([{
    title: "Full-service growth consultancy",
    description: "Helping Indian businesses acquire customers.",
    queries: ["Bengaluru SEO Agency company sales enquiries contact"]
  }]), true);
  assert.equal(hasMarketingDiscoveryEvidence([{
    title: "Full-service growth consultancy",
    description: "Helping Indian businesses acquire customers.",
    queries: ["Bengaluru Banking & Financial Services company sales enquiries contact"]
  }]), false);
  assert.equal(hasMarketingDiscoveryEvidence([{
    title: "Digital Marketing Agency",
    description: "Public snippet",
    queries: ["Bengaluru professional services"]
  }]), true);
});

test("accepts relevant cross-industry website and hiring search evidence", () => {
  assert.equal(hasRelevantDiscoveryEvidence([{
    title: "Clinic appointment bookings",
    description: "A multi-branch healthcare group is hiring receptionists.",
    queries: ["Bengaluru clinic website enquiry form FAQs customer support"]
  }]), true);
  assert.equal(hasRelevantDiscoveryEvidence([{
    title: "Unrelated news article",
    description: "A local event listing.",
    queries: ["Bengaluru weather forecast"]
  }]), false);
});
