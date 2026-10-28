const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  INDIA_DISCOVERY_LOCATIONS,
  INDIA_STATES_AND_UNION_TERRITORIES,
  findIndiaLocations,
  hasIndiaGeographicSignal,
  isIndiaTargetLocation
} = require("../india-geography");

test("covers India, all states, and all union territories", () => {
  assert.equal(INDIA_STATES_AND_UNION_TERRITORIES.length, 36);
  assert.equal(INDIA_STATES_AND_UNION_TERRITORIES.filter(name =>
    !/Andaman|Chandigarh|Dadra|Delhi|Jammu|Ladakh|Lakshadweep|Puducherry/.test(name)
  ).length, 28);
  assert.equal(INDIA_DISCOVERY_LOCATIONS.length, 37);
});

test("recognizes state, union territory, and city targeting while rejecting overseas locations", () => {
  assert.equal(isIndiaTargetLocation(" Karnataka "), true);
  assert.equal(isIndiaTargetLocation("Jammu and Kashmir"), true);
  assert.equal(isIndiaTargetLocation("Bengaluru"), true);
  assert.equal(isIndiaTargetLocation("Singapore"), false);
});

test("detects geographic evidence across the Indian regions", () => {
  assert.equal(hasIndiaGeographicSignal("Our office is in Mizoram."), true);
  assert.equal(hasIndiaGeographicSignal("We operate in Dadra and Nagar Haveli and Daman and Diu."), true);
  assert.equal(hasIndiaGeographicSignal("Our only office is in Singapore."), false);
});

test("extracts specific state and city evidence from company text", () => {
  assert.deepEqual(findIndiaLocations("We have offices in Gujarat and Bengaluru."), [
    "Gujarat",
    "Bengaluru"
  ]);
});
