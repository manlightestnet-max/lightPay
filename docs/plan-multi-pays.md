# Plan — LightPay modulaire : plusieurs wallets, plusieurs pays, un seul franc

Révision du 23 octobre 2026 (remplace les versions du 21 et du 22). **Plan seulement : rien n'est codé.**
Faits fournisseurs : docs.saspay.me, docs.pawapay.io (API v2) et les transferts SasPay faits le 22 octobre
(historique du tableau de bord SasPay).

## 0. Les décisions

1. **Tout est modulaire** : pays, moyens de paiement, fournisseurs s'ajoutent et s'activent dans l'admin.
2. **Une personne ou une app peut ouvrir plusieurs wallets.**
3. **Le franc CFA est l'unité interne.** XAF et XOF valent tous les deux 655,957 pour 1 euro (parité fixe) : dans
   LightPay, **1 XAF = 1 XOF**, les soldes restent des entiers, rien ne bouge avec les marchés. Pas de dollar.
4. **Zéro frais entre utilisateurs LightPay**, même d'un pays à l'autre : c'est une écriture dans notre base.
5. **Chacun retire l'équivalent exact** de ce qu'il a, dans le pays de son choix, moins le frais de retrait normal.
6. **SasPay est le fournisseur par défaut** ; les mouvements entre pays se font chez lui (`wallet-transfers`).
   pawaPay reste codé et sert là où une règle le choisit (moins de frais) ; **rien ne passe jamais de pawaPay à
   SasPay**.
7. **On commence avec peu de pays** (§ 5). La carte est abandonnée.

---

## 1. L'architecture modulaire

### 1.1 Les modules

| Module | Rôle | Aujourd'hui |
|---|---|---|
| **ledger** (noyau) | Seul à écrire de l'argent : partie double, idempotence, soldes. Ne connaît ni pays ni fournisseur. | `src/db/ledger.ts` — ne change pas. |
| **wallets** | Ouvrir, nommer, lister, choisir le défaut, fermer. **Seule porte d'entrée** pour trouver un wallet. | Requêtes éparpillées (`identity.ts:72`, `connect.ts:73`, `account.ts:220`, `checkout.ts:99`). |
| **countries** | Indicatif, format du numéro, préfixes des opérateurs, monnaie, zone (CFA ou non). Des lignes en base. | `normalizeCongoMsisdn`, `networkOfMsisdn` en dur (`mobile-money.ts`). |
| **rails** | (pays, moyen, sens) → validation (`push` / `otp` / `redirect`), limites, décimales. | `MobileNetwork = 'MTN_MOMO_COG' \| 'AIRTEL_COG'`. |
| **providers** | Un adaptateur par fournisseur, même interface. | `MobileMoneyProvider`. |
| **routing** | Règles de l'admin (§ 4.2) : quel fournisseur et quel wallet pays pour chaque opération. | `providerFor()` global. |
| **rebalance** | Transferts entre les wallets pays d'un fournisseur (SasPay), niveaux cibles, file d'attente. | N'existe pas. |
| **fees** · **controls** | Frais par pays et par rail ; délais, limites, frein d'urgence. Admin. | Existent, globaux. |
| **flows** (interface) | Dépôt, Envoyer, Retirer ; un écran d'attente par mode de validation. | `flows.ts`. |

### 1.2 Les règles

- Un module ne parle aux autres que par son interface ; le ledger ne sait pas ce qu'est un pays.
- **Ajouter un fournisseur = un fichier** + une ligne dans le registre.
- **Ajouter un pays = des lignes** (`countries`, `rails`), remplies par la synchronisation avec le fournisseur
  (SasPay `GET /countries/`, `/pricing/my-rates/` ; pawaPay `GET /v2/active-conf`), activées par l'admin.
- Trois niveaux d'activation : l'admin par environnement, l'app parmi ceux-là, la page affiche l'intersection.
- Sans pays ni wallet précisé, tout se passe comme aujourd'hui (Congo, wallet par défaut).

### 1.3 L'interface fournisseur élargie

```ts
interface PaymentProvider {
  name: string;
  configured(env): boolean;
  sync(env): Promise<RailInfo[]>;               // pays, moyens, limites, état
  collect(op): Promise<RailResult>;             // + redirectUrl / otpRequired selon le rail
  collectionStatus(op): Promise<RailResult>;
  payout?(op): Promise<RailResult>;
  payoutStatus?(op): Promise<RailResult>;
  refund?(op): Promise<RailResult>;             // natif chez pawaPay
  balances?(env): Promise<ProviderBalance[]>;   // par pays
  transfer?(op): Promise<TransferResult>;       // entre ses wallets pays (SasPay)
  transferStatus?(op): Promise<TransferResult>;
  verifyWebhook(req): boolean;
}
```

`RailOperation` gagne `country` et `method` (notre code) ; `network` disparaît. Rangement progressif :
`src/wallets/`, `src/rails/` (registre, routage, pays), `src/rails/providers/`, `src/rebalance/`.

---

## 2. Plusieurs wallets

### 2.1 Le modèle

- Une personne (`user:<uid>`) a **N wallets**, chacun avec un **nom** (« Principal », « Épargne », « Boutique »…)
  et un **pays par défaut** (celui de ses dépôts et retraits proposés en premier). Tous en FCFA.
- **Un wallet par défaut** : il reçoit quand rien n'est précisé.
- Même chose pour les apps : plusieurs wallets ; le défaut reste celui d'aujourd'hui.
- Nombre maximum de wallets par personne : admin (« Contrôle »).

### 2.2 La base

Fait (phase A, migration 027) :

- Colonnes `owner_id` (« user:<uid> »), `label`, `country`, `is_default`. La clé unique
  `(app_id, account_id, currency, environment)` reste : le premier wallet garde `account_id = owner_id`, les
  suivants prennent `"<owner_id>/w_<aléatoire>"`. Ainsi aucun `ON CONFLICT` existant ne change.
- Un seul défaut par personne et par monnaie : index unique partiel `(app_id, owner_id, currency, environment)
  WHERE is_default`. Un déclencheur remplit `owner_id` pour les insertions qui ne le donnent pas.
- Les wallets en FCFA gardent `currency = 'XAF'` (unité interne commune) : **aucune migration de montant**.
  Chaque wallet de personne existant devient « Principal », `country = 'COG'`, défaut.
- Toute recherche passe par `src/wallets` (`userWallet`, `walletOf`, `listWallets`, `openWallet`,
  `renameWallet`, `setDefaultWallet`, `closeWallet`) : sans `id`, le défaut ; avec `id`, vérification du
  propriétaire.

### 2.3 Où arrive l'argent

| Opération | Wallet |
|---|---|
| Dépôt | Celui choisi ; opérateurs de n'importe quel pays ouvert (son pays par défaut en premier). |
| Envoyer à @nom | Débite le wallet choisi, crédite le défaut du destinataire. **Gratuit, quel que soit le pays.** |
| Payer (page de paiement, Connect) | Le wallet choisi, parmi ceux qui ont assez. |
| Connexion d'une app | Le wallet choisi au consentement (`connections.wallet_id` existe déjà). |
| Retirer | **Un retrait = un wallet = un seul envoi, en entier** ; vers un numéro de n'importe quel pays ouvert. |
| Entre mes wallets | Instantané, gratuit. |

- Jamais de retrait partiel ni de complément pris dans un autre wallet : pour retirer plus, la personne regroupe
  d'abord elle-même.
- Fermer un wallet : solde nul, aucun séquestre ni envoi en attente ; le défaut après avoir désigné un autre
  défaut.

### 2.4 Écrans et API

- **Compte** : les wallets en cartes (nom, solde), « Ouvrir un wallet ». Un wallet s'ouvre en écran à part.
  « Quel wallet » n'est demandé que s'il y en a plusieurs ; le pays se choisit au dépôt et au retrait (déduit du
  numéro, modifiable).
- **Console** : écran « Wallets » (`table()`), détail en écran à part. **Admin** : wallets sur la fiche de la
  personne, gel par wallet.
- **API** : `wallet_id` facultatif partout (absent → défaut), `GET/POST /wallets`. `/docs` dans la même livraison.

---

## 3. Un seul franc, plusieurs pays

### 3.1 Exemple : un acheteur au Cameroun, un vendeur au Congo

1. L'acheteur paie 500 FCFA par MTN Cameroun → l'argent arrive dans le **wallet SasPay Cameroun**. Grand livre :
   réserve SasPay Cameroun +500, séquestre de la vente +500.
2. La vente est validée → le vendeur est crédité de 500 − commission, l'app de sa commission. **Aucune conversion,
   aucun mouvement chez SasPay.**
3. Le vendeur retire 10 000 FCFA vers MTN Congo → l'envoi part du **wallet SasPay Congo** (ou pawaPay Congo si une
   règle le dit). Grand livre : réserve Congo −10 000.
4. Le Cameroun a maintenant un surplus, le Congo un manque : le **rééquilibrage** (§ 4.3) les remet à niveau, par
   gros montants, sans que personne ne le voie.

Dans les transactions de la personne : le pays et l'opérateur de chaque dépôt et retrait (« Dépôt — MTN
Cameroun », « Retrait — MTN Congo »). Jamais le fournisseur.

### 3.2 Les écritures

- **Une réserve par (fournisseur, pays), calculée** (fait, phase B) : le compte de transit unique
  (`SYSTEM_GATEWAY_INFLOW`) reste ; chaque écriture de transit est rattachée à son fournisseur et à son opérateur
  (donc à son pays), et la réserve d'un wallet fournisseur est la somme de ses écritures. Aucune écriture d'argent
  ne change, aucun script de migration du transit n'est nécessaire.
- La somme des réserves = l'argent de tout le monde (contrôle actuel, gardé). Chaque réserve se compare au solde
  réel du wallet fournisseur correspondant.
- Un rééquilibrage (phase E) est noté dans sa propre table (`provider_transfers` : sortie du pays A, entrée au
  pays B, frais « Frais fournisseur - transfert ») et entre dans ce calcul. Les wallets des personnes ne sont
  jamais touchés.

### 3.3 Frais

- **Envoi entre utilisateurs : 0.**
- **Dépôt et retrait : par pays et par opérateur**, dans « Frais et minimums » (rien en dur). Le frais de retrait
  d'un pays couvre aussi, en moyenne, ce que coûte son rééquilibrage (§ 4.3).
- **Commission d'une app** : fixée par l'app selon ses tarifs, calculée en FCFA sur le prix de la vente ; aucune
  conversion.

### 3.4 Pourquoi les petits malins n'y gagnent rien

- Il n'y a aucun taux entre deux personnes, ni entre deux pays CFA : déposer ici et retirer là rend exactement la
  même somme, moins les frais de dépôt et de retrait.
- Le seul coût caché est le rééquilibrage : couvert par le frais de retrait du pays, et surveillé (si un pays
  reçoit beaucoup de retraits « venus d'ailleurs », son frais monte dans l'admin).
- Plafonds dans « Contrôle » (retraits par jour, par personne) et frein d'urgence, comme aujourd'hui.

---

## 4. Inspection, routage, rééquilibrage

Principe : **l'argent reste chez le fournisseur qui l'a encaissé**, et chaque réserve se vide d'abord par ses
propres envois.

### 4.1 L'inspection (admin → Réserves)

Une ligne par **(fournisseur, pays)**, par environnement :

| Colonne | Source |
|---|---|
| Solde réel | Lu automatiquement : SasPay `GET /merchant-balances/`, pawaPay `GET /v2/wallet-balances` (toutes les N minutes + « Relever ») ; relevé manuel toujours possible. |
| Attendu | Solde de la réserve dans le grand livre. |
| Écart | Réel − attendu ; alerte au-delà d'un seuil. |
| En attente | Envois et remboursements qui partiront de ce wallet. |
| Disponible | Réel − en attente − minimum de sécurité. |
| Niveau cible | Réglé dans l'admin ; sous le seuil bas → alerte et rééquilibrage proposé. |

- Chaque ligne s'ouvre en écran à part : relevés, encaissements, envois, transferts SasPay
  (`GET /wallet-transfers/`).
- Une ligne en alerte s'affiche dans la barre latérale (compteur).
- Les relevés automatiques s'écrivent dans `provider_balance_checks` (colonne `country` ajoutée,
  `checked_by = 'auto'`) : une note, aucun argent ne bouge.

### 4.2 Les règles de routage (admin → Routage)

La première règle qui correspond gagne ; sinon SasPay. Une règle : sens (encaissement, envoi, remboursement),
type (paiement d'une boutique, dépôt, retrait), pays et opérateur du payeur, pays du destinataire, app
(facultatif) → fournisseur, avec « seulement si sa réserve suffit, sinon la règle suivante ».

Exemples :

1. *Payeur Congo (MTN ou Airtel) → boutique Congo* → **pawaPay** (moins de frais).
2. *Retrait vers un numéro Congo* → **pawaPay tant que sa réserve Congo suffit**, sinon SasPay : l'excédent pawaPay
   se vide par ses propres envois, jamais par un transfert.
3. *Tout le reste* → **SasPay**.
4. *Remboursement* → le fournisseur qui a encaissé (règle actuelle).

- **Simulateur** : on décrit une opération, il dit quelle règle, quel fournisseur et quels frais chez chacun.
- **Frais comparés** par rail : SasPay `GET /pricing/my-rates/` ; pawaPay saisi par l'admin (pas d'API de tarifs).
- Chaque opération garde la règle qui l'a routée (admin seulement). Règles en base (`routing_rules`), par
  environnement, chargées en mémoire comme `provider_settings`, modifications dans l'audit admin.

### 4.3 Le retrait et le rééquilibrage (SasPay)

```
retrait de X FCFA vers le pays P (fournisseur F choisi par le routage)
1. Disponible de F dans P ≥ X  → envoyer tout de suite
2. Sinon (F = SasPay) : candidats = ses autres wallets pays dont le disponible dépasse leur niveau cible
3. Trier : coût du transfert d'abord, puis le plus gros surplus
4. Transférer du premier vers P de quoi remonter P à son niveau cible (pas seulement X)
5. Envoyer dès que le transfert est COMPLETED ; la personne voit « en cours »
6. Aucun candidat → le retrait attend (délai avant retrait existant), l'admin est alerté
```

Ce que SasPay fait réellement (transferts du 22 octobre, Congo → Côte d'Ivoire → Cameroun → Togo) :

- **XAF ↔ XOF à 1 pour 1** (26 XAF → 26 XOF, 23 XAF → 23 XOF).
- **Frais 0,2 %, au moins 1 franc**, prélevés **sur le wallet qui reçoit**, sur une ligne à part.
- ⚠ Une ligne Côte d'Ivoire → Cameroun donne 25 XOF → 24 XAF avant frais : arrondi vers le bas ou taux
  légèrement sous 1. À vérifier (`exchange_rate` de `GET /wallet-transfers/{id}/`, ou un essai à 10 000).
- API : `POST /wallet-transfers/` (`from_country`, `to_country`, `from_amount`, en-tête `Idempotency-Key` toujours
  envoyé), statut `COMPLETED` / `PENDING` / `REJECTED`, rappels `wallet_transfer.*`. **Un seul transfert en
  attente à la fois** : LightPay les met en file.

Conséquences :

- **Rééquilibrer par gros montants** (niveaux cibles), jamais au retrait près : le minimum de 1 franc et les
  arrondis coûtent cher sur les petites sommes.
- Le rééquilibrage peut aussi partir tout seul, en dehors d'un retrait, quand un pays passe sous son seuil bas
  (réglage « automatique / sur validation de l'admin »).
- **pawaPay ne se rééquilibre pas** (aucune API de transfert) : il se vide par ses envois (règle 2) ou par le
  versement bancaire réglé dans son tableau de bord.

---

## 5. Les pays de départ

On commence avec les pays où SasPay a déjà fait des transferts réels :

| Pays | Monnaie | Opérateurs |
|---|---|---|
| Congo-Brazzaville | XAF | MTN, Airtel (SasPay et pawaPay) |
| Cameroun | XAF | MTN, Orange |
| Côte d'Ivoire | XOF | MTN, Orange, Moov, Wave |
| Togo | XOF | à lire par la synchronisation SasPay |

- Chaque pays s'active dans l'admin ; les autres pays CFA (Gabon, Sénégal, Bénin, Burkina) s'ajoutent ensuite sans
  code.
- Orange (OTP) et Wave (redirection) demandent leurs écrans d'attente : un pays peut ouvrir d'abord ses opérateurs
  « téléphone qui sonne » et le reste ensuite.

### Plus tard : hors zone CFA

RDC (CDF, USD), Afrique de l'Est : **taux fixés par nous** dans l'admin, ancrés sur l'euro, avec un taux d'achat
et un taux de vente ; le cours du marché affiché à côté, alerte si notre taux s'en écarte trop ; position de
change visible. Seuls ces pays portent un risque de change.

---

## 6. Ordre de livraison

| Phase | Contenu | Résultat |
|---|---|---|
| **A — Socle** ✓ | Module `wallets` (porte d'entrée unique, `label` / `country` / `is_default`), registres `countries` et `rails`, interface fournisseur élargie. | Rien ne change pour les gens. |
| **B — Réserves par pays + inspection** ✓ | Réserves par (fournisseur, pays) calculées depuis le transit, lecture automatique des soldes (SasPay, pawaPay), écart, disponible, minimum / seuil bas / niveau cible, alertes et compteur, écran par wallet fournisseur. | L'admin voit chaque wallet fournisseur. |
| **C — Routage** | Règles, simulateur, frais comparés ; SasPay par défaut, pawaPay pour le Congo → Congo. | Moins de frais sur le Congo. |
| **D — Pays de départ** | Cameroun, Côte d'Ivoire, Togo : dépôts et retraits, numéro international, choix du pays dans `flows.ts`. | Encaisser et retirer dans 4 pays. |
| **E — Rééquilibrage** | `transfer` SasPay, file d'attente, retrait qui attend son transfert, rééquilibrage automatique. | **L'exemple du § 3.1 marche de bout en bout.** |
| **F — Plusieurs wallets à l'écran** | Compte, console, admin, API `wallet_id`, ouverture / fermeture. | Une personne gère plusieurs wallets. |
| **G — Suite** | Écrans OTP et redirection (Orange, Wave), autres pays CFA, remboursements natifs pawaPay, puis hors CFA. | Activés dans l'admin. |

`/docs` est mise à jour à chaque phase ; chaque phase garde la compatibilité.

---

## 7. À vérifier

- **SasPay** : le 25 XOF → 24 XAF du 22 octobre (arrondi ou taux) ; approbation automatique des transferts sur notre
  compte ; opérateurs ouverts au Togo.
- **pawaPay** : grille de frais par opérateur au Congo (pour écrire les règles).
- **Non technique** : cadre légal de chaque pays de départ (monnaie électronique, anti-blanchiment, transferts
  entre CEMAC et UEMOA) et déclarations Google Play ; fonds de départ dans chaque wallet SasPay pays pour que les
  premiers retraits partent sans attendre.
