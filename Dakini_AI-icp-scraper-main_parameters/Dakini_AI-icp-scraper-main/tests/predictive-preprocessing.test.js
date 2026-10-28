const assert = require("node:assert/strict");
const { test } = require("node:test");
const { prepareCompanyContext } = require("../predictive-preprocessing");

test("ranks and selects target-relevant snippets, deduplicating boilerplate and repeated content", () => {
  const pages = [
    {
      url: "https://example.com/",
      sourceType: "company website",
      title: "Example",
      text: "Welcome to Example | We use cookies to improve your experience. | Our retail stores serve customers across India. | Our support team handles thousands of customer calls and offers multilingual assistance."
    },
    {
      url: "https://example.com/support",
      title: "Customer Support",
      text: "Our support team handles thousands of customer calls and offers multilingual assistance. | Contact our support team at support@example.com."
    },
    {
      url: "https://search.example/result",
      sourceType: "web search",
      text: "We are evaluating an AI voice agent."
    }
  ];

  const result = prepareCompanyContext(pages, {
    industries: ["Retail"],
    locations: ["India"],
    useCases: ["customer support"]
  });

  assert.equal(result.sourcePages, 2);
  assert.ok(result.duplicateSegmentsRemoved >= 1);
  assert.ok(result.selectedSegments >= 2);
  assert.ok(result.signals.includes("customer support"));
  assert.ok(result.signals.includes("ICP match"));
  assert.ok(result.sources.some(source => source.url === "https://example.com/support"));
  assert.ok(result.sources.find(source => source.url === "https://example.com/").selectionReasons.includes("homepage coverage"));
  assert.ok(!result.pages.find(page => page.url.includes("/")).text.includes("cookies"));
  assert.equal(result.pages.find(page => page.sourceType === "web search").text, "");
});

test("keeps selected context within configured character and segment budgets", () => {
  const pages = [{
    url: "https://example.com/services",
    text: Array.from({ length: 100 }, (_, index) =>
      `Customer support team provides customer service and answers frequent customer queries number ${index}.`
    ).join(" | ")
  }];

  const result = prepareCompanyContext(pages, {}, { maxContextChars: 500, maxSegments: 3 });

  assert.ok(result.selectedCharacters <= 500);
  assert.ok(result.selectedSegments <= 3);
  assert.equal(result.pages.reduce((total, page) => total + page.text.length, 0), result.selectedCharacters);
});

test("retains homepage overview even when workflow signals occur on another page", () => {
  const result = prepareCompanyContext([
    {
      url: "https://example.com/",
      sourceType: "company website",
      title: "Example Holdings",
      text: "Example Holdings is a family-owned retail group with locations across India."
    },
    {
      url: "https://example.com/support",
      sourceType: "company website",
      title: "Customer support",
      text: "Our customer support team answers thousands of calls every week."
    }
  ]);

  assert.match(result.pages[0].text, /family-owned retail group/);
  assert.ok(result.sources.find(source => source.url === "https://example.com/").selectionReasons.includes("homepage coverage"));
  assert.match(result.pages[1].text, /customer support team/);
});

test("falls back transparently when no candidate segment matches known signals", () => {
  const result = prepareCompanyContext([{
    url: "https://example.com/",
    sourceType: "company website",
    text: "A distinct paragraph describing a highly unusual artisanal enterprise."
  }]);

  assert.equal(result.selectedSegments, 1);
  assert.equal(result.fallbackUsed, true);
  assert.match(result.pages[0].text, /artisanal enterprise/);
  assert.deepEqual(result.signals, []);
  assert.equal(result.contextReductionPercent, 0);
});
