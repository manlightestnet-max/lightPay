# LightPay (LightWallet) — consignes pour Claude

Wallet et paiements mobile money (MTN MoMo, Airtel Money, Orange Money…) pour le Congo-Brazzaville et les pays que l’admin
ouvre (Cameroun, Côte d’Ivoire, Togo, Gabon…), en FCFA. Plan et état : `docs/plan-multi-pays.md`.
Fastify + PostgreSQL (deux bases : production et sandbox), grand livre en partie double.
Pages hébergées en HTML/JS sans framework : `src/pages/hosted/*` (compte, console, admin, paiement).

## Règles d’interface (à ne jamais enfreindre)

LightPay est un produit à part : il sert n’importe quelle app et n’en nomme aucune (ni texte, ni logo, ni couleur
d’une app précise). Deux interfaces, deux registres :
**le compte** (`/account`, l’app Android) est simple et grand public ; **la console et l’admin** sont un back-office
SaaS (barre latérale, écrans en scaffold). La console ne s’ouvre que depuis le « Mode avancé » du compte.

### Écrans et listes (console, admin)

- **Scaffold.** L’en-tête de l’écran (retour, titre, actions) et la barre d’outils (recherche, filtres, onglets)
  sont épinglés et **ne défilent jamais** ; seul le contenu défile. Helper `page(screen, title, inner,
  { toolbar, back, actions })`, styles `.scaffold`, `.page-top`, `.page-toolbar`, `.page-scroll`, `.list-card`
  (`console.ts`).
- **Une seule liste : `table()`** du client partagé (`client.ts`), jamais une copie locale. La ligne d’en-tête des
  colonnes reste collée ; chaque colonne se **trie** (croissant, décroissant, retour à l’ordre du serveur), le tri
  est gardé par liste pendant la visite ; une ligne de total (`fixed: true`) reste en bas. Filtres en pastilles dans
  la barre d’outils ; « Afficher plus » ajoute la page suivante sans perdre la position.
- **Suivi.** Chaque élément qui avance (envoi, demande, litige) montre son état en pastille (en attente, retenu,
  envoyé, échoué…) et l’heure de son dernier changement ; une liste qui a des éléments à traiter l’affiche dans la
  barre latérale (compteur).
- **Un élément s’ouvre en écran à part** (`#/users/<id>` → écran `user`) avec un lien retour, comme une app Android.
  Jamais de panneau de détail coincé à côté de la liste. Au retour, la liste garde sa position et son tri.

### Chargement

- **Shimmer seulement pour la toute première charge** d’une donnée jamais vue. Revenir sur un écran ou une liste
  déjà vus réaffiche tout de suite le dernier état connu, puis vérifie auprès du serveur.
- Ouvrir le détail d’un **autre** élément montre le shimmer, jamais les données de l’élément précédent.

### Argent

- **Un seul code.** Dépôt, Envoyer, Retirer et leurs écrans de résultat sont dans `flows.ts`, partagés par le
  compte et la console. Formulaire → bottom sheet de confirmation → écran d’attente → résultat.
- **Formulaires d’argent des personnes** (compte, console) : aucune erreur affichée, le bouton reste grisé tant que
  ce n’est pas complet ; un refus s’affiche sur l’écran de résultat. Le bouton du sheet se verrouille au premier
  appui ; chaque opération a sa clé d’idempotence.
- **Formulaires de l’admin** (réglages, envoi depuis le main, relevé de solde) : le message s’affiche sous le
  formulaire (`say(…, 'err' | 'ok')`), parce que l’admin doit savoir tout de suite ce qui ne va pas.
- **Le numéro choisit l’opérateur** d’après les préfixes du registre (Congo : 06 MTN, 05/04 Airtel) ; le serveur refuse
  un mélange. Le pays se choisit avant l’opérateur, seulement quand plusieurs pays sont ouverts ; un numéro part en forme
  internationale (`242…`, `237…`).
- **Plusieurs wallets** : un formulaire ne demande « quel wallet » que s’il y en a plusieurs, en partant de celui d’où il
  a été ouvert ; écrans partagés compte / console dans `wallets.ts`.
- **Le pays d’un wallet** : la personne le choisit elle-même (écran « Votre pays » après le @nom et le code, quand plusieurs
  pays sont ouverts ; à l’ouverture d’un autre wallet). Jamais de pays imposé. Le changer ensuite est une **demande que
  l’admin valide** (Contrôle → « Changements de pays ») ; à l’acceptation, les frais de changement de pays (« Frais et
  minimums », swap) sont pris sur le solde (`src/wallets/country.ts`).
- **Montants** : une sortie affiche ce qui a quitté le wallet, frais compris ; une entrée affiche ce qui est arrivé,
  jamais ce que le téléphone a payé avec les frais.
- **Les fournisseurs (SasPay, pawaPay) ne se montrent jamais** aux personnes ni aux apps : seulement dans l’admin.

### Style

- **Couleurs** : les tokens de LightPay, définis dans `src/pages/hosted/design.ts` et nulle part ailleurs (jamais
  de couleur en dur dans un écran) ; nuit par défaut, jour sur demande ; une app qui ouvre le paiement transmet son
  thème (`?theme=`).
- Sobre et utile : une information par bloc, la hiérarchie par la taille et la graisse, pas de décoration.
- **Mouvement** : avancer glisse depuis la droite, revenir depuis la gauche, les onglets en fondu ; désactivé avec
  `prefers-reduced-motion`.
- **Documentation** : `/docs` (`src/pages/hosted/docs.ts`), publique, écrite d’après l’API telle qu’elle est ; toute
  route publique qui change change aussi sa page.

## Connexion

Google seulement (Firebase Auth, redirection dans le même onglet ; fenêtre seulement dans un cadre).
`/__/auth/*` et `/__/firebase/*` sont relayés vers Firebase. La CSP des pages doit autoriser
`www.gstatic.com` et `apis.google.com` (sans lui, le retour de Google échoue en silence).

## Frais, fournisseurs, argent

- **Revenus de LightPay → wallet main** (`src/db/fee-wallet.ts`) : les frais de dépôt et de paiement y vont
  directement ; les frais d’un retrait ou d’un remboursement attendent dans `LIGHTPAY_FEES` (« frais en attente »)
  tant que l’opérateur n’a pas confirmé l’envoi, puis passent au main (un envoi refusé rend ses frais). Chaque frais
  est décrit « Frais LightPay - … » : c’est ainsi que l’admin compte les revenus, où qu’ils soient.
- **Réserves par wallet fournisseur** (fournisseur + pays, admin → Réserves) : ce qui doit être chez lui = encaissé −
  versé + transferts reçus − transferts partis + envois pas encore partis ; un envoi échoué et sa restitution ne comptent
  pas (rien n’a bougé chez lui). Les soldes réels sont lus par API (SasPay, pawaPay) ou relevés à la main
  (`provider_balance_checks`, une note, aucun argent ne bouge) : l’écart, le disponible et les alertes s’affichent.
- **Un seul franc** : XAF et XOF sont la même unité dans LightPay (1 pour 1, parité fixe avec l’euro), les soldes restent
  en `XAF` ; le fournisseur reçoit la monnaie du pays de l’opérateur. Envoi entre personnes : gratuit, même d’un pays à
  l’autre.
- **Rééquilibrage** (`src/payments/rebalance.ts`) : LightPay déplace son propre argent entre les wallets pays de SasPay
  (`wallet-transfers`, un à la fois, en file) ; un retrait vers un pays à sec attend son transfert ; le coût (envoyé −
  arrivé, le `to_amount` de SasPay est déjà net de ses frais) est écrit en `SYSTEM_PROVIDER_COSTS`. **Désactivé par
  défaut**, seulement vers un wallet dont l’admin a fixé le niveau cible, jamais sous le « transfert automatique minimum ».
  Rien ne passe jamais de pawaPay à SasPay.
- **Marchand direct** : une session de paiement ou un débit sans `payee` paie le wallet de l’app elle-même, sans
  commission (`fee_amount` exige un vendeur). Le séquestre est alors facultatif (désactivé par défaut).
- Frais et minimums : **uniquement depuis l’admin** (« Frais et minimums »), par environnement ;
  rien en dur. Formules dans `src/payments/fees.ts`.
- **Délais, limites et frein d’urgence : uniquement depuis l’admin** (« Contrôle »), rien en dur : délai avant un retrait et avant un
  remboursement (un envoi attend, l’admin peut le retenir pour litige / support / autre, le libérer ou l’annuler), nombre de tentatives de
  retrait puis suspension du compte, frein d’urgence à cinq niveaux (`src/security/lockdown.ts`, variable `LIGHTWALLET_LOCKDOWN`).
  Même design que « Frais et minimums » (`settingItem`). Un remboursement coûte comme un retrait (frais opérateur + LightPay).
- Fournisseur des encaissements et des envois : les **règles de routage** de l’admin (« Routage », `src/rails/routing.ts`)
  choisissent, sinon le fournisseur par défaut (« Fournisseurs ») ; un devis passe par les mêmes règles que l’opération.
  SasPay = réel seulement, simulateur = test seulement.
- **Pays et opérateurs : uniquement depuis l’admin** (« Pays et opérateurs », registre `src/rails/registry.ts`, tables
  `countries` et `rails`) : ouvrir un pays, activer un opérateur, ses préfixes et les codes de chaque fournisseur. Un
  opérateur à code OTP ou à page de redirection reste éteint tant que son écran n’existe pas.
- **Tarifs réels des fournisseurs** (admin, `src/payments/provider-rates.ts`) : lus en direct, pour comparer ; les
  personnes paient toujours les frais réglés dans « Frais et minimums ».
- Un dépôt sans validation est fermé après 5 min ; un succès tardif est quand même crédité.

## Façon de travailler

- Vérifier avec `npx tsc --noEmit -p .` et `npx tsx test/pages.check.ts`.
- Pousser directement sur `main` est autorisé (Render déploie). Ne jamais commiter de `.env`.
- Ne jamais déplacer d’argent ni créditer un compte soi-même : l’utilisateur lance les scripts.
- Réponses en français, courtes.
