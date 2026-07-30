const { safeEqual } = require("./crypto");

// Shared-secret check for the /admin dashboard's API calls. The secret lives only
// in the ADMIN_SECRET environment variable on the server — it is never sent to the
// browser except as the value the owner themselves types into the admin login form.
function isAdminAuthorized(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const header = req.headers["authorization"] || "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const token = header.slice(prefix.length).trim();
  if (!token) return false;
  return safeEqual(token, secret);
}

module.exports = { isAdminAuthorized };
