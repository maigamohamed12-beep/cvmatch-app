const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mockModule, freshRequire } = require("../helpers/mockRequire");
const { fakeRes } = require("../helpers/fakeRes");

const DB_PATH = require.resolve("../../lib/db");
const SENTRY_PATH = require.resolve("../../lib/sentry");
const HANDLER_PATH = require.resolve("../../api/list-orders");

function setup({ data, error } = {}) {
  const reportedErrors = [];
  const client = {
    from() {
      return {
        select() { return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: data ?? null, error: error || null }); }
      };
    }
  };
  const restoreDb = mockModule(DB_PATH, { getClient: () => client });
  const restoreSentry = mockModule(SENTRY_PATH, {
    reportError: async (context, err) => { reportedErrors.push({ context, err }); }
  });
  const handler = freshRequire(HANDLER_PATH);
  return { handler, reportedErrors, restore: () => { restoreDb(); restoreSentry(); } };
}

function withAdminSecret(fn) {
  const previous = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = "test-secret";
  try { return fn(); } finally {
    if (previous === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previous;
  }
}

const AUTH_HEADERS = { authorization: "Bearer test-secret" };

test("rejects non-GET requests", async () => {
  const { handler, restore } = setup({});
  try {
    const res = fakeRes();
    await handler({ method: "POST", headers: {} }, res);
    assert.equal(res.statusCode, 405);
  } finally { restore(); }
});

test("rejects without a valid admin token", async () => {
  await withAdminSecret(async () => {
    const { handler, restore } = setup({});
    try {
      const res = fakeRes();
      await handler({ method: "GET", headers: {} }, res);
      assert.equal(res.statusCode, 401);
    } finally { restore(); }
  });
});

test("returns the order list when authorized", async () => {
  await withAdminSecret(async () => {
    const orders = [{ id: "1", ref: "ABC123", status: "confirmed" }];
    const { handler, restore } = setup({ data: orders });
    try {
      const res = fakeRes();
      await handler({ method: "GET", headers: AUTH_HEADERS }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.orders, orders);
    } finally { restore(); }
  });
});

test("reports and returns 500 when the query fails", async () => {
  await withAdminSecret(async () => {
    const { handler, reportedErrors, restore } = setup({ error: { message: "db down" } });
    try {
      const res = fakeRes();
      await handler({ method: "GET", headers: AUTH_HEADERS }, res);
      assert.equal(res.statusCode, 500);
      assert.equal(reportedErrors.length, 1);
    } finally { restore(); }
  });
});
