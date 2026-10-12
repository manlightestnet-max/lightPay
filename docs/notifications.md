# Messagerie automatique LightPay — répertoire des messages

Chaque événement du compte d’une personne produit un message : une **notification push** sur tous
ses téléphones où l’app LightPay est connectée (même app fermée ; un appui ouvre l’app sur le bon
écran) et, quand la colonne « E-mail » le dit, un **e-mail** à son adresse Google.

- Code : `src/notify/catalog.ts` (textes), `src/notify/index.ts` (envoi), `src/notify/push.ts`
  (Firebase Cloud Messaging), `src/notify/email.ts` (Resend).
- Déclencheurs : chaque ligne du journal d’activité (`logActivity` / `updateActivity`, donc **toutes**
  les opérations, quelle que soit la route qui les crée) et les routes du compte (`/v1/me/*`).
- Un événement = un message, jamais deux (`notification_log.event_key`) : un webhook rejoué, un
  sweeper ou une nouvelle tentative ne renotifie pas.
- Rien ne bloque ni ne fait échouer l’opération : l’envoi part après la réponse.
- Environnement de test : titres préfixés « [Test] », push seulement aux téléphones en mode test.
- Les fournisseurs (SasPay, pawaPay) ne sont jamais nommés.

`{montant}` : ce qui a quitté le wallet (frais compris) pour une sortie, ce qui est arrivé pour une
entrée. `{qui}` : la contrepartie (nom de l’app, de la personne, ou « MTN MoMo · +242 06 ••• •• 81 »).
`{réf}` : « · réf. CMD-12 » si l’opération a une référence.

## 1. Opérations d’argent

| Type | Quand | Titre | Texte | E-mail |
|---|---|---|---|---|
| Dépôt | réussi | Dépôt reçu | {montant} ajoutés à votre wallet depuis {qui}. | oui |
| Dépôt | refusé / expiré / annulé | Dépôt non effectué | {raison} (sinon : L’opérateur n’a pas confirmé le paiement. Aucun argent n’a été pris.) | non |
| Envoi reçu | réussi | Argent reçu | {qui} vous a envoyé {montant}. « message » | oui |
| Versement LightPay | réussi | Versement de LightPay | LightPay vous a versé {montant}. « message » | oui |
| Envoi fait | réussi | Argent envoyé | {montant} envoyés à {qui}. | oui |
| Envoi fait | refusé | Envoi non effectué | {raison} | non |
| Retrait | demandé | Retrait demandé | {montant} débités de votre wallet pour un retrait vers {qui}. | oui |
| Retrait | envoyé | Retrait envoyé | {montant reçu} envoyés vers {qui}. Vous allez recevoir un SMS de votre opérateur. | oui |
| Retrait | échoué après envoi | Retrait échoué | {raison} Les {montant} ont été restitués sur votre wallet. | oui |
| Retrait | refusé tout de suite | Retrait refusé | {raison} | non |
| Retrait | annulé par LightPay | Retrait annulé | {raison} Les {montant} ont été restitués sur votre wallet. | oui |
| Paiement (achat) | effectué | Paiement effectué | {montant} payés à {qui}{réf}. | oui |
| Paiement (achat) | refusé | Paiement non effectué | {raison} | non |
| Paiement (achat) | remboursé | Paiement remboursé | {qui} vous a remboursé {montant}{réf}. | oui |
| Débit par une app | effectué | Débit par {qui} | {qui} a débité {montant} de votre wallet{réf}. | oui |
| Débit par une app | refusé | Débit refusé | {qui} : {raison} | non |
| Débit par une app | remboursé | Débit remboursé | {qui} vous a remboursé {montant}. | oui |
| Vente | nouvelle (bloquée) | Nouvelle vente | {montant} sur {qui}{réf}, bloqués jusqu’à la livraison. | oui |
| Vente | litige | Litige ouvert | {montant}{réf} : fonds gelés jusqu’à la décision. | oui |
| Vente | validée | Vente validée | {montant} de {qui}{réf} sont disponibles dans votre wallet. | oui |
| Vente | annulée | Vente annulée | Commande annulée : le montant a été rendu à l’acheteur.{réf} | oui |
| Commission | prélevée | Commission prélevée | {qui} a retenu {montant} sur votre vente{réf}. | non |
| Remboursement reçu | réussi | Remboursement reçu | {qui} vous a remboursé {montant}{réf}. | oui |
| Remboursement envoyé | demandé | Remboursement en cours | {montant} débités pour un remboursement vers {qui}. | oui |
| Remboursement envoyé | envoyé | Remboursement envoyé | {montant} remboursés vers {qui}. | oui |
| Remboursement envoyé | échoué / annulé | Remboursement non effectué | {raison} Les {montant} ont été restitués sur votre wallet. | oui |

Un appui sur ces notifications ouvre le détail de l’opération (`/activity/<id>` dans l’app,
`/account#/activity/<id>` sur le web).

## 2. Compte et sécurité

| Événement | Titre | Texte | E-mail |
|---|---|---|---|
| Connexion depuis un appareil jamais utilisé | Nouvelle connexion | Connexion à votre compte LightPay depuis {appareil}, le {date}. Si ce n’est pas vous, sécurisez votre compte Google (changez son mot de passe) : c’est lui qui ouvre LightPay. | oui |
| App autorisée (LightPay Connect) | App autorisée | {app} peut maintenant utiliser votre compte LightPay : {permissions}. Vous pouvez retirer cet accès à tout moment depuis Compte > Apps connectées. | oui |
| Accès d’une app retiré | Accès retiré | {app} n’a plus accès à votre compte LightPay. | oui |
| @nom changé | Nom d’utilisateur modifié | On vous envoie maintenant de l’argent avec @{nom}. | oui |
| Retraits suspendus (trop de tentatives) | Retraits et envois suspendus | Trop de tentatives de retrait : par sécurité, les retraits et les envois de votre compte sont suspendus jusqu’à {heure}. | oui |
| Retraits suspendus (par LightPay) | Retraits et envois suspendus | Les retraits et les envois de votre compte sont suspendus jusqu’à {heure}. Contactez le support LightPay. | oui |
| Compte supprimé | Compte supprimé | Votre compte LightPay a été fermé. Les apps connectées ont perdu leur accès ; l’historique comptable est conservé. | oui |

{appareil} : « l’app LightPay Android », « Chrome sur Windows », « Safari sur iPhone »… Le premier
appareil connu d’une personne n’est pas annoncé (création du compte) ; une reconfirmation sur le
même appareil (action sensible) non plus.

## 3. Description de chaque opération (liste, détail, e-mail)

Chaque ligne de `/v1/me/activity` porte `description` : ce qui s’est passé, jamais un simple
« LightPay » ou un identifiant (le n° d’opération reste en bas du détail).

| Type | Description |
|---|---|
| Dépôt | Dépôt depuis MTN MoMo · +242 06 ••• •• 81 |
| Retrait | Retrait vers Airtel Money · +242 05 ••• •• 12 |
| Envoi reçu | Argent reçu de Awa K. « loyer » |
| Versement de l’administration | Versement de LightPay « message » |
| Envoi fait | Envoi à Jean M. « loyer » |
| Paiement | Paiement à Boutique · réf. CMD-12 |
| Débit par une app | Débit automatique par Boutique · réf. … |
| Vente | Vente sur Boutique · réf. CMD-12 |
| Commission | Commission de Boutique sur une vente de 18 000 FCFA |
| Remboursement reçu | Remboursement de votre achat chez Boutique · réf. CMD-12 |
| Remboursement envoyé | Remboursement envoyé vers MTN MoMo · +242 06 ••• •• 81 |

## 4. Configuration (Render)

| Variable | Rôle |
|---|---|
| `LIGHTPAY_FCM_SERVICE_ACCOUNT` | Clé du compte de service Firebase du projet `lightpay-a5f01` (JSON, brut ou base64). Console Firebase > Paramètres du projet > Comptes de service > Générer une clé. Sans elle : pas de push. |
| `RESEND_API_KEY` | Clé API Resend. Sans elle : pas d’e-mail. |
| `LIGHTPAY_MAIL_FROM` | Expéditeur sur un domaine vérifié dans Resend, ex. `LightPay <notifications@smlab.xyz>`. |
| `LIGHTPAY_ACCOUNT_URL` | (facultatif) lien « Ouvrir LightPay » des e-mails ; défaut `CHECKOUT_BASE_URL/account`. |
| `LIGHTPAY_ANDROID_SHA256` | Empreintes SHA-256 du certificat de l’app (séparées par des virgules) : `/.well-known/assetlinks.json`, pour que les liens `/connect` et `/pay/<id>` ouvrent l’app. |

Le téléphone s’inscrit lui-même : `POST /v1/me/devices { token, platform, label }` après la
connexion, `DELETE /v1/me/devices { token }` à la déconnexion ou quand les notifications sont
coupées dans Compte.
