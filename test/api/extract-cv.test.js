const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mockModule, freshRequire } = require("../helpers/mockRequire");
const { fakeRes } = require("../helpers/fakeRes");

const SENTRY_PATH = require.resolve("../../lib/sentry");
const HANDLER_PATH = require.resolve("../../api/extract-cv");

const SAMPLE_PDF = fs.readFileSync(path.join(__dirname, "../fixtures/sample.pdf"));
const SAMPLE_DOCX = fs.readFileSync(path.join(__dirname, "../fixtures/sample.docx"));

function setup() {
  const reportedErrors = [];
  const restoreSentry = mockModule(SENTRY_PATH, {
    reportError: async (context, err, extra) => { reportedErrors.push({ context, err, extra }); }
  });
  const handler = freshRequire(HANDLER_PATH);
  return { handler, reportedErrors, restore: () => restoreSentry() };
}

test("rejects non-POST requests", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 405);
  } finally { restore(); }
});

test("rejects a request with no file data", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: {} }, res);
    assert.equal(res.statusCode, 400);
  } finally { restore(); }
});

test("rejects an empty file", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { filename: "x.pdf", dataBase64: "" } }, res);
    assert.equal(res.statusCode, 400);
  } finally { restore(); }
});

test("rejects a file over the 8MB cap", async () => {
  const { handler, restore } = setup();
  try {
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, 65).toString("base64");
    const res = fakeRes();
    await handler({ method: "POST", body: { filename: "x.pdf", dataBase64: oversized } }, res);
    assert.equal(res.statusCode, 413);
  } finally { restore(); }
});

test("rejects an unsupported format", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { filename: "x.txt", dataBase64: Buffer.from("hello").toString("base64") } }, res);
    assert.equal(res.statusCode, 400);
    assert.doesNotMatch(res.body.error, /doc \(Word/);
  } finally { restore(); }
});

test("gives a specific message for the legacy .doc format", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { filename: "x.doc", dataBase64: Buffer.from("hello").toString("base64") } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /doc \(Word/);
  } finally { restore(); }
});

test("extracts text from a real PDF", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { filename: "cv.pdf", mimeType: "application/pdf", dataBase64: SAMPLE_PDF.toString("base64") } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body.text, /Test Fixture CV/);
    assert.match(res.body.text, /Sample text for extraction tests/);
  } finally { restore(); }
});

test("strips the '-- N of M --' page marker pdf-parse adds", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { filename: "cv.pdf", mimeType: "application/pdf", dataBase64: SAMPLE_PDF.toString("base64") } }, res);
    assert.doesNotMatch(res.body.text, /-- 1 of 1 --/);
  } finally { restore(); }
});

test("extracts text from a real DOCX", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({
      method: "POST",
      body: { filename: "cv.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", dataBase64: SAMPLE_DOCX.toString("base64") }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body.text, /Walking on imported air/);
  } finally { restore(); }
});

test("detects PDF by extension even without the matching mimeType", async () => {
  const { handler, restore } = setup();
  try {
    const res = fakeRes();
    await handler({ method: "POST", body: { filename: "cv.pdf", dataBase64: SAMPLE_PDF.toString("base64") } }, res);
    assert.equal(res.statusCode, 200);
  } finally { restore(); }
});

test("reports and returns 422 for a corrupt/unparseable PDF", async () => {
  const { handler, reportedErrors, restore } = setup();
  try {
    const res = fakeRes();
    const garbage = Buffer.from("not a real pdf file at all").toString("base64");
    await handler({ method: "POST", body: { filename: "cv.pdf", mimeType: "application/pdf", dataBase64: garbage } }, res);
    assert.equal(res.statusCode, 422);
    assert.equal(reportedErrors.length, 1);
    assert.match(reportedErrors[0].context, /extract-cv parse error/);
  } finally { restore(); }
});
