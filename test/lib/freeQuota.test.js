const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mockModule, freshRequire } = require("../helpers/mockRequire");

const DB_PATH = require.resolve("../../lib/db");
const SENTRY_PATH = require.resolve("../../lib/sentry");
const FREEQUOTA_PATH = require.resolve("../../lib/freeQuota");

function setup(opts = {}) {
  const calls = { insert: [] };
  let fakeDb;
  if (opts.throwOnGetClient) {
    fakeDb = { getClient: () => { throw new Error("Supabase not configured"); } };
  } else {
    const client = {
      from() {
        return {
          select() { return { eq: () => Promise.resolve({ count: opts.count ?? 0, error: opts.countError || null }) }; },
          insert(payload) { calls.insert.push(payload); return Promise.resolve({ error: opts.insertError || null }); }
        };
      }
    };
    fakeDb = { getClient: () => client };
  }
  const restoreDb = mockModule(DB_PATH, fakeDb);
  const restoreSentry = mockModule(SENTRY_PATH, { reportError: async () => {} });
  const freeQuota = freshRequire(FREEQUOTA_PATH);
  return { freeQuota, calls, restore: () => { restoreDb(); restoreSentry(); } };
}

test("FREE_ANALYSES_PER_DEVICE is 3", () => {
  const { freeQuota, restore } = setup({ count: 0 });
  try {
    assert.equal(freeQuota.FREE_ANALYSES_PER_DEVICE, 3);
  } finally { restore(); }
});

test("checkFreeQuota allows under the cap", async () => {
  const { freeQuota, restore } = setup({ count: 2 });
  try {
    assert.deepEqual(await freeQuota.checkFreeQuota("device-1"), { allowed: true });
  } finally { restore(); }
});

test("checkFreeQuota blocks once the cap (3) is reached", async () => {
  const { freeQuota, restore } = setup({ count: 3 });
  try {
    assert.deepEqual(await freeQuota.checkFreeQuota("device-1"), { allowed: false });
  } finally { restore(); }
});

test("checkFreeQuota fails open when the count query errors", async () => {
  const { freeQuota, restore } = setup({ countError: { message: "db down" } });
  try {
    assert.deepEqual(await freeQuota.checkFreeQuota("device-1"), { allowed: true });
  } finally { restore(); }
});

test("checkFreeQuota fails open when getClient() throws", async () => {
  const { freeQuota, restore } = setup({ throwOnGetClient: true });
  try {
    assert.deepEqual(await freeQuota.checkFreeQuota("device-1"), { allowed: true });
  } finally { restore(); }
});

test("checkFreeQuota treats a missing deviceId as its own 'unknown' bucket, not an automatic pass", async () => {
  const { freeQuota, restore } = setup({ count: 3 });
  try {
    assert.deepEqual(await freeQuota.checkFreeQuota(undefined), { allowed: false });
  } finally { restore(); }
});

test("recordFreeUse inserts a row for the device", async () => {
  const { freeQuota, calls, restore } = setup({ count: 0 });
  try {
    await freeQuota.recordFreeUse("device-1");
    assert.equal(calls.insert.length, 1);
    assert.equal(calls.insert[0].device_id, "device-1");
  } finally { restore(); }
});

test("recordFreeUse doesn't throw when the insert fails", async () => {
  const { freeQuota, restore } = setup({ insertError: { message: "insert failed" } });
  try {
    await assert.doesNotReject(() => freeQuota.recordFreeUse("device-1"));
  } finally { restore(); }
});
