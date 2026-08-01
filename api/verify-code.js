const { getClient } = require("../lib/db");
const { hashCode, safeEqual } = require("../lib/crypto");

const MAX_ATTEMPTS = 10;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { orderId, code } = req.body || {};
  if (!orderId || !code) return res.status(400).json({ ok: false, message: "Requête invalide." });

  const supabase = getClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    return res.status(200).json({ ok: false, message: "Commande introuvable." });
  }
  if (order.status !== "confirmed") {
    return res.status(200).json({ ok: false, message: "Paiement pas encore confirmé. Contactez-nous sur WhatsApp." });
  }
  if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
    return res.status(200).json({ ok: false, message: "Ce code a expiré. Contactez-nous sur WhatsApp." });
  }
  if (order.attempts >= MAX_ATTEMPTS) {
    return res.status(200).json({ ok: false, message: "Trop de tentatives. Contactez-nous sur WhatsApp." });
  }

  const isValid = safeEqual(hashCode(code), order.code_hash || "");

  if (!isValid) {
    // Atomic increment (see supabase/schema.sql) so concurrent guesses against
    // the same order can't all read the same starting count and all slip
    // past MAX_ATTEMPTS before any of them lands.
    const { error: incrementError } = await supabase.rpc("increment_order_attempts", { p_order_id: order.id });
    if (incrementError) {
      console.error("increment_order_attempts RPC failed, falling back to non-atomic update", incrementError);
      await supabase.from("orders").update({ attempts: order.attempts + 1 }).eq("id", order.id);
    }
    return res.status(200).json({ ok: false, message: "Code invalide. Vérifiez le code reçu par WhatsApp." });
  }

  res.status(200).json({ ok: true, plan: order.plan });
};
