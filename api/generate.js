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
    contactLine: { type: "string" },
    skills: { type: "array", items: { type: "string" } },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string" },
          org: { type: "string" },
          period: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          highlights: { type: "array", items: { type: "string" } }
        },
        required: ["role", "org", "period", "bullets", "highlights"],
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
    "summary", "contactLine", "skills", "experience", "education", "languages",
    "letterIntro", "letterBody", "letterClosing", "interviewQuestions", "recommendedTemplate"
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
- Pour "contactLine", assemble uniquement les coordonnées réellement présentes dans le CV (email, téléphone, ville/pays), séparées par « · », par exemple "email@exemple.com · +223 00 00 00 00 · Bamako, Mali". N'invente jamais une adresse, un numéro ou un email : renvoie une chaîne vide si aucune coordonnée n'est identifiable dans le texte.
- Pour "experience", structure chaque expérience professionnelle réelle du CV la plus pertinente pour l'offre : "role" (intitulé de poste), "org" (entreprise/organisation) et "period" (dates) tels qu'ils apparaissent dans le CV (chaîne vide si l'information est absente), puis "bullets" : 2 à 4 puces courtes reformulant des réalisations concrètes et réelles de cette expérience, dans un style CV professionnel (verbe d'action, résultat si connu). Ne mélange jamais deux expériences dans un même bloc. "highlights" reste la liste des 2-4 mots-clés de l'offre illustrés par ce bloc.
- Pour "education", liste les formations réellement mentionnées dans le CV ("degree", "school", "period", chaîne vide si une information manque) ; renvoie un tableau vide si le CV n'en mentionne aucune, sans jamais inventer de diplôme.
- Pour "languages", liste uniquement les langues explicitement mentionnées dans le CV, avec leur niveau si précisé (ex. "Anglais (courant)") ; tableau vide sinon.
- Pour "interviewQuestions", propose exactement 5 questions plausibles pour ce poste précis, avec un conseil de réponse concret pour chacune.

${TEMPLATE_GUIDE}`;

function describeAnthropicError(err){
  if (!err) return "Erreur inconnue.";
  const parts = [];
  if (err.status) parts.push("HTTP " + err.status);
  if (err.error && err.error.error && err.error.error.type) parts.push(err.error.error.type);
  else if (err.type) parts.push(err.type);
  parts.push(err.message || String(err));
  return parts.join(" — ");
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
      max_tokens: 8000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: RESULT_SCHEMA }
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }]
    });
  } catch (err) {
    console.error("Anthropic API error", err);
    const detail = describeAnthropicError(err);
    return res.status(502).json({ error: "Le service de génération est momentanément indisponible. Réessayez.", detail });
  }

  if (response.stop_reason === "refusal") {
    return res.status(422).json({ error: "La génération a été refusée pour ce contenu. Vérifiez le texte du CV et de l'offre." });
  }
  if (response.stop_reason === "max_tokens") {
    console.error("Claude response truncated at max_tokens", { usage: response.usage });
    return res.status(502).json({ error: "La génération a été interrompue (réponse trop longue). Réessayez, éventuellement avec un texte plus court.", detail: "stop_reason=max_tokens usage=" + JSON.stringify(response.usage) });
  }

  const textBlock = response.content.find(b => b.type === "text");
  if (!textBlock) {
    console.error("No text block in Claude response", { stop_reason: response.stop_reason, contentTypes: response.content.map(b => b.type) });
    return res.status(502).json({ error: "Réponse invalide du service de génération.", detail: "stop_reason=" + response.stop_reason + " contentTypes=" + response.content.map(b => b.type).join(",") });
  }

  let result;
  try {
    result = JSON.parse(textBlock.text);
  } catch (err) {
    console.error("Failed to parse Claude response as JSON", { stop_reason: response.stop_reason, text: textBlock.text });
    return res.status(502).json({ error: "Réponse invalide du service de génération.", detail: "JSON.parse a échoué: " + (err && err.message) });
  }

  res.status(200).json({ result });
};
