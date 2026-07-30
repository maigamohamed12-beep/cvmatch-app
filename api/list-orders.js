const { getClient } = require("../lib/db");
const { isAdminAuthorized } = require("../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isAdminAuthorized(req)) return res.status(401).json({ error: "Non autorisé." });

  const supabase = getClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, ref, plan, status, created_at, confirmed_at, expires_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: "Erreur serveur." });
  res.status(200).json({ orders: data });
};
