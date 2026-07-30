const Anthropic = require("@anthropic-ai/sdk");

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    candidateName: { type: "string" },
    targetRole: { type: "string" },
    matchScore: { type: "integer" },
    matchedKeywords: { type: "array", items: { type: "string" } },
    missingKeywords: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    skills: { type: "array", items: { type: "string" } },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          highlights: { type: "array", items: { type: "string" } }
        },
        required: ["text", "highlights"],
        additionalProperties: false
      }
    },
    letterIntro: { type: "string" },
    letterBody: { type: "array", items: { type: "string" } },
    letterClosing: { type: "string" },
    interviewQuestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          tip: { type: "string" }
        },
        required: ["question", "tip"],
        additionalProperties: false
      }
    },
    recommendedTemplate: {
      type: "string",
      enum: ["sobre", "cyan", "magenta", "encre", "forest", "tech"]
    }
  },
  required: [
    "candidateName", "targetRole", "matchScore", "matchedKeywords", "missingKeywords",
    "summary", "skills", "experience", "letterIntro", "letterBody", "letterClosing",
    "interviewQuestions", "recommendedTemplate"
  ],
  additionalProperties: false
};

const TEMPLATE_GUIDE = `Modèles de CV disponibles (choisis le plus adapté au secteur de l'offre pour "recommendedTemplate") :
- "sobre" (Classique sobre) : administration, juridique, finance.
- "cyan" (Cyan signal) : communication, marketing, digital.
- "magenta" (Magenta éditorial) : création, design, médias.
- "encre" (Contraste encre) : commercial, vente, management.
- "forest" (Vert institutionnel) : santé, social, éducation.
- "tech" (Compact technique) : informatique, ingénierie.
Si le secteur est ambigu, choisis "sobre" par défaut.`;

const SYSTEM_PROMPT = `Tu es un rédacteur professionnel francophone, spécialisé dans l'adaptation de CV et la rédaction de lettres de motivation pour des candidats en Afrique de l'Ouest.

Règles impératives :
- N'invente jamais un fait, un employeur, un diplôme, une compétence, une date ou un chiffre absent du CV fourni. Base-toi uniquement sur son contenu réel.
- Si le CV est vague ou pauvre en expérience, dis-le honnêtement dans le résumé plutôt que de combler par de l'invention.
- Le score de correspondance (matchScore, 0 à 100) doit refléter une évaluation réaliste et nuancée, pas systématiquement élevée.
- Rédige tout en français, dans un registre professionnel et vouvoyé.
- La lettre de motivation doit relier des éléments réels du CV aux besoins exprimés dans l'offre, sans généralités vides.
- Pour "experience", sélectionne et reformule légèrement les expériences du CV les plus pertinentes pour l'offre plutôt que de toutes les lister ; "highlights" liste les 2-4 mots-clés de l'offre illustrés par ce bloc.
- Pour "interviewQuestions", propose exactement 5 questions plausibles pour ce poste précis, avec un conseil de réponse concret pour chacune.

${TEMPLATE_GUIDE}`;

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

  const userPrompt = `CV du candidat :
"""
${cvText}
"""

Offre d'emploi visée :
"""
${offerText}
"""

Analyse la correspondance entre ce CV et cette offre, puis produis un CV adapté et une lettre de motivation sur mesure, selon le schéma demandé.`;

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
      max_tokens: 4096,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: RESULT_SCHEMA }
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    });
  } catch (err) {
    console.error("Anthropic API error", err);
    return res.status(502).json({ error: "Le service de génération est momentanément indisponible. Réessayez." });
  }

  if (response.stop_reason === "refusal") {
    return res.status(422).json({ error: "La génération a été refusée pour ce contenu. Vérifiez le texte du CV et de l'offre." });
  }

  const textBlock = response.content.find(b => b.type === "text");
  if (!textBlock) {
    return res.status(502).json({ error: "Réponse invalide du service de génération." });
  }

  let result;
  try {
    result = JSON.parse(textBlock.text);
  } catch (err) {
    console.error("Failed to parse Claude response as JSON", textBlock.text);
    return res.status(502).json({ error: "Réponse invalide du service de génération." });
  }

  res.status(200).json({ result });
};
