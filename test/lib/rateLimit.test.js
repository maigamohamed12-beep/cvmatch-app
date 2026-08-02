const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mockModule, freshRequire } = require("../helpers/mockRequire");

const DB_PATH = require.resolve("../../lib/db");
const SENTRY_PATH = require.resolve("../../lib/sentry");
const RATELIMIT_PATH = require.resolve("../../lib/rateLimit");

function makeFakeSupabase({ count, countError, insertError, throwOnGetClient }) {
  if (throwOnGetClient) {
    return {
      getClient: () => {
        throw new Error("Supabase not configured");
      }
    };
  }
  return {
    getClient: () => ({
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          gte() { return Promise.resolve({ count: count ?? 0, error: countError || null }); },
          insert() { return Promise.resolve({ error: insertError || null }); }
        };
      }
    })
  };
}

function setup(fakeDb) {
  const restoreDb = mockModule(DB_PATH, fakeDb);
  const restoreSentry = mockModule(SENTRY_PATH, { reportError: async () => {} });
  const rateLimit = freshRequire(RATELIMIT_PATH);
  return {
    rateLimit,
    restore: () => { restoreDb(); restoreSentry(); }
  };
}

test("getClientIp reads the first address from x-forwarded-for", () => {
  const { rateLimit, restore } = setup(makeFakeSupabase({ count: 0 }));
  try {
    assert.equal(
      rateLimit.getClientIp({ headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" }, socket: {} }),
      "9.9.9.9"
    );
  } finally { restore(); }
});

test("getClientIp falls back to the socket's remote address", () => {
  const { rateLimit, restore } = setup(makeFakeSupabase({ count: 0 }));
  try {
    assert.equal(
      rateLimit.getClientIp({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }),
      "127.0.0.1"
    );
  } finally { restore(); }
});

test("getClientIp returns 'unknown' when nothing is available", () => {
  const { rateLimit, restore } = setup(makeFakeSupabase({ count: 0 }));
  try {
    assert.equal(rateLimit.getClientIp({ headers: {}, socket: {} }), "unknown");
  } finally { restore(); }
});

test("checkAndLogGeneration allows the request when under the daily cap", async () => {
  const { rateLimit, restore } = setup(makeFakeSupabase({ count: 5 }));
  try {
    const result = await rateLimit.checkAndLogGeneration("1.2.3.4");
    assert.deepEqual(result, { allowed: true });
  } finally { restore(); }
});

test("checkAndLogGeneration blocks the request once the cap is reached", async () => {
  const { rateLimit, restore } = setup(makeFakeSupabase({ count: 30 }));
  try {
    const result = await rateLimit.checkAndLogGeneration("1.2.3.4");
    assert.deepEqual(result, { allowed: false });
  } finally { restore(); }
});

test("checkAndLogGeneration blocks well above the cap too (not just exactly at it)", async () => {
  const { rateLimit, restore } = setup(makeFakeSupabase({ count: 999 }));
  try {
    const result = await rateLimit.checkAndLogGeneration("1.2.3.4");
    assert.deepEqual(result, { allowed: false });
  } finally { restore(); }
});

test("checkAndLogGeneration fails open when the count query errors", async () => {
  const { rateLimit, restore } = setup(makeFakeSupabase({ countError: { message: "db down" } }));
  try {
    const result = await rateLimit.checkAndLogGeneration("1.2.3.4");
    assert.deepEqual(result, { allowed: true });
  } finally { restore(); }
});

test("checkAndLogGeneration fails open when the insert fails (still allows this request)", async () => {
  const { rateLimit, restore } = setup(makeFakeSupabase({ count: 0, insertError: { message: "insert failed" } }));
  try {
    const result = await rateLimit.checkAndLogGeneration("1.2.3.4");
    assert.deepEqual(result, { allowed: true });
  } finally { restore(); }
});

test("checkAndLogGeneration fails open when getClient() itself throws (e.g. misconfigured Supabase)", async () => {
  const { rateLimit, restore } = setup(makeFakeSupabase({ throwOnGetClient: true }));
  try {
    const result = await rateLimit.checkAndLogGeneration("1.2.3.4");
    assert.deepEqual(result, { allowed: true });
  } finally { restore(); }
});
