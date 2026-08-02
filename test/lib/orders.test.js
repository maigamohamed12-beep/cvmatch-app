const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mockModule, freshRequire } = require("../helpers/mockRequire");
const { hashCode } = require("../../lib/crypto");

const DB_PATH = require.resolve("../../lib/db");
const SENTRY_PATH = require.resolve("../../lib/sentry");
const ORDERS_PATH = require.resolve("../../lib/orders");

function setup({ lookupData, lookupError, throwOnGetClient } = {}) {
  const reportedErrors = [];
  const fakeDb = throwOnGetClient
    ? { getClient: () => { throw new Error("Supabase not configured"); } }
    : {
        getClient: () => ({
          from() {
            return { select() { return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: lookupData ?? null, error: lookupError || null }) }) }; } }
          }
        })
      };
  const restoreDb = mockModule(DB_PATH, fakeDb);
  const restoreSentry = mockModule(SENTRY_PATH, {
    reportError: async (context, err, extra) => { reportedErrors.push({ context, err, extra }); }
  });
  const { isOrderUnlocked } = freshRequire(ORDERS_PATH);
  return { isOrderUnlocked, reportedErrors, restore: () => { restoreDb(); restoreSentry(); } };
}

test("isOrderUnlocked returns false without an orderId or code", async () => {
  const { isOrderUnlocked, restore } = setup({});
  try {
    assert.equal(await isOrderUnlocked(null, "X7K2P9QA"), false);
    assert.equal(await isOrderUnlocked("order-1", null), false);
  } finally { restore(); }
});

test("isOrderUnlocked returns false for an unknown order", async () => {
  const { isOrderUnlocked, restore } = setup({ lookupData: null });
  try {
    assert.equal(await isOrderUnlocked("order-1", "X7K2P9QA"), false);
  } finally { restore(); }
});

test("isOrderUnlocked returns false for a pending (unpaid) order", async () => {
  const { isOrderUnlocked, restore } = setup({ lookupData: { status: "pending", expires_at: null, code_hash: hashCode("X7K2P9QA") } });
  try {
    assert.equal(await isOrderUnlocked("order-1", "X7K2P9QA"), false);
  } finally { restore(); }
});

test("isOrderUnlocked returns false for an expired order", async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const { isOrderUnlocked, restore } = setup({ lookupData: { status: "confirmed", expires_at: past, code_hash: hashCode("X7K2P9QA") } });
  try {
    assert.equal(await isOrderUnlocked("order-1", "X7K2P9QA"), false);
  } finally { restore(); }
});

test("isOrderUnlocked returns false for the wrong code", async () => {
  const { isOrderUnlocked, restore } = setup({ lookupData: { status: "confirmed", expires_at: null, code_hash: hashCode("X7K2P9QA") } });
  try {
    assert.equal(await isOrderUnlocked("order-1", "WRONGCODE"), false);
  } finally { restore(); }
});

test("isOrderUnlocked returns true for a confirmed, non-expired order with the right code", async () => {
  const future = new Date(Date.now() + 3600 * 1000).toISOString();
  const { isOrderUnlocked, restore } = setup({ lookupData: { status: "confirmed", expires_at: future, code_hash: hashCode("X7K2P9QA") } });
  try {
    assert.equal(await isOrderUnlocked("order-1", "x7k2p9qa"), true);
  } finally { restore(); }
});

test("isOrderUnlocked returns true for a confirmed order with no expiry set", async () => {
  const { isOrderUnlocked, restore } = setup({ lookupData: { status: "confirmed", expires_at: null, code_hash: hashCode("X7K2P9QA") } });
  try {
    assert.equal(await isOrderUnlocked("order-1", "X7K2P9QA"), true);
  } finally { restore(); }
});

test("reports and returns false (fails closed) when the lookup errors", async () => {
  const { isOrderUnlocked, reportedErrors, restore } = setup({ lookupError: { message: "db down" } });
  try {
    assert.equal(await isOrderUnlocked("order-1", "X7K2P9QA"), false);
    assert.equal(reportedErrors.length, 1);
    assert.match(reportedErrors[0].context, /lookup failed/);
  } finally { restore(); }
});

test("reports and returns false (fails closed) when getClient() throws", async () => {
  const { isOrderUnlocked, reportedErrors, restore } = setup({ throwOnGetClient: true });
  try {
    assert.equal(await isOrderUnlocked("order-1", "X7K2P9QA"), false);
    assert.equal(reportedErrors.length, 1);
    assert.match(reportedErrors[0].context, /getClient failed/);
  } finally { restore(); }
});
