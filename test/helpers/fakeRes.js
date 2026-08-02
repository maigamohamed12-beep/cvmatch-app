// Minimal stand-in for Vercel's `res` object, matching the .status().json()
// chain every handler in this project uses.
function fakeRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (payload) {
    res.body = payload;
    return res;
  };
  return res;
}

module.exports = { fakeRes };
