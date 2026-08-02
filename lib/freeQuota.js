const { getClient } = require("./db");
const { reportError } = require("./sentry");

// Lifetime (not daily) free analyses per browser before /api/generate asks
// for payment. Deliberately small and deliberately soft: a visitor clearing
// site data or using a private window resets it - this is a conversion
// nudge for the median casual user, not an anti-abuse wall (that's
// lib/rateLimit.js's job, by IP, and stays in place regardless of this).
const FREE_ANALYSES_PER_DEVICE = 3;

async function checkFreeQuota(deviceId) {
  // No device id at all (e.g. a direct API call bypassing the browser)
  // shouldn't be silently exempted - but it also shouldn't crash the
  // request. Treat it as its own bucket rather than allowing it outright.
  const key = deviceId || "unknown";

  let supabase;
  try {
    supabase = getClient();
  } catch (err) {
    await reportError("freeQuota: getClient failed, allowing request", err, { deviceId: key });
    return { allowed: true };
  }

  const { count, error } = await supabase
    .from("free_quota_usage")
    .select("id", { count: "exact", head: true })
    .eq("device_id", key);

  if (error) {
    // Fail open: an outage here shouldn't block genuine free users either.
    await reportError("freeQuota: count failed, allowing request", error, { deviceId: key });
    return { allowed: true };
  }

  return { allowed: (count || 0) < FREE_ANALYSES_PER_DEVICE };
}

async function recordFreeUse(deviceId) {
  const key = deviceId || "unknown";
  let supabase;
  try {
    supabase = getClient();
  } catch (err) {
    await reportError("freeQuota: getClient failed while recording use", err, { deviceId: key });
    return;
  }
  const { error } = await supabase.from("free_quota_usage").insert({ device_id: key });
  if (error) await reportError("freeQuota: insert failed", error, { deviceId: key });
}

module.exports = { checkFreeQuota, recordFreeUse, FREE_ANALYSES_PER_DEVICE };
