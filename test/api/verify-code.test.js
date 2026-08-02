const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mockModule, freshRequire } = require("../helpers/mockRequire");
const { fakeRes } = require("../helpers/fakeRes");

const DB_PATH = require.resolve("../../lib/db");
const SENTRY_PATH = require.resolve("../../lib/sentry");
const HANDLER_PATH = require.resolve("../../api/verify-code");
const { hashCode } = require("../../lib/crypto");

function makeFakeSupabase({ lookupData, lookupError, rpcError }) {
  const calls = { rpc: [], update: [] };
  const client = {
    from(table) {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: () => Promise.resolve({ data: lookupData ?? null, error: lookupError || null }) };
            }
          };
        },
        update(payload) {
          calls.update.push({ table, payload });
          return { eq: () => Promise.resolve({ error: null }) };
        }
      };
    },
    rpc(name, args) {
      calls.rpc.push({ name, args });
      return Promise.resolve({ error: rpcError || null });
    }
  };
  return { client, calls };
}

function setup({ lookupData, lookupError, rpcError } = {}) {
  const reportedErrors = [];
  const { client, calls } = makeFakeSupabase({ lookupData, lookupError, rpcError });
  const restoreDb = mockModule(DB_PATH, { getClient: () => client });
  const restoreSentry = mockModule(SENTRY_PATH, {
    reportError: async (context, err, extra) => { reportedErrors.push({ context, err, extra }); }
  });
  const handler = freshRequire(HANDLER_PATH);
  return {
    handler,
    calls,
    reportedErrors,
    restore: () => { restoreDb(); restoreSentry(); }
  };
}

test("rejects non-POST requests", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 405);
  } finally { restore(); }
});

test("rejects a request missing orderId or code", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { orderId: "abc" } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
  } finally { restore(); }
});

test("reports and returns not-found when the lookup itself errors", async () => {
  const { handler, reportedErrors, restore } = setup({ lookupError: { message: "db down" } });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { orderId: "abc", code: "X7K2P9QA" } }, res);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.message, "Commande introuvable.");
    assert.equal(reportedErrors.length, 1);
    assert.match(reportedErrors[0].context, /order lookup failed/);
  } finally { restore(); }
});

test("returns not-found for a genuinely missing order, without reporting an error", async () => {
  const { handler, reportedErrors, restore } = setup({ lookupData: null });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { orderId: "abc", code: "X7K2P9QA" } }, res);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.message, "Commande introuvable.");
    assert.equal(reportedErrors.length, 0);
  } finally { restore(); }
});

test("refuses an order that hasn't been confirmed yet", async () => {
  const { handler, restore } = setup({ lookupData: { id: "1", status: "pending", attempts: 0 } });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { orderId: "1", code: "X7K2P9QA" } }, res);
    assert.equal(res.body.ok, false);
    assert.match(res.body.message, /pas encore confirmé/);
  } finally { restore(); }
});

test("refuses an expired code", async () => {
  const past = new Date(Date.now() - 3600 * 1000).toISOString();
  const { handler, restore } = setup({
    lookupData: { id: "1", status: "confirmed", attempts: 0, expires_at: past, code_hash: hashCode("X7K2P9QA") }
  });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { orderId: "1", code: "X7K2P9QA" } }, res);
    assert.equal(res.body.ok, false);
    assert.match(res.body.message, /expiré/);
  } finally { restore(); }
});

test("refuses once MAX_ATTEMPTS is reached, even with the correct code", async () => {
  const { handler, restore } = setup({
    lookupData: { id: "1", status: "confirmed", attempts: 10, expires_at: null, code_hash: hashCode("X7K2P9QA") }
  });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { orderId: "1", code: "X7K2P9QA" } }, res);
    assert.equal(res.body.ok, false);
    assert.match(res.body.message, /Trop de tentatives/);
  } finally { restore(); }
});

test("rejects a wrong code and calls the atomic increment RPC with the order id", async () => {
  const { handler, calls, restore } = setup({
    lookupData: { id: "order-1", status: "confirmed", attempts: 3, expires_at: null, code_hash: hashCode("X7K2P9QA") }
  });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { orderId: "order-1", code: "WRONGCODE" } }, res);
    assert.equal(res.body.ok, false);
    assert.match(res.body.message, /Code invalide/);
    assert.equal(calls.rpc.length, 1);
    assert.equal(calls.rpc[0].name, "increment_order_attempts");
    assert.equal(calls.rpc[0].args.p_order_id, "order-1");
    assert.equal(calls.update.length, 0, "should not need the non-atomic fallback when the RPC succeeds");
  } finally { restore(); }
});

test("falls back to a non-atomic update and reports the error when the RPC fails", async () => {
  const { handler, calls, reportedErrors, restore } = setup({
    lookupData: { id: "order-1", status: "confirmed", attempts: 3, expires_at: null, code_hash: hashCode("X7K2P9QA") },
    rpcError: { message: "function does not exist" }
  });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { orderId: "order-1", code: "WRONGCODE" } }, res);
    assert.equal(res.body.ok, false);
    assert.equal(calls.update.length, 1, "should fall back to updating attempts directly");
    assert.equal(calls.update[0].payload.attempts, 4);
    assert.equal(reportedErrors.length, 1);
    assert.match(reportedErrors[0].context, /increment_order_attempts RPC failed/);
  } finally { restore(); }
});

test("unlocks with the correct code and returns the plan", async () => {
  const { handler, calls, restore } = setup({
    lookupData: { id: "order-1", status: "confirmed", attempts: 2, expires_at: null, code_hash: hashCode("X7K2P9QA"), plan: "monthly" }
  });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { orderId: "order-1", code: "x7k2p9qa" } }, res);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.plan, "monthly");
    assert.equal(calls.rpc.length, 0, "a correct code shouldn't touch the attempts counter at all");
  } finally { restore(); }
});
