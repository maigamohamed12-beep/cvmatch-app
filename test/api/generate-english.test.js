const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mockModule, freshRequire } = require("../helpers/mockRequire");
const { fakeRes } = require("../helpers/fakeRes");

const ANTHROPIC_PATH = require.resolve("@anthropic-ai/sdk");
const RATELIMIT_PATH = require.resolve("../../lib/rateLimit");
const SENTRY_PATH = require.resolve("../../lib/sentry");
const HANDLER_PATH = require.resolve("../../api/generate-english");

const VALID_RESULT = {
  candidateName: "Awa Traoré", targetRole: "Developer", contactLine: "", summary: "ok",
  skills: [], experience: [], education: [], languages: [],
  letterIntro: "", letterBody: [], letterClosing: ""
};

function makeFakeAnthropicModule({ createImpl }) {
  function FakeAnthropic() {
    this.messages = { create: createImpl || (async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(VALID_RESULT) }] })) };
  }
  return FakeAnthropic;
}

function setup({ createImpl, allowed = true, noApiKey = false } = {}) {
  const reportedErrors = [];
  const previousKey = process.env.ANTHROPIC_API_KEY;
  if (noApiKey) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = "sk-ant-test";

  const restoreAnthropic = mockModule(ANTHROPIC_PATH, makeFakeAnthropicModule({ createImpl }));
  const restoreRateLimit = mockModule(RATELIMIT_PATH, {
    getClientIp: () => "1.2.3.4",
    checkAndLogGeneration: async () => ({ allowed })
  });
  const restoreSentry = mockModule(SENTRY_PATH, {
    reportError: async (context, err, extra) => { reportedErrors.push({ context, err, extra }); }
  });
  const handler = freshRequire(HANDLER_PATH);
  return {
    handler, reportedErrors,
    restore: () => {
      restoreAnthropic(); restoreRateLimit(); restoreSentry();
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  };
}

const VALID_BODY = { cvText: "some cv text", offerText: "some offer text" };

test("rejects non-POST requests", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "GET", headers: {}, socket: {} }, res);
    assert.equal(res.statusCode, 405);
  } finally { restore(); }
});

test("rejects a request missing cvText or offerText", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, socket: {}, body: { offerText: "only offer" } }, res);
    assert.equal(res.statusCode, 400);
  } finally { restore(); }
});

test("rejects text over the 20,000 character cap", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    const huge = "a".repeat(20001);
    await handler({ method: "POST", headers: {}, socket: {}, body: { cvText: "x", offerText: huge } }, res);
    assert.equal(res.statusCode, 413);
  } finally { restore(); }
});

test("blocks the request when the per-IP rate limit is exceeded", async () => {
  const { handler, restore } = setup({ allowed: false });
  try {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, socket: {}, body: VALID_BODY }, res);
    assert.equal(res.statusCode, 429);
  } finally { restore(); }
});

test("reports and returns 500 when the Anthropic client can't be created (no API key)", async () => {
  const { handler, reportedErrors, restore } = setup({ noApiKey: true });
  try {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, socket: {}, body: VALID_BODY }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(reportedErrors.length, 1);
  } finally { restore(); }
});

test("reports and returns 502 when the Anthropic API call throws", async () => {
  const { handler, reportedErrors, restore } = setup({
    createImpl: async () => { throw new Error("network error"); }
  });
  try {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, socket: {}, body: VALID_BODY }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(reportedErrors.length, 1);
  } finally { restore(); }
});

test("returns 422 when Claude refuses the request", async () => {
  const { handler, restore } = setup({
    createImpl: async () => ({ stop_reason: "refusal", content: [] })
  });
  try {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, socket: {}, body: VALID_BODY }, res);
    assert.equal(res.statusCode, 422);
  } finally { restore(); }
});

test("reports and returns 502 when the response is truncated at max_tokens", async () => {
  const { handler, reportedErrors, restore } = setup({
    createImpl: async () => ({ stop_reason: "max_tokens", usage: { output_tokens: 6000 } })
  });
  try {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, socket: {}, body: VALID_BODY }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(reportedErrors.length, 1);
  } finally { restore(); }
});

test("reports and returns 502 when the response has no text block", async () => {
  const { handler, reportedErrors, restore } = setup({
    createImpl: async () => ({ stop_reason: "end_turn", content: [{ type: "image" }] })
  });
  try {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, socket: {}, body: VALID_BODY }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(reportedErrors.length, 1);
  } finally { restore(); }
});

test("reports and returns 502 when the text block isn't valid JSON", async () => {
  const { handler, reportedErrors, restore } = setup({
    createImpl: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] })
  });
  try {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, socket: {}, body: VALID_BODY }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(reportedErrors.length, 1);
  } finally { restore(); }
});

test("returns the parsed result on success", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "POST", headers: {}, socket: {}, body: VALID_BODY }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.result, VALID_RESULT);
  } finally { restore(); }
});
