const { getClient } = require("../lib/db");
const { generateRef } = require("../lib/crypto");
const { reportError } = require("../lib/sentry");

const PLANS = new Set(["single", "monthly"]);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { plan } = req.body || {};
  if (!PLANS.has(plan)) return res.status(400).json({ error: "Formule invalide." });

  const supabase = getClient();

  let ref = null;
  for (let attempt = 0; attempt < 5 && !ref; attempt++) {
    const candidate = generateRef();
    const { data: existing, error: lookupError } = await supabase
      .from("orders")
      .select("id")
      .eq("ref", candidate)
      .maybeSingle();
    if (lookupError) {
      await reportError("create-order: ref lookup failed", lookupError, { plan });
      return res.status(500).json({ error: "Erreur serveur, réessayez." });
    }
    if (!existing) ref = candidate;
  }
  if (!ref) return res.status(500).json({ error: "Impossible de générer une référence, réessayez." });

  const { data, error } = await supabase
    .from("orders")
    .insert({ plan, ref, status: "pending" })
    .select("id, ref")
    .single();

  if (error) {
    await reportError("create-order: insert failed", error, { plan, ref });
    return res.status(500).json({ error: "Erreur serveur, réessayez." });
  }
  res.status(200).json({ orderId: data.id, ref: data.ref });
};
