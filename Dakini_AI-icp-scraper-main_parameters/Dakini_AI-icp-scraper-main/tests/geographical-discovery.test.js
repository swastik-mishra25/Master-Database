const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  buildOverpassQuery,
  discoverGeographicalBusinesses,
  mapOverpassElements
} = require("../geographical-discovery");

test("builds a bounded Overpass query for the requested city and industry", () => {
  const query = buildOverpassQuery({
    city: 'Bengaluru"->.unsafe',
    category: "Clinics",
    limit: 25
  });

  assert.match(query, /area\["name"="Bengaluru\\"->\.unsafe"\]/);
  assert.match(query, /\["healthcare"\]/);
  assert.match(query, /\["contact:website"\]/);
  assert.match(query, /out tags 25/);
  assert.doesNotMatch(query, /\["shop"\]/);
  const boundedQuery = buildOverpassQuery({
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    bounds: { south: 12, west: 77, north: 13, east: 78 },
    category: "Clinics"
  });
  assert.match(boundedQuery, /node\(12,77,13,78\)/);
  assert.doesNotMatch(boundedQuery, /area\.searchArea/);
  assert.throws(() => buildOverpassQuery({ city: " ", category: "all" }), /city must contain/);
  assert.throws(() => buildOverpassQuery({ city: "Delhi", limit: 201 }), /limit must be an integer/);
});

test("maps named public businesses to unique HTTP(S) company websites with OSM citations", () => {
  const results = mapOverpassElements([
    {
      type: "node",
      id: 11,
      tags: {
        name: "Example Clinic",
        website: "example.com",
        phone: "+91 80 1234 5678",
        "addr:city": "Bengaluru"
      }
    },
    {
      type: "way",
      id: 12,
      tags: { name: "Duplicate domain", website: "https://www.example.com/about" }
    },
    { type: "node", id: 13, tags: { name: "No website", phone: "12345678" } },
    { type: "node", id: 14, tags: { name: "Unsafe", website: "javascript:alert(1)" } },
    { type: "node", id: 15, tags: { name: "Credential URL", website: "https://user:pass@private.example" } },
    { type: "node", id: 16, tags: { website: "https://nameless.example" } }
  ], { city: "Bengaluru", category: "Clinics", limit: 25 });

  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.com/");
  assert.match(results[0].sourceUrl, /openstreetmap\.org\/node\/11/);
  assert.match(results[0].description, /Bengaluru/);
  assert.match(results[0].description, /Public phone listed in OSM/);
});

test("geocodes the city before querying Overpass and surfaces provider errors", async () => {
  const requests = [];
  const results = await discoverGeographicalBusinesses({
    city: "Chennai",
    state: "Tamil Nadu",
    category: "Healthcare",
    providers: ["openstreetmap"],
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? {
          ok: true,
          json: async () => [{
            name: "Chennai",
            addresstype: "city",
            display_name: "Chennai, Tamil Nadu, India",
            boundingbox: ["12.8", "13.2", "80.1", "80.4"]
          }]
        }
        : { ok: true, json: async () => ({ elements: [] }) };
    }
  });

  assert.deepEqual(results.businesses, []);
  assert.equal(results.sourceStats.openstreetmap.status, "ok");
  assert.match(requests[0].url, /^https:\/\/nominatim\.openstreetmap\.org/);
  assert.match(requests[1].url, /^https:\/\/overpass-api\.de\//);
  assert.equal(requests[1].options.method, "POST");
  assert.match(requests[1].options.headers["User-Agent"], /DakiniICPResearch/);
  assert.match(decodeURIComponent(requests[1].options.body), /12\.8,80\.1,13\.2,80\.4/);
  await assert.rejects(
    discoverGeographicalBusinesses({
      city: "Testville",
      category: "Healthcare",
      providers: ["openstreetmap"],
      fetchImpl: async url => String(url).includes("nominatim")
        ? {
          ok: true,
          json: async () => [{
            name: "Testville",
            addresstype: "city",
            display_name: "Testville, India",
            boundingbox: ["10", "11", "70", "71"]
          }]
        }
        : { ok: false, status: 429 }
    }),
    /All geographic discovery sources failed.*Overpass returned HTTP 429/
  );
});

test("aggregates independent OSM and SearXNG sources while preserving citations", async () => {
  const result = await discoverGeographicalBusinesses({
    city: "Pune",
    country: "India",
    category: "Clinics",
    providers: ["openstreetmap", "searxng"],
    searxngUrl: "http://localhost:8080",
    fetchImpl: async url => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "nominatim.openstreetmap.org") {
        return {
          ok: true,
          json: async () => [{
            name: "Pune",
            addresstype: "city",
            display_name: "Pune, Maharashtra, India",
            boundingbox: ["18", "19", "73", "74"]
          }]
        };
      }
      if (parsed.hostname === "overpass-api.de") {
        return {
          ok: true,
          json: async () => ({
            elements: [{
              type: "node",
              id: 20,
              tags: { name: "OSM Clinic", website: "osm-clinic.example" }
            }]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          results: [{
            title: "Search Clinic",
            url: "https://search-clinic.example",
            content: "Clinic in Pune"
          }]
        })
      };
    }
  });

  assert.equal(result.businesses.length, 2);
  assert.deepEqual(result.businesses.map(item => item.source), [
    "OpenStreetMap",
    "SearXNG Web Search"
  ]);
  assert.ok(result.businesses.every(item => item.sourceCitations.length === 1));
  assert.equal(result.sourceStats.searxng.status, "ok");
});

test("discovers Wikidata entries only when a public location description supports the target", async () => {
  let requestCount = 0;
  const result = await discoverGeographicalBusinesses({
    city: "Jaipur",
    country: "India",
    category: "Clinics",
    providers: ["wikidata"],
    fetchImpl: async url => {
      requestCount += 1;
      const parsed = new URL(String(url));
      return requestCount === 1
        ? {
          ok: true,
          json: async () => ({
            search: [{ id: "Q123", label: "Jaipur Clinic", description: "healthcare provider in Jaipur" }]
          })
        }
        : {
          ok: true,
          json: async () => ({
            entities: {
              Q123: {
                labels: { en: { value: "Jaipur Clinic" } },
                descriptions: { en: { value: "healthcare provider in Jaipur" } },
                claims: {
                  P856: [{
                    mainsnak: { datavalue: { value: "https://jaipur-clinic.example" } }
                  }]
                }
              }
            }
          })
        };
    }
  });

  assert.equal(requestCount, 2);
  assert.equal(result.businesses.length, 1);
  assert.equal(result.businesses[0].source, "Wikidata");
  assert.match(result.businesses[0].sourceUrl, /wikidata\.org\/wiki\/Q123/);
});

test("reports all configured geographic providers failing instead of returning a success-shaped empty result", async () => {
  await assert.rejects(
    discoverGeographicalBusinesses({
      city: "Failuretown",
      providers: ["openstreetmap"],
      fetchImpl: async () => ({ ok: false, status: 503 })
    }),
    /All geographic discovery sources failed.*Nominatim returned HTTP 503/
  );
});
