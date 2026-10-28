const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizePhoneNumber, normalizePhoneNumbers } = require("../public/phone-numbers");

test("normalizes public phone number formatting without inventing country codes", () => {
  assert.equal(normalizePhoneNumber(" '+91 (987) 654-3210 "), "+919876543210");
  assert.equal(normalizePhoneNumber("011 4491 0820"), "01144910820");
});

test("removes repeated, malformed, and placeholder phone values", () => {
  assert.equal(normalizePhoneNumber("+65 11111111"), "");
  assert.equal(normalizePhoneNumber("12+3456789"), "");
  assert.equal(normalizePhoneNumber("123456"), "");
});

test("deduplicates normalized phone values", () => {
  assert.deepEqual(normalizePhoneNumbers([
    "'+91 98765 43210",
    "+91-9876543210",
    "011 4491 0820"
  ]), ["+919876543210", "01144910820"]);
});
