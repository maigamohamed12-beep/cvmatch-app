const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mockModule, freshRequire } = require("../helpers/mockRequire");
const { fakeRes } = require("../helpers/fakeRes");
const { hashCode } = require("../../lib/crypto");

const DB_PATH = require.resolve("../../lib/db");
const SENTRY_PATH = require.resolve("../../lib/sentry");
const HANDLER_PATH = require.resolve("../../api/confirm-order");

function makeFakeSupabase({ lookupData, lookupError, updateError }) {
  const calls = { update: [] };
  const client = {
    from() {
      return {
        select() {
          return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: lookupData ?? null, error: lookupError || null }) }) };
        },
        update(payload) {
          calls.update.push(payload);
          return { eq: () => Promise.resolve({ error: updateError || null }) };
        }
      };
    }
  };
  return { client, calls };
}

function withAdminSecret(fn) {
  const previous = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = "test-secret";
  try { return fn(); } finally {
    if (previous === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previous;
  }
}

function setup(opts = {}) {
  const reportedErrors = [];
  const { client, calls } = makeFakeSupabase(opts);
  const restoreDb = mockModule(DB_PATH, { getClient: () => client });
  const restoreSentry = mockModule(SENTRY_PATH, {
    reportError: async (context, err, extra) => { reportedErrors.push({ context, err, extra }); }
  });
  const handler = freshRequire(HANDLER_PATH);
  return { handler, calls, reportedErrors, restore: () => { restoreDb(); restoreSentry(); } };
}

const AUTH_HEADERS = { authorization: "Bearer test-secret" };

test("rejects non-POST requests", async () => {
  const { handler, restore } = setup({});
  try {
    const res = fakeRes();
    await handler({ method: "GET", headers: {} }, res);
    assert.equal(res.statusCode, 405);
  } finally { restore(); }
});

test("rejects without a valid admin token", async () => {
  await withAdminSecret(async () => {
    const { handler, restore } = setup({});
    try {
      const res = fakeRes();
      await handler({ method: "POST", headers: {}, body: { ref: "ABC123" } }, res);
      assert.equal(res.statusCode, 401);
    } finally { restore(); }
  });
});

test("rejects a request missing the ref", async () => {
  await withAdminSecret(async () => {
    const { handler, restore } = setup({});
    try {
      const res = fakeRes();
      await handler({ method: "POST", headers: AUTH_HEADERS, body: {} }, res);
      assert.equal(res.statusCode, 400);
    } finally { restore(); }
  });
});

test("reports and returns 404 when the lookup errors", async () => {
  await withAdminSecret(async () => {
    const { handler, reportedErrors, restore } = setup({ lookupError: { message: "db down" } });
    try {
      const res = fakeRes();
      await handler({ method: "POST", headers: AUTH_HEADERS, body: { ref: "abc123" } }, res);
      assert.equal(res.statusCode, 404);
      assert.equal(reportedErrors.length, 1);
    } finally { restore(); }
  });
});

test("returns 404 for an unknown ref without reporting an error", async () => {
  await withAdminSecret(async () => {
    const { handler, reportedErrors, restore } = setup({ lookupData: null });
    try {
      const res = fakeRes();
      await handler({ method: "POST", headers: AUTH_HEADERS, body: { ref: "abc123" } }, res);
      assert.equal(res.statusCode, 404);
      assert.equal(reportedErrors.length, 0);
    } finally { restore(); }
  });
});

test("refuses to reconfirm an already-confirmed order", async () => {
  await withAdminSecret(async () => {
    const { handler, restore } = setup({ lookupData: { id: "1", ref: "ABC123", status: "confirmed", plan: "single" } });
    try {
      const res = fakeRes();
      await handler({ method: "POST", headers: AUTH_HEADERS, body: { ref: "abc123" } }, res);
      assert.equal(res.statusCode, 409);
    } finally { restore(); }
  });
});

test("confirms a pending 'single' order with a ~72h expiry and returns a matching code hash", async () => {
  await withAdminSecret(async () => {
    const { handler, calls, restore } = setup({ lookupData: { id: "order-1", ref: "ABC123", status: "pending", plan: "single" } });
    try {
      const res = fakeRes();
      const before = Date.now();
      await handler({ method: "POST", headers: AUTH_HEADERS, body: { ref: "abc123" } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.plan, "single");
      assert.equal(res.body.ref, "ABC123");
      assert.equal(calls.update.length, 1);
      assert.equal(calls.update[0].code_hash, hashCode(res.body.code));
      const expiresAt = new Date(calls.update[0].expires_at).getTime();
      const hoursFromNow = (expiresAt - before) / 3600000;
      assert.ok(hoursFromNow > 71.9 && hoursFromNow < 72.1, `expected ~72h, got ${hoursFromNow}h`);
    } finally { restore(); }
  });
});

test("confirms a pending 'monthly' order with a ~30 day expiry", async () => {
  await withAdminSecret(async () => {
    const { handler, calls, restore } = setup({ lookupData: { id: "order-1", ref: "XYZ999", status: "pending", plan: "monthly" } });
    try {
      const res = fakeRes();
      const before = Date.now();
      await handler({ method: "POST", headers: AUTH_HEADERS, body: { ref: "xyz999" } }, res);
      assert.equal(res.statusCode, 200);
      const expiresAt = new Date(calls.update[0].expires_at).getTime();
      const daysFromNow = (expiresAt - before) / 86400000;
      assert.ok(daysFromNow > 29.9 && daysFromNow < 30.1, `expected ~30 days, got ${daysFromNow} days`);
    } finally { restore(); }
  });
});

test("reports and returns 500 when the update fails", async () => {
  await withAdminSecret(async () => {
    const { handler, reportedErrors, restore } = setup({
      lookupData: { id: "order-1", ref: "ABC123", status: "pending", plan: "single" },
      updateError: { message: "update failed" }
    });
    try {
      const res = fakeRes();
      await handler({ method: "POST", headers: AUTH_HEADERS, body: { ref: "abc123" } }, res);
      assert.equal(res.statusCode, 500);
      assert.equal(reportedErrors.length, 1);
    } finally { restore(); }
  });
});
