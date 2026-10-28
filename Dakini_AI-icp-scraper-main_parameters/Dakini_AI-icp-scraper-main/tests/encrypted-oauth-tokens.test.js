const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const {
  decryptOAuthTokens,
  encryptOAuthTokens,
  parseEncryptionKey
} = require("../encrypted-oauth-tokens");

const key = crypto.randomBytes(32).toString("hex");

test("encrypts OAuth tokens and decrypts them only with the matching key", () => {
  const tokens = {
    access_token: "access-secret",
    refresh_token: "refresh-secret",
    expiry_date: 123456789
  };
  const encrypted = encryptOAuthTokens(tokens, key);

  assert.equal(encrypted.version, 1);
  assert.doesNotMatch(JSON.stringify(encrypted), /access-secret|refresh-secret/);
  assert.deepEqual(decryptOAuthTokens(encrypted, key), tokens);
  assert.throws(
    () => decryptOAuthTokens(encrypted, crypto.randomBytes(32).toString("hex")),
    /Could not decrypt stored Google OAuth credentials/
  );
});

test("rejects malformed encryption keys and unsupported envelopes", () => {
  assert.throws(() => parseEncryptionKey("not-a-key"), /64 hexadecimal characters/);
  assert.throws(() => encryptOAuthTokens([], key), /must be an object/);
  assert.throws(
    () => decryptOAuthTokens({ version: 2 }, key),
    /unsupported encryption envelope/
  );
});
