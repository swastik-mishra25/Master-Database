const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  isPublicAddress,
  resolvePublicHostname,
  validatePublicUrl,
  fetchPublicPage
} = require("../safe-fetch");

test("allows public addresses and rejects private, reserved, and mapped private addresses", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isPublicAddress(address), true, `${address} should be public`);
  }
  for (const address of [
    "127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "192.0.0.1", "224.0.0.1",
    "::1", "fc00::1", "fe80::1", "2001:db8::1", "2002:0808:0808::1",
    "::ffff:192.168.1.1"
  ]) {
    assert.equal(isPublicAddress(address), false, `${address} should not be public`);
  }
});

test("rejects unsafe URL schemes, credentials, ports, and mixed public/private DNS", async () => {
  for (const value of [
    "file:///etc/passwd",
    "http://user:pass@example.com/",
    "http://example.com:8080/",
    "http://127.0.0.1/"
  ]) {
    await assert.rejects(validatePublicUrl(value), /Only|Private|local|standard|public/i);
  }
  await assert.rejects(
    resolvePublicHostname("mixed.example", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 }
    ]),
    /Private or local hosts are blocked/
  );
});

test("revalidates redirects and refuses a redirect to a private address", async () => {
  let requests = 0;
  const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
  const fetchImpl = async () => {
    requests += 1;
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" }
    });
  };

  await assert.rejects(
    fetchPublicPage("https://public.example/", { lookup, fetchImpl }),
    /Private or local hosts are blocked/
  );
  assert.equal(requests, 1);
});

test("limits response size and rejects non-HTML content", async () => {
  const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
  const binaryFetch = async () => new Response("data", {
    headers: { "content-type": "application/octet-stream" }
  });
  await assert.rejects(
    fetchPublicPage("https://public.example/", { lookup, fetchImpl: binaryFetch }),
    /unsupported content type/
  );

  const oversizedFetch = async () => new Response("x".repeat(5 * 1024 * 1024 + 1), {
    headers: { "content-type": "text/html" }
  });
  await assert.rejects(
    fetchPublicPage("https://public.example/", { lookup, fetchImpl: oversizedFetch }),
    /5 MB limit/
  );
});

test("obeys robots.txt, caches policy per origin, and permits absent robots files", async () => {
  const { createRobotsPolicy } = require("../robots-policy");
  let requests = 0;
  const policy = createRobotsPolicy({
    fetchRobots: async () => {
      requests += 1;
      return {
        status: 200,
        body: [
          "User-agent: *",
          "Disallow: /private",
          "Allow: /private/public",
          "Crawl-delay: 0"
        ].join("\n")
      };
    },
    defaultCrawlDelayMs: 0,
    sleep: async () => {}
  });

  await assert.rejects(policy.beforeFetch("https://public.example/private/data"), /robots\.txt disallows/);
  await policy.beforeFetch("https://public.example/private/public/info");
  await policy.beforeFetch("https://public.example/open");
  assert.equal(requests, 1);

  const missingPolicy = createRobotsPolicy({
    fetchRobots: async () => ({ status: 404, body: "" }),
    defaultCrawlDelayMs: 0,
    sleep: async () => {}
  });
  const result = await missingPolicy.beforeFetch("https://missing.example/public");
  assert.equal(result.robotsAvailable, false);
});

test("fails closed when robots.txt is inaccessible or asks for an excessive delay", async () => {
  const { createRobotsPolicy } = require("../robots-policy");
  const unavailablePolicy = createRobotsPolicy({
    fetchRobots: async () => ({ status: 503, body: "" })
  });
  await assert.rejects(
    unavailablePolicy.beforeFetch("https://unavailable.example/public"),
    /robots\.txt returned HTTP 503/
  );

  const excessiveDelayPolicy = createRobotsPolicy({
    fetchRobots: async () => ({
      status: 200,
      body: "User-agent: *\nCrawl-delay: 4000"
    })
  });
  await assert.rejects(
    excessiveDelayPolicy.beforeFetch("https://slow.example/public"),
    /invalid or excessive crawl delay/
  );
});

test("spaces requests to an origin by its robots.txt crawl delay", async () => {
  const { createRobotsPolicy } = require("../robots-policy");
  let clock = 0;
  const waits = [];
  const policy = createRobotsPolicy({
    fetchRobots: async () => ({
      status: 200,
      body: "User-agent: *\nCrawl-delay: 0.01"
    }),
    now: () => clock,
    sleep: async duration => {
      waits.push(duration);
      clock += duration;
    }
  });

  await policy.beforeFetch("https://paced.example/one");
  await policy.beforeFetch("https://paced.example/two");
  assert.deepEqual(waits, [10]);
});
