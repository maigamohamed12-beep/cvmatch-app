const { getClient } = require("../lib/db");
const { generateCode, hashCode } = require("../lib/crypto");
const { isAdminAuthorized } = require("../lib/auth");

// How long an unlock stays valid once the owner confirms a real payment.
const VALIDITY = {
  single: { hours: 72 },
  monthly: { days: 30 }
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isAdminAuthorized(req)) return res.status(401).json({ error: "Non autorisé." });

  const { ref } = req.body || {};
  if (!ref) return res.status(400).json({ error: "Référence manquante." });

  const supabase = getClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("ref", String(ref).toUpperCase())
    .maybeSingle();

  if (error || !order) return res.status(404).json({ error: "Commande introuvable." });
  if (order.status === "confirmed") return res.status(409).json({ error: "Cette commande est déjà confirmée." });

  const code = generateCode();
  const codeHash = hashCode(code);
  const now = new Date();
  const rule = VALIDITY[order.plan] || {};
  let expiresAt = null;
  if (rule.hours) expiresAt = new Date(now.getTime() + rule.hours * 3600 * 1000);
  if (rule.days) expiresAt = new Date(now.getTime() + rule.days * 86400 * 1000);

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: "confirmed",
      confirmed_at: now.toISOString(),
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      code_hash: codeHash
    })
    .eq("id", order.id);

  if (updateError) return res.status(500).json({ error: "Erreur serveur." });

  // The plaintext code is returned exactly once — only the hash is ever stored.
  res.status(200).json({ code, plan: order.plan, ref: order.ref });
};
