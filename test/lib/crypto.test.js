const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateCode, generateRef, hashCode, safeEqual } = require("../../lib/crypto");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

test("generateCode returns 8 characters from the unlock-code alphabet", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateCode();
    assert.equal(code.length, 8);
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), `unexpected char "${ch}" in code "${code}"`);
  }
});

test("generateCode excludes visually ambiguous characters (0, O, 1, I)", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateCode();
    assert.ok(!/[01OI]/.test(code), `code "${code}" contains an excluded character`);
  }
});

test("generateRef returns 6 characters from the order-ref alphabet", () => {
  for (let i = 0; i < 200; i++) {
    const ref = generateRef();
    assert.equal(ref.length, 6);
    for (const ch of ref) assert.ok(REF_ALPHABET.includes(ch), `unexpected char "${ch}" in ref "${ref}"`);
  }
});

test("generateCode/generateRef are not deterministic (basic randomness sanity check)", () => {
  const codes = new Set();
  for (let i = 0; i < 50; i++) codes.add(generateCode());
  // 50 draws from a 32^8 space landing on a duplicate would be astronomically
  // unlikely - a small set here would indicate a broken RNG, not bad luck.
  assert.equal(codes.size, 50);
});

test("hashCode is deterministic for the same normalized input", () => {
  assert.equal(hashCode("abc123"), hashCode("abc123"));
});

test("hashCode normalizes case and surrounding whitespace before hashing", () => {
  assert.equal(hashCode("  X7k2p9qa  "), hashCode("X7K2P9QA"));
});

test("hashCode produces different hashes for different codes", () => {
  assert.notEqual(hashCode("X7K2P9QA"), hashCode("X7K2P9QB"));
});

test("hashCode returns a 64-char hex sha256 digest", () => {
  assert.match(hashCode("X7K2P9QA"), /^[0-9a-f]{64}$/);
});

test("safeEqual returns true for identical strings", () => {
  assert.equal(safeEqual("X7K2P9QA", "X7K2P9QA"), true);
});

test("safeEqual returns false for different strings of the same length", () => {
  assert.equal(safeEqual("X7K2P9QA", "Y7K2P9QA"), false);
});

test("safeEqual returns false for different-length strings without throwing", () => {
  assert.equal(safeEqual("SHORT", "MUCHLONGERSTRING"), false);
});

test("safeEqual treats null/undefined as an empty string rather than throwing", () => {
  assert.equal(safeEqual(null, undefined), true);
  assert.equal(safeEqual(null, "X"), false);
});
