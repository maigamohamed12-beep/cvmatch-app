const { getClient } = require("./db");
const { hashCode, safeEqual } = require("./crypto");
const { reportError } = require("./sentry");

// Read-only check: is this orderId/code combination a currently-valid
// unlock? Deliberately doesn't touch the attempts counter (that's
// /api/verify-code's job, for actual login attempts) - this just answers
// "should this visitor be treated as a paying customer right now", e.g. to
// exempt them from the free-analysis quota in /api/generate.
async function isOrderUnlocked(orderId, code) {
  if (!orderId || !code) return false;

  let supabase;
  try {
    supabase = getClient();
  } catch (err) {
    // Fail closed on trust (treat as not-unlocked, same as a wrong code)
    // rather than letting a Supabase outage crash /api/generate outright.
    await reportError("orders: getClient failed", err, { orderId });
    return false;
  }
  const { data: order, error } = await supabase
    .from("orders")
    .select("status, expires_at, code_hash")
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    await reportError("orders: lookup failed", error, { orderId });
    return false;
  }
  if (!order) return false;
  if (order.status !== "confirmed") return false;
  if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) return false;

  return safeEqual(hashCode(code), order.code_hash || "");
}

module.exports = { isOrderUnlocked };
