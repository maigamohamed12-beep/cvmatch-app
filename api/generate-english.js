const Anthropic = require("@anthropic-ai/sdk");
const { getClientIp, checkAndLogGeneration } = require("../lib/rateLimit");

const MAX_TEXT_LENGTH = 20000;

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    candidateName: { type: "string" },
    targetRole: { type: "string" },
    contactLine: { type: "string" },
    summary: { type: "string" },
    skills: { type: "array", items: { type: "string" } },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string" },
          org: { type: "string" },
          period: { type: "string" },
          bullets: { type: "array", items: { type: "string" } }
        },
        required: ["role", "org", "period", "bullets"],
        additionalProperties: false
      }
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          degree: { type: "string" },
          school: { type: "string" },
          period: { type: "string" }
        },
        required: ["degree", "school", "period"],
        additionalProperties: false
      }
    },
    languages: { type: "array", items: { type: "string" } },
    letterIntro: { type: "string" },
    letterBody: { type: "array", items: { type: "string" } },
    letterClosing: { type: "string" }
  },
  required: [
    "candidateName", "targetRole", "contactLine", "summary", "skills",
    "experience", "education", "languages", "letterIntro", "letterBody", "letterClosing"
  ],
  additionalProperties: false
};

const SYSTEM_PROMPT = `You are a professional resume writer producing an English-language CV and cover letter for a candidate applying to an international organization from West Africa.

Strict rules:
- Never invent a fact, employer, degree, skill, date, or figure absent from the CV provided. Base everything strictly on its real content.
- If the CV is vague or thin on experience, say so honestly in the summary rather than filling gaps with invention.
- Write in idiomatic, professional English following standard international CV and cover letter conventions (reverse-chronological experience, action verbs, quantify results only when the source CV actually states a number) - do not produce a literal word-for-word translation of French phrasing.
- The cover letter must connect real elements of the CV to the needs expressed in the job offer, with no empty generalities.
- The complete letter ("letterIntro" + "letterBody" + "letterClosing") must fit on a single printed page: stay between 150 and 230 words total, with at most 3 short, direct paragraphs in "letterBody".
- For "contactLine", assemble only contact details actually present in the CV (email, phone, city/country), separated by " · ", e.g. "email@example.com · +223 00 00 00 00 · Bamako, Mali". Never invent an address, phone number, or email: return an empty string if none can be identified.
- For "experience", structure each real professional experience from the CV that is most relevant to the offer: "role" (job title), "org" (employer/organization) and "period" (dates) exactly as they appear in the CV (empty string if the information is missing), then "bullets": 2-4 short bullet points rephrasing real, concrete achievements from that experience. Never merge two experiences into one block.
- For "education", list only qualifications actually mentioned in the CV ("degree", "school", "period", empty string if information is missing); return an empty array if the CV mentions none, never invent a degree.
- For "languages", list only languages explicitly mentioned in the CV, with proficiency level if stated (e.g. "English (fluent)"); empty array otherwise.`;

function describeAnthropicError(err){
  if (!err) return "Unknown error.";
  const parts = [];
  if (err.status) parts.push("HTTP " + err.status);
  if (err.error && err.error.error && err.error.error.type) parts.push(err.error.error.type);
  else if (err.type) parts.push(err.type);
  parts.push(err.message || String(err));
  return parts.join(" - ");
}

let client = null;
function getClient(){
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
    client = new Anthropic({ apiKey });
  }
  return client;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { cvText, offerText } = req.body || {};
  if (!cvText || !offerText || !String(cvText).trim() || !String(offerText).trim()) {
    return res.status(400).json({ error: "Le CV et l'offre sont requis." });
  }
  if (String(cvText).length > MAX_TEXT_LENGTH || String(offerText).length > MAX_TEXT_LENGTH) {
    return res.status(413).json({ error: "Le CV ou l'offre est trop long (20 000 caractères maximum chacun)." });
  }

  const { allowed } = await checkAndLogGeneration(getClientIp(req));
  if (!allowed) {
    return res.status(429).json({ error: "Trop de générations depuis cette connexion aujourd'hui. Réessayez plus tard." });
  }

  const userPrompt = `Candidate's CV:
"""
${cvText}
"""

Target job offer:
"""
${offerText}
"""

Produce an English-adapted CV and a tailored English cover letter for this candidate applying to this offer, following the requested schema.`;

  let anthropic;
  try {
    anthropic = getClient();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Service de génération non configuré." });
  }

  let response;
  try {
    response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 6000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: RESULT_SCHEMA }
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    });
  } catch (err) {
    console.error("Anthropic API error (english)", err);
    const detail = describeAnthropicError(err);
    return res.status(502).json({ error: "Le service de génération (version anglaise) est momentanément indisponible. Réessayez.", detail });
  }

  if (response.stop_reason === "refusal") {
    return res.status(422).json({ error: "La génération anglaise a été refusée pour ce contenu." });
  }
  if (response.stop_reason === "max_tokens") {
    console.error("Claude response truncated at max_tokens (english)", { usage: response.usage });
    return res.status(502).json({ error: "La génération anglaise a été interrompue (réponse trop longue). Réessayez.", detail: "stop_reason=max_tokens usage=" + JSON.stringify(response.usage) });
  }

  const textBlock = response.content.find(b => b.type === "text");
  if (!textBlock) {
    console.error("No text block in Claude response (english)", { stop_reason: response.stop_reason, contentTypes: response.content.map(b => b.type) });
    return res.status(502).json({ error: "Réponse invalide du service de génération (version anglaise).", detail: "stop_reason=" + response.stop_reason + " contentTypes=" + response.content.map(b => b.type).join(",") });
  }

  let result;
  try {
    result = JSON.parse(textBlock.text);
  } catch (err) {
    console.error("Failed to parse Claude response as JSON (english)", { stop_reason: response.stop_reason, text: textBlock.text });
    return res.status(502).json({ error: "Réponse invalide du service de génération (version anglaise).", detail: "JSON.parse a échoué: " + (err && err.message) });
  }

  res.status(200).json({ result });
};
