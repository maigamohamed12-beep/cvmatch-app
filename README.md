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
  appelée uniquement côté serveur (`api/generate.js`), jamais depuis le
  navigateur.

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
5. Clique **Deploy**. Après quelques secondes, ton site est en ligne à une
   adresse du type `https://cvmatch-app.vercel.app`.

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
- Aucune limite de longueur sur le texte du CV ou de l'offre — un texte plus
  long augmente simplement un peu le coût de l'appel (facturé au nombre de
  mots/tokens envoyés à Claude).
- **Il n'y a pas de limite de fréquence par personne** : l'analyse reste
  gratuite (seul l'export PDF est payant), donc rien n'empêche aujourd'hui un
  visiteur de relancer l'analyse en boucle. Si tu constates un usage abusif,
  demande-moi d'ajouter une limite (par exemple via la table `orders` déjà en
  place, ou un compteur par IP).
- Le modèle a pour consigne stricte de ne jamais inventer d'expérience, de
  diplôme ou de chiffre absent du CV — mais comme toute IA, relis toujours le
  résultat avant de l'envoyer à un recruteur.
