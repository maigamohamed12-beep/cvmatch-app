const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mockModule, freshRequire } = require("../helpers/mockRequire");
const { fakeRes } = require("../helpers/fakeRes");

const DB_PATH = require.resolve("../../lib/db");
const SENTRY_PATH = require.resolve("../../lib/sentry");
const HANDLER_PATH = require.resolve("../../api/create-order");

function makeFakeSupabase({ collideCount = 0, lookupError, insertError, insertData }) {
  let selectCalls = 0;
  const calls = { insert: [] };
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () => {
                  selectCalls++;
                  if (lookupError) return Promise.resolve({ data: null, error: lookupError });
                  const collided = selectCalls <= collideCount;
                  return Promise.resolve({ data: collided ? { id: "existing" } : null, error: null });
                }
              };
            }
          };
        },
        insert(payload) {
          calls.insert.push(payload);
          return {
            select() {
              return { single: () => Promise.resolve({ data: insertData, error: insertError || null }) };
            }
          };
        }
      };
    }
  };
  return { client, calls, getSelectCalls: () => selectCalls };
}

function setup(opts = {}) {
  const reportedErrors = [];
  const { client, calls, getSelectCalls } = makeFakeSupabase(opts);
  const restoreDb = mockModule(DB_PATH, { getClient: () => client });
  const restoreSentry = mockModule(SENTRY_PATH, {
    reportError: async (context, err, extra) => { reportedErrors.push({ context, err, extra }); }
  });
  const handler = freshRequire(HANDLER_PATH);
  return { handler, calls, getSelectCalls, reportedErrors, restore: () => { restoreDb(); restoreSentry(); } };
}

test("rejects non-POST requests", async () => {
  const { handler, restore } = setup({});
  try {
    const res = fakeRes();
    await handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 405);
  } finally { restore(); }
});

test("rejects an invalid plan", async () => {
  const { handler, restore } = setup({});
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { plan: "free" } }, res);
    assert.equal(res.statusCode, 400);
  } finally { restore(); }
});

test("creates an order and returns its id and ref on the first try", async () => {
  const { handler, calls, restore } = setup({ collideCount: 0, insertData: { id: "order-1", ref: "ABC123" } });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { plan: "single" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.orderId, "order-1");
    assert.equal(res.body.ref, "ABC123");
    assert.equal(calls.insert.length, 1);
    assert.equal(calls.insert[0].plan, "single");
    assert.equal(calls.insert[0].status, "pending");
  } finally { restore(); }
});

test("retries the ref lookup on a collision until it finds a free one", async () => {
  const { handler, getSelectCalls, restore } = setup({ collideCount: 3, insertData: { id: "order-1", ref: "XYZ999" } });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { plan: "monthly" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(getSelectCalls(), 4, "should collide 3 times then succeed on the 4th");
  } finally { restore(); }
});

test("gives up after 5 collisions without ever inserting", async () => {
  const { handler, calls, restore } = setup({ collideCount: 999 });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { plan: "single" } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(calls.insert.length, 0);
  } finally { restore(); }
});

test("reports and returns 500 when the ref lookup errors", async () => {
  const { handler, reportedErrors, restore } = setup({ lookupError: { message: "db down" } });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { plan: "single" } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(reportedErrors.length, 1);
    assert.match(reportedErrors[0].context, /ref lookup failed/);
  } finally { restore(); }
});

test("reports and returns 500 when the insert fails", async () => {
  const { handler, reportedErrors, restore } = setup({ insertError: { message: "insert failed" } });
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { plan: "single" } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(reportedErrors.length, 1);
    assert.match(reportedErrors[0].context, /insert failed/);
  } finally { restore(); }
});
