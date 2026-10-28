const assert = require("node:assert/strict");
const { test } = require("node:test");
const { scoreLead } = require("../prospect-scoring");

function makeData(overrides = {}) {
  return {
    industry: "Healthcare",
    detectedUseCases: [],
    locations: ["India"],
    sourceText: "India",
    callingTeam: false,
    branches: 0,
    highCallVolume: false,
    extendedHours: false,
    voiceHiringSignal: false,
    indiaMarketSignal: true,
    multilingualSignal: false,
    telephonyOrCrm: false,
    systemIntegrationSignal: false,
    automationIntent: false,
    expansionSignal: false,
    buyingSignal: false,
    aiSolutionProvider: false,
    roleEmail: "",
    phone: "",
    ...overrides
  };
}

test("matches common industry aliases such as BFSI and clinics", () => {
  const bfsI = scoreLead(
    makeData({ industry: "Banking & Financial Services" }),
    { industries: ["BFSI"], locations: [], useCases: [] }
  );
  const clinics = scoreLead(
    makeData({ industry: "Healthcare" }),
    { industries: ["Clinics"], locations: [], useCases: [] }
  );

  assert.equal(bfsI.strongIcpMatch, true);
  assert.equal(clinics.strongIcpMatch, true);
});

test("maps ICP workflow labels to their equivalent detected workflow", () => {
  const result = scoreLead(
    makeData({
      detectedUseCases: ["customer support"],
      callingTeam: true,
      highCallVolume: true,
      multilingualSignal: true,
      extendedHours: true,
      telephonyOrCrm: true
    }),
    {
      industries: ["Clinics"],
      locations: [],
      useCases: ["Customer Service"]
    }
  );

  assert.equal(result.strongIcpMatch, true);
  assert.deepEqual(result.matchedUseCases, ["Customer Service"]);
  assert.deepEqual(result.dakiniWorkflowMatches, ["customer support"]);
  assert.equal(result.score, 42);
  assert.equal(result.tier, "Low fit");
});

test("appointment and booking signals alone are not direct Dakini core fit", () => {
  const result = scoreLead(
    makeData({
      detectedUseCases: ["appointment scheduling", "reservations and bookings"],
      callingTeam: true,
      highCallVolume: true,
      telephonyOrCrm: true,
      roleEmail: "contact@clinic.example"
    }),
    { industries: ["Healthcare"], locations: [], useCases: [] }
  );

  assert.equal(result.score, 24);
  assert.equal(result.tier, "Low fit");
  assert.deepEqual(result.dakiniWorkflowMatches, []);
});

test("awards Priority only when strong score, explicit buying intent, and core fit align", () => {
  const result = scoreLead(
    makeData({
      detectedUseCases: [
        "customer support",
        "sales follow-up",
        "knowledge and FAQs"
      ],
      callingTeam: true,
      branches: 4,
      highCallVolume: true,
      extendedHours: true,
      voiceHiringSignal: true,
      multilingualSignal: true,
      telephonyOrCrm: true,
      systemIntegrationSignal: true,
      automationIntent: true,
      expansionSignal: true,
      buyingSignal: true,
      roleEmail: "support@clinic.example",
      phone: "+91 12345 67890",
      websiteWorkflowSignals: {
        customerSupport: "found",
        enquiryForm: "found",
        faqs: "found",
        bookingWorkflow: "found"
      }
    }),
    {
      industries: ["Clinics"],
      locations: [],
      useCases: ["Customer Support"]
    }
  );

  assert.equal(result.score, 100);
  assert.equal(result.tier, "Priority");
});

test("caps suspected AI vendors and excludes them from prospect tiers", () => {
  const result = scoreLead(
    makeData({
      detectedUseCases: ["customer support", "lead qualification"],
      callingTeam: true,
      branches: 3,
      highCallVolume: true,
      extendedHours: true,
      voiceHiringSignal: true,
      indiaMarketSignal: true,
      multilingualSignal: true,
      telephonyOrCrm: true,
      systemIntegrationSignal: true,
      automationIntent: true,
      buyingSignal: true,
      roleEmail: "sales@vendor.example",
      phone: "+91 12345 67890",
      aiSolutionProvider: true
    }),
    { industries: [], locations: [], useCases: [] }
  );

  assert.equal(result.score, 20);
  assert.equal(result.tier, "Low fit");
  assert.ok(result.components.aiVendorExclusion < 0);
});

test("does not award Research tier for workflow evidence without operational or integration signals", () => {
  const result = scoreLead(
    makeData({
      detectedUseCases: ["customer support"],
      indiaMarketSignal: true,
      multilingualSignal: true,
      roleEmail: "contact@clinic.example",
      phone: "+91 12345 67890"
    }),
    { industries: [], locations: [], useCases: [] }
  );

  assert.equal(result.score, 25);
  assert.equal(result.tier, "Low fit");
});

test("deduplicates equivalent core workflows so repeated wording cannot inflate service fit", () => {
  const result = scoreLead(
    makeData({
      detectedUseCases: [
        "customer support",
        "customer service",
        "customer care",
        "knowledge and FAQs",
        "FAQs"
      ]
    }),
    { industries: [], locations: [], useCases: [] }
  );

  assert.deepEqual(result.dakiniWorkflowMatches, [
    "customer support",
    "knowledge and FAQs"
  ]);
  assert.equal(result.components.serviceFit, 25);
});

test("scores only positively detected first-party workflows and documents the component ceiling", () => {
  const result = scoreLead(
    makeData({
      detectedUseCases: ["customer support"],
      websiteWorkflowSignals: {
        customerSupport: "found",
        enquiryForm: "found",
        faqs: "not_detected",
        bookingWorkflow: "found"
      }
    }),
    { industries: [], locations: [], useCases: [] }
  );

  assert.equal(result.components.firstPartyWorkflowFit, 9);
  assert.equal(result.scoreComponentMaximums.firstPartyWorkflowFit, 12);
  assert.equal(result.components.buyingSignals, 0);
});

test("keeps explicit buying intent necessary for Priority even with maximum operational fit", () => {
  const result = scoreLead(
    makeData({
      detectedUseCases: ["customer support", "sales follow-up", "knowledge and FAQs"],
      callingTeam: true,
      branches: 4,
      highCallVolume: true,
      extendedHours: true,
      voiceHiringSignal: true,
      indiaMarketSignal: true,
      multilingualSignal: true,
      telephonyOrCrm: true,
      systemIntegrationSignal: true,
      expansionSignal: true,
      roleEmail: "support@clinic.example",
      phone: "+91 12345 67890",
      websiteWorkflowSignals: {
        customerSupport: "found",
        enquiryForm: "found",
        faqs: "found",
        bookingWorkflow: "found"
      },
      buyingSignal: false
    }),
    { industries: [], locations: [], useCases: [] }
  );

  assert.equal(result.score, 88);
  assert.equal(result.tier, "Review");
});

test("requires 90 points for Priority and keeps a strong 89-point lead in Research", () => {
  const result = scoreLead(
    makeData({
      detectedUseCases: ["customer support", "sales follow-up", "knowledge and FAQs"],
      callingTeam: true,
      branches: 4,
      highCallVolume: true,
      extendedHours: true,
      voiceHiringSignal: true,
      indiaMarketSignal: true,
      multilingualSignal: true,
      telephonyOrCrm: true,
      systemIntegrationSignal: true,
      automationIntent: true,
      buyingSignal: true,
      roleEmail: "",
      phone: "",
      expansionSignal: false,
      websiteWorkflowSignals: {
        customerSupport: "found",
        enquiryForm: "found",
        faqs: "not_detected",
        bookingWorkflow: "found"
      }
    }),
    { industries: [], locations: [], useCases: [] }
  );

  assert.equal(result.score, 89);
  assert.equal(result.tier, "Review");
});
