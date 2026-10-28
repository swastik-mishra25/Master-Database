const assert = require("node:assert/strict");
const { test } = require("node:test");
const { findBuyingIntentSignal } = require("../buying-signals");

test("does not count generic web-development vendor-seeking language as AI buying intent", () => {
  assert.equal(
    findBuyingIntentSignal("Looking for a reliable web development company?"),
    null
  );
});

test("detects explicit evaluation of voice AI for customer support", () => {
  const signal = findBuyingIntentSignal(
    "We are evaluating AI voice agents for customer support."
  );

  assert.ok(signal);
  assert.match(signal[0], /evaluating AI voice agents/i);
});

test("detects procurement language for contact-center automation", () => {
  const signal = findBuyingIntentSignal(
    "Our RFP requests proposals for contact-center automation."
  );

  assert.ok(signal);
  assert.match(signal[0], /RFP requests proposals for contact-center automation/i);
});

test("does not count product descriptions without a buying action", () => {
  assert.equal(
    findBuyingIntentSignal("We provide conversational AI and voice automation services."),
    null
  );
});

test("rejects explicitly negated voice automation evaluation language", () => {
  assert.equal(
    findBuyingIntentSignal("We are not evaluating AI voice agents for customer support."),
    null
  );
  assert.equal(
    findBuyingIntentSignal("We stopped evaluating AI voice agents for customer support."),
    null
  );
});

test("does not mistake website marketing copy about visitors exploring for buyer intent", () => {
  assert.equal(
    findBuyingIntentSignal(
      "Our websites with engaging user interfaces keep visitors exploring real-time chat integration and AI-powered customer support systems."
    ),
    null
  );
});

test("requires a company-side decision action or procurement context", () => {
  assert.equal(
    findBuyingIntentSignal("The company provides AI voice agents for customer service."),
    null
  );
  assert.ok(findBuyingIntentSignal("Our team is piloting AI voice agents for customer service."));
  assert.ok(findBuyingIntentSignal("An RFP requests proposals for contact-center automation."));
});
