const { getClient } = require("./db");

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
  const supabase = getClient();
  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

  const { count, error } = await supabase
    .from("generation_log")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", since);

  if (error) {
    // Fail open: a rate-limit outage shouldn't take the whole feature down.
    console.error("generation_log count failed, allowing request", error);
    return { allowed: true };
  }
  if ((count || 0) >= MAX_PER_WINDOW) {
    return { allowed: false };
  }

  const { error: insertError } = await supabase.from("generation_log").insert({ ip });
  if (insertError) console.error("generation_log insert failed", insertError);

  return { allowed: true };
}

module.exports = { getClientIp, checkAndLogGeneration };
