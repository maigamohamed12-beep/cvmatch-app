const { getClient } = require("./db");
const { reportError } = require("./sentry");

// Generous on purpose: legitimate candidates rarely submit more than a
// handful of applications a day, and several people can share one public IP
// (mobile carrier NAT, cyber-café). This exists to stop scripted abuse of
// the free, unauthenticated /api/generate* endpoints, not to meter real use.
const WINDOW_HOURS = 24;
const MAX_PER_WINDOW = 30;

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

async function checkAndLogGeneration(ip) {
  // Fail open on any failure here (including getClient() throwing if
  // Supabase isn't configured): a rate-limit outage should degrade to "no
  // limit for now", not take down the whole generation feature.
  let supabase;
  try {
    supabase = getClient();
  } catch (err) {
    await reportError("rateLimit: getClient failed, allowing request", err, { ip });
    return { allowed: true };
  }

  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

  const { count, error } = await supabase
    .from("generation_log")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", since);

  if (error) {
    await reportError("rateLimit: generation_log count failed, allowing request", error, { ip });
    return { allowed: true };
  }
  if ((count || 0) >= MAX_PER_WINDOW) {
    return { allowed: false };
  }

  const { error: insertError } = await supabase.from("generation_log").insert({ ip });
  if (insertError) await reportError("rateLimit: generation_log insert failed", insertError, { ip });

  return { allowed: true };
}

module.exports = { getClientIp, checkAndLogGeneration };
