# Maakoulat — Application de gestion

Web app bilingue (FR / AR) pour le suivi de l'entreprise : **saisie rapide des ventes**, tableau de bord, fournisseurs et charges. Reprend la logique de votre fichier `Situation - 08_2026.xlsx`.

**Stack :** Next.js 16 · React 19 · Tailwind 4 · Supabase (Postgres + Auth).

---

## 1. Créer le projet Supabase (gratuit)

1. Aller sur [supabase.com](https://supabase.com) → **New project**. Notez le mot de passe de la base.
2. Une fois créé : menu **SQL Editor** → **New query** → collez tout le contenu de [`supabase/schema.sql`](supabase/schema.sql) → **Run**. (Crée les tables + la sécurité.) Puis exécutez de la même façon les migrations : [`supabase/migration_finance.sql`](supabase/migration_finance.sql) (module financier), [`supabase/migration_products.sql`](supabase/migration_products.sql) (désignation FR + TVA sur les produits), [`supabase/migration_orders.sql`](supabase/migration_orders.sql) (bons de commande + import du BC MODEL n° 33-24) et [`supabase/migration_suppliers.sql`](supabase/migration_suppliers.sql) (coordonnées de contact des fournisseurs pour la page dédiée).
3. Menu **Settings → API**, récupérez :
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public** key
   - **service_role** key (secrète — pour l'import uniquement)

## 2. Créer votre compte utilisateur

Menu **Authentication → Users → Add user → Create new user**. Mettez votre e-mail + un mot de passe. (C'est ce compte qui servira à se connecter à l'app.) Répétez pour vos vendeurs si besoin.

> Optionnel : dans **Authentication → Providers → Email**, désactivez « Confirm email » pour éviter l'e-mail de confirmation.

## 3. Configurer les variables d'environnement

```bash
cp .env.local.example .env.local
```

Éditez `.env.local` avec vos valeurs de l'étape 1.

### Envoi des bons de commande par email (Gmail)

Pour activer le bouton **« Envoyer par email »** (BC en PDF joint), ajoutez dans `.env.local` :

```
GMAIL_USER=maakoulatcomdis@gmail.com
GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
GMAIL_FROM_NAME=Maakoulatcom Distribution
```

`GMAIL_APP_PASSWORD` est un **mot de passe d'application** à 16 caractères (≠ votre mot de passe Gmail) :
Compte Google → **Sécurité** → activez la **Validation en 2 étapes** → **Mots de passe des applications** → générez-en un pour « Mail ». Collez les 16 caractères (sans espaces).
L'email part au fournisseur (adresse renseignée dans sa fiche), donc pensez à remplir l'email de chaque fournisseur.

## 4. Importer vos données Excel

```bash
npm install
npm run seed
```

Importe les 3 vendeurs (Hamza, Mohamed, Traiteur), ~179 produits, les ventes du mois, les fournisseurs et les charges.

## 5. Lancer en local

```bash
npm run dev
```

Ouvrez [http://localhost:3000](http://localhost:3000), connectez-vous.

---

## Mise en ligne (Vercel)

1. Poussez le dossier `maakoulat/` sur GitHub.
2. [vercel.com](https://vercel.com) → **Import** le dépôt.
3. Ajoutez les variables `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` dans **Settings → Environment Variables** (et, pour l'envoi email, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM_NAME`).
4. **Deploy**. L'app est accessible depuis n'importe quel téléphone.

---

## Structure

| Écran | Rôle |
|------|------|
| **Tableau de bord** | CA, bénéfices, marges par vendeur ; résultat net (bénéfice − charges) ; top produits. Sélecteur de mois. |
| **Saisie des ventes** | Choix vendeur + date, boutons +/− tactiles, filtre « Vendus », duplication d'un jour, totaux CA/bénéfice en direct. |
| **Journal** | Historique de toutes les journées saisies (par date/vendeur), cliquable pour corriger une saisie. |
| **Trésorerie** | Entrées (CA) vs sorties (fournisseurs + charges), solde du mois, solde d'ouverture/clôture, courbe de solde cumulé. |
| **Rapports** | Rapport de performance par vendeur (ou tous) sur le mois : KPI, meilleurs produits, détail par jour. Export CSV + impression/PDF pour partage. |
| **Analyse** | Évolution quotidienne (courbes CA/bénéfice), comparaison des 6 derniers mois, CA par vendeur/mois, alertes marges faibles, best-sellers et produits dormants. |
| **Produits** | Catalogue par vendeur, édition des prix d'achat/vente en ligne. |
| **Fournisseurs** | Répertoire des fournisseurs (CRUD complet : nom, contact, téléphone, e-mail, adresse, notes, actif/inactif). Vue d'ensemble des dettes (total dû, nombre en dette), recherche. Fiche par fournisseur avec relevé de compte : historique unifié commandes + paiements, solde progressif, KPI (commandé / payé / reste à payer), saisie rapide d'un mouvement, liens Appel / WhatsApp / E-mail, export CSV et impression du relevé. |
| **Bons de commande** | Création de bons de commande **liés à un fournisseur** (n° BC, date, statut) ; les lignes ne proposent que les produits de ce fournisseur (prix/unité pré-remplis), calcul automatique HT / TVA / TTC, duplication, impression/PDF, et **envoi par email au fournisseur avec le BC en PDF joint** (via Gmail). Reprend votre fichier `BC MODEL.xlsx`. |
| **Charges** | Charges fixes mensuelles (activables/désactivables). |

## Notes sur les données importées

- Les prix d'achat/vente sont **figés** sur chaque vente enregistrée : modifier un prix dans le catalogue ne change pas l'historique.
- Le Traiteur utilise des jours numérotés (1–14) → convertis en dates du mois d'août 2026 à l'import.
- Une date de vente Hamza du fichier d'origine (`08/01`) est importée telle quelle ; corrigez-la dans l'écran Ventes si besoin.
