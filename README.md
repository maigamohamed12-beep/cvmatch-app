# CVMatch — outil CV/lettre de motivation avec paiement Mobile Money sécurisé

Outil qui adapte un CV et rédige une lettre de motivation à partir d'une offre
d'emploi grâce à l'IA (Claude), avec analyse de correspondance, simulation
d'entretien, et un vrai backend pour déverrouiller l'export après un paiement
Mobile Money confirmé par WhatsApp.

## Comment ça marche

1. Un candidat choisit une formule payante et clique **Mobile Money**. Le
   site crée une commande côté serveur (référence courte, ex. `7K2P9Q`) et
   ouvre WhatsApp vers ton numéro avec un message pré-rempli contenant cette
   référence.
2. Le candidat envoie le message et te transmet la preuve de paiement.
3. Tu vérifies toi-même le paiement (SMS Mobile Money, etc.), puis tu ouvres
   `/admin`, entres la référence, et cliques **Confirmer le paiement**. Un
   code de déverrouillage s'affiche **une seule fois** — tu le copies et
   l'envoies au candidat par WhatsApp.
4. Le candidat saisit ce code dans l'outil : le serveur le vérifie (le code
   n'est jamais stocké en clair, seulement son empreinte SHA-256) et débloque
   l'export PDF.

Le secret ne quitte jamais le serveur : contrairement à une version 100 %
client, personne ne peut retrouver un code valide en lisant le code source du
site.

## Stack

- **Frontend** : `index.html` (l'outil) et `admin.html` (ton tableau de bord),
  fichiers statiques servis tels quels.
- **Backend** : fonctions serverless Vercel dans `/api` (Node.js).
- **Base de données** : Supabase (Postgres), une seule table `orders`.
- **IA** : API Claude (Anthropic) pour l'analyse et la rédaction du CV/lettre —
  appelée uniquement côté serveur (`api/generate.js` pour le français,
  `api/generate-english.js` pour la version anglaise optionnelle), jamais
  depuis le navigateur.
- **Import de fichier** : `api/extract-cv.js` extrait le texte d'un CV envoyé
  en PDF ou Word (`.docx`) pour préremplir le champ CV, sans passer par le
  copier-coller.
- **Police de marque** : servie en fichiers séparés dans `/fonts` (et non plus
  encodée en base64 dans `index.html`) pour réduire le poids de la page et
  profiter de la mise en cache du navigateur.

## Déploiement — étape par étape

### 1. Créer une clé API Anthropic

1. Va sur [console.anthropic.com](https://console.anthropic.com) → crée un
   compte → ajoute un moyen de paiement (Settings → Billing) — **cette partie
   n'est pas gratuite**, chaque génération de CV/lettre coûte quelques
   centimes, facturés à l'usage.
2. **API Keys** → **Create Key** → copie la clé (elle commence par `sk-ant-`).
   Elle deviendra `ANTHROPIC_API_KEY` à l'étape Vercel.

### 2. Créer le projet Supabase

1. Va sur [supabase.com](https://supabase.com) → crée un compte gratuit →
   **New project**.
2. Une fois le projet créé, ouvre **SQL Editor** → **New query**, colle le
   contenu de [`supabase/schema.sql`](./supabase/schema.sql) → **Run**.
   *Projet déjà en production ?* Rejoue ce même script (il est écrit pour
   être rejouable sans risque : `create ... if not exists`) pour récupérer la
   table `generation_log` et la fonction `increment_order_attempts` ajoutées
   par le dernier passage sécurité.
3. Va dans **Project Settings → API** et note :
   - `Project URL` → deviendra `SUPABASE_URL`
   - `service_role` key (⚠️ pas la `anon` key) → deviendra
     `SUPABASE_SERVICE_ROLE_KEY`. Cette clé a tous les droits : elle ne doit
     jamais être utilisée côté navigateur, seulement dans les fonctions
     serveur (`/api`) — c'est déjà comme ça que ce projet est construit.

### 3. Déployer sur Vercel

1. Pousse ce dépôt sur ton propre compte GitHub (déjà fait si tu lis ceci
   depuis le dépôt que je t'ai créé).
2. Va sur [vercel.com](https://vercel.com) → connecte-toi avec GitHub →
   **Add New → Project** → sélectionne ce dépôt.
3. Vercel détecte un projet sans framework ("Other") : laisse les réglages
   par défaut, pas de build command nécessaire.
4. Avant de cliquer **Deploy**, ouvre **Environment Variables** et ajoute :
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_SECRET` — choisis toi-même un mot de passe long et unique
     (20+ caractères aléatoires), c'est lui qui protège `/admin`. Un
     générateur de mot de passe en ligne convient très bien.
   - `ANTHROPIC_API_KEY` — la clé créée à l'étape 1.
   - `SENTRY_DSN` — optionnel, voir [Surveillance des erreurs](#surveillance-des-erreurs-sentry)
     ci-dessous ; tu peux aussi l'ajouter plus tard, sans redéployer le code.
5. Clique **Deploy**. Après quelques secondes, ton site est en ligne à une
   adresse du type `https://cvmatch-app.vercel.app`.

### Surveillance des erreurs (Sentry)

Optionnel, mais recommandé dès que le site a de vrais utilisateurs : sans ça,
une erreur serveur (import CV, génération IA, paiement...) n'est visible que
si un candidat te le signale, ou si tu vas fouiller manuellement les
**Runtime Logs** de Vercel.

1. Crée un compte gratuit sur [sentry.io](https://sentry.io) → **Create
   Project** → choisis **Node.js** comme plateforme.
2. Copie le **DSN** affiché (une URL du type
   `https://xxxx@xxxx.ingest.sentry.io/xxxx`).
3. Sur Vercel : **Project → Settings → Environment Variables** → ajoute
   `SENTRY_DSN` avec cette valeur → redéploie (ou attends le prochain push).
4. Chaque erreur serveur inattendue (extraction de CV, appel à l'IA,
   paiement, etc.) apparaît alors automatiquement dans le tableau de bord
   Sentry, avec la trace complète — plus besoin d'aller chercher les logs
   Vercel à la main.

Sans `SENTRY_DSN`, rien ne change : les erreurs continuent d'apparaître dans
les Runtime Logs de Vercel comme avant, simplement sans remontée proactive.

### 4. Tester

- `https://ton-site.vercel.app/` → l'outil pour les candidats. Teste le
  parcours complet : coller un CV → coller une offre → **Analyser** (l'IA
  prend quelques secondes) → **Générer le CV et la lettre**.
- `https://ton-site.vercel.app/admin` → ton tableau de bord (demande le
  `ADMIN_SECRET`).
- Fais un essai de paiement complet : choisis une formule payante → Mobile
  Money → récupère la référence affichée → va sur `/admin`, confirme cette
  référence, copie le code → reviens sur le site, colle le code → vérifie que
  le PDF se débloque.

### 5. (Optionnel) Domaine personnalisé

Dans Vercel : **Project → Settings → Domains** → ajoute ton propre nom de
domaine si tu en as un, avec les instructions DNS fournies par Vercel.

## Développement local

```
npm install
npx vercel dev
```

`vercel dev` lit `.env` (copie `.env.example` en `.env` et remplis tes
propres valeurs) et simule les fonctions `/api` + les fichiers statiques
exactement comme en production.

## Notes de sécurité

- Le code de déverrouillage (8 caractères, alphabet sans caractères
  ambigus) n'est jamais stocké en clair — seule son empreinte SHA-256 est
  gardée en base.
- 10 tentatives incorrectes maximum par commande avant blocage.
- Un code "Pack unique" expire après 72h, un code "Illimité" après 30 jours
  — modifiable dans `api/confirm-order.js` (constante `VALIDITY`).
- `/admin` n'est pas listé dans les moteurs de recherche (`X-Robots-Tag`),
  mais reste accessible à quiconque connaît l'URL : c'est le mot de passe
  (`ADMIN_SECRET`) qui protège réellement l'accès, garde-le secret.
- Le paiement par carte bancaire dans l'outil reste une démonstration (aucun
  vrai processeur de paiement n'est branché) — seul le circuit Mobile Money
  passe par ce backend.

## Notes sur la génération IA

- Chaque clic sur **Analyser** déclenche un appel à l'API Claude (modèle
  `claude-opus-5`) qui coûte quelques centimes — surveille ta consommation
  sur [console.anthropic.com](https://console.anthropic.com) (Usage).
- Le texte du CV et de l'offre est plafonné à 20 000 caractères chacun (très
  au-dessus de n'importe quel CV/offre réel) pour empêcher un envoi
  volontairement énorme de faire exploser le coût d'un seul appel.
- **Limite de fréquence par IP** : 30 générations par 24h et par adresse IP
  (comptabilisées dans la table `generation_log`, partagée entre
  `/api/generate` et `/api/generate-english`) — volontairement généreuse pour
  ne jamais gêner un usage normal (plusieurs personnes peuvent partager une
  même IP), mais elle bloque un script qui relancerait l'analyse en boucle.
  Ajustable via `MAX_PER_WINDOW` dans `lib/rateLimit.js`.
- Le modèle a pour consigne stricte de ne jamais inventer d'expérience, de
  diplôme ou de chiffre absent du CV — mais comme toute IA, relis toujours le
  résultat avant de l'envoyer à un recruteur.
- Le CV généré suit une structure de CV professionnel standard (inspirée des
  modèles recommandés pour les ATS) : coordonnées, résumé, compétences,
  expériences avec intitulé de poste/entreprise/dates et puces de
  réalisations, formation et langues — chaque section n'apparaît que si
  l'information correspondante est réellement présente dans le CV d'origine.
- Cocher « Générer aussi une version anglaise » déclenche un second appel IA
  indépendant (`api/generate-english.js`) : le coût est donc environ doublé
  pour cette génération précise.

## Fonctionnalités côté candidat

- **Import de CV en PDF/Word** : sur l'étape « Votre CV », un bouton permet
  d'envoyer directement un fichier (8 Mo max) au lieu de copier-coller le
  texte ; l'extraction se fait côté serveur (`pdf-parse` pour le PDF,
  `mammoth` pour le `.docx`).
- **Brouillon sauvegardé automatiquement** : le texte du CV et de l'offre est
  conservé dans le `localStorage` du navigateur (pas envoyé au serveur) et
  restauré si le candidat revient ou recharge la page par accident. Un bouton
  « Effacer le brouillon » permet de tout réinitialiser.
- **Historique des candidatures** : chaque génération terminée est ajoutée à
  un historique local (jusqu'à 20 entrées, dans le navigateur), accessible
  via le lien « Historique » du bandeau supérieur — le candidat peut revoir
  un CV/lettre déjà générés sans relancer l'IA. Cet historique reste local à
  l'appareil et n'est jamais envoyé au serveur.
- **Version anglaise optionnelle** : une case à cocher sur l'étape de l'offre
  déclenche une seconde génération IA en anglais, adaptée aux conventions de
  CV anglophones (pas une simple traduction) ; le candidat peut ensuite
  basculer entre Français et English sur l'écran des résultats.
- **Installable comme une application (PWA)** : sur mobile ou desktop, le
  candidat peut faire « Ajouter à l'écran d'accueil » (Android/Chrome) ou
  « Sur l'écran d'accueil » (iPhone/Safari, menu Partager) pour obtenir une
  icône et un lancement plein écran, sans passer par l'App Store ou le Play
  Store. `manifest.json` et `sw.js` (Service Worker) gèrent ça ; le Service
  Worker ne mémorise que les fichiers statiques (police, icônes) — jamais
  `/api/*` ni `/admin`, pour que paiements et codes restent toujours en
  temps réel.
