# LightPay (LightWallet) — consignes pour Claude

Wallet et paiements mobile money (MTN MoMo, Airtel Money) pour le Congo-Brazzaville, en FCFA (XAF).
Fastify + PostgreSQL (deux bases : production et sandbox), grand livre en partie double.
Pages hébergées en HTML/JS sans framework : `src/pages/hosted/*` (compte, console, admin, paiement).

## Règles d’interface (à ne jamais enfreindre)

- **Toute liste est un scaffold.** L’en-tête de l’écran (retour, titre, actions) et la barre d’outils
  de la liste (recherche, filtres, onglets) sont épinglés et **ne défilent jamais** ; seules les lignes
  défilent, la ligne d’en-tête des colonnes reste collée en haut.
- **Un élément s’ouvre en écran à part** (`#/users/<id>` → écran `user`) avec un lien retour,
  comme une app Android ou le back-office Salacope (`Page` avec `back` et `toolbar`). Jamais de
  panneau de détail coincé à côté de la liste. Au retour, la liste garde sa position.
  Admin et console : helper `page(screen, title, inner, { toolbar, back, actions })`, styles
  `.scaffold`, `.page-top`, `.page-toolbar`, `.page-scroll`, `.list-card` dans `console.ts`.
- **Argent : un seul code.** Dépôt, Envoyer, Retirer et leurs écrans de résultat sont dans
  `flows.ts`, partagés par le compte et la console. Formulaire → bottom sheet de confirmation →
  écran d’attente → résultat. Le formulaire n’affiche **aucune erreur** : le bouton reste grisé
  tant que ce n’est pas complet ; un refus s’affiche sur l’écran de résultat. Le bouton du sheet
  se verrouille au premier appui (anti double/triple appui) ; chaque opération a sa clé d’idempotence.
- **Le numéro choisit l’opérateur** (06 MTN, 05/04 Airtel) ; le serveur refuse un mélange.
- **Shimmer partout où l’on attend** une réponse ; un détail rouvert pour un autre élément montre
  le shimmer, jamais les données précédentes.
- **Mouvement** : avancer glisse depuis la droite, revenir depuis la gauche, les onglets en fondu ;
  désactivé avec `prefers-reduced-motion`.
- **Montants** : une sortie affiche ce qui a quitté le wallet, frais compris ; une entrée affiche
  ce qui est arrivé, jamais ce que le téléphone a payé avec les frais.
- **Les fournisseurs (SasPay, pawaPay) ne se montrent jamais** aux personnes ni aux apps :
  seulement dans l’admin.
- **Couleurs** : celles de Salacope (`src/styles/tokens.css` du dépôt Salacope) sont la référence ;
  nuit par défaut, jour sur demande ; le thème d’une app qui ouvre le paiement est transmis (`?theme=`).
- Sobre et utile : une information par bloc, pas de décoration.

## Connexion

Google seulement (Firebase Auth, redirection dans le même onglet ; fenêtre seulement dans un cadre).
`/__/auth/*` et `/__/firebase/*` sont relayés vers Firebase. La CSP des pages doit autoriser
`www.gstatic.com` et `apis.google.com` (sans lui, le retour de Google échoue en silence).

## Frais, fournisseurs, argent

- Frais et minimums : **uniquement depuis l’admin** (« Frais et minimums »), par environnement ;
  rien en dur. Formules dans `src/payments/fees.ts`.
- Fournisseur des encaissements et des envois : choisi dans l’admin (« Fournisseurs ») ;
  SasPay = réel seulement, simulateur = test seulement.
- Un dépôt sans validation est fermé après 5 min ; un succès tardif est quand même crédité.

## Façon de travailler

- Vérifier avec `npx tsc --noEmit -p .` et `npx tsx test/pages.check.ts`.
- Pousser directement sur `main` est autorisé (Render déploie). Ne jamais commiter de `.env`.
- Ne jamais déplacer d’argent ni créditer un compte soi-même : l’utilisateur lance les scripts.
- Réponses en français, courtes.
