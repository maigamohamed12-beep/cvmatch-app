const { test } = require("node:test");
const assert = require("node:assert/strict");
const { freshRequire } = require("../helpers/mockRequire");

const AUTH_PATH = require.resolve("../../lib/auth");

function withAdminSecret(value, fn) {
  const previous = process.env.ADMIN_SECRET;
  if (value === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previous;
  }
}

test("isAdminAuthorized returns false when ADMIN_SECRET isn't configured", () => {
  withAdminSecret(undefined, () => {
    const { isAdminAuthorized } = freshRequire(AUTH_PATH);
    assert.equal(isAdminAuthorized({ headers: { authorization: "Bearer anything" } }), false);
  });
});

test("isAdminAuthorized returns false with no Authorization header", () => {
  withAdminSecret("s3cret", () => {
    const { isAdminAuthorized } = freshRequire(AUTH_PATH);
    assert.equal(isAdminAuthorized({ headers: {} }), false);
  });
});

test("isAdminAuthorized returns false for a non-Bearer scheme", () => {
  withAdminSecret("s3cret", () => {
    const { isAdminAuthorized } = freshRequire(AUTH_PATH);
    assert.equal(isAdminAuthorized({ headers: { authorization: "Basic s3cret" } }), false);
  });
});

test("isAdminAuthorized returns false for an empty Bearer token", () => {
  withAdminSecret("s3cret", () => {
    const { isAdminAuthorized } = freshRequire(AUTH_PATH);
    assert.equal(isAdminAuthorized({ headers: { authorization: "Bearer " } }), false);
  });
});

test("isAdminAuthorized returns false for a wrong token", () => {
  withAdminSecret("s3cret", () => {
    const { isAdminAuthorized } = freshRequire(AUTH_PATH);
    assert.equal(isAdminAuthorized({ headers: { authorization: "Bearer wrong-token" } }), false);
  });
});

test("isAdminAuthorized returns true for the correct token", () => {
  withAdminSecret("s3cret", () => {
    const { isAdminAuthorized } = freshRequire(AUTH_PATH);
    assert.equal(isAdminAuthorized({ headers: { authorization: "Bearer s3cret" } }), true);
  });
});

test("isAdminAuthorized trims surrounding whitespace from the token", () => {
  withAdminSecret("s3cret", () => {
    const { isAdminAuthorized } = freshRequire(AUTH_PATH);
    assert.equal(isAdminAuthorized({ headers: { authorization: "Bearer  s3cret  " } }), true);
  });
});
