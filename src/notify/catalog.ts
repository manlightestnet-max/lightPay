/**
 * Répertoire des messages LightPay : ce que la personne lit pour chaque événement.
 *
 *   describeActivity(a)   la description d'une opération (liste, détail, e-mail) — jamais un simple
 *                         « LightPay » ou un identifiant : ce qui s'est passé, avec qui, par quel moyen.
 *   activityMessage(a, previous)   la notification (push, et e-mail quand `email`) quand une opération
 *                         change d'état : créée, réussie, refusée, bloquée, remboursée…
 *   ACCOUNT               les événements du compte (nouvelle connexion, app autorisée, suppression…).
 *
 * Tout est en français, court, sans nom de fournisseur (SasPay, pawaPay n'apparaissent jamais).
 * docs/notifications.md liste chaque cas ; garder les deux en accord.
 */

export interface ActivityRow {
  id: string;
  wallet_id?: string;
  kind: string;
  direction: 'IN' | 'OUT' | string;
  status: string;
  amount: string | number | bigint;
  fees?: string | number | bigint | null;
  total?: string | number | bigint | null;
  currency?: string | null;
  counterparty?: string | null;
  reason?: string | null;
  reason_code?: string | null;
  ref_type?: string | null;
  metadata?: Record<string, any> | null;
}

/** Un message : titre et texte (push), e-mail en plus si `email`. `route` : l'écran que l'app ouvre. */
export interface Message {
  event: string;
  title: string;
  body: string;
  email: boolean;
  route?: string;
}

/** « 12 450 FCFA » (espace insécable que Poppins dessine). */
export const money = (v: unknown, currency?: string | null) =>
  Number(v ?? 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' ' + (!currency || currency === 'XAF' ? 'FCFA' : currency);

const who = (a: ActivityRow) => (a.counterparty ?? '').trim();
const ref = (a: ActivityRow) => (a.metadata?.reference ? ` · réf. ${a.metadata.reference}` : '');
const note = (a: ActivityRow) => (a.metadata?.note ? ` « ${a.metadata.note} »` : '');
/** Ce qui a quitté le wallet (frais compris) pour une sortie ; ce qui est arrivé pour une entrée. */
const walletAmount = (a: ActivityRow) =>
  a.direction !== 'IN' && a.total != null && Number(a.total) > Number(a.amount) ? a.total : a.amount;
/** Versement fait par LightPay elle-même (administration). */
const fromLightPay = (a: ActivityRow) => who(a) === 'LightPay';

/**
 * Description d'une opération, telle que la personne la lit.
 *   DEPOSIT     Dépôt depuis MTN MoMo · +242 06 ••• •• 81
 *   WITHDRAWAL  Retrait vers Airtel Money · +242 05 ••• •• 12
 *   TRANSFER    Argent reçu de Awa K. « loyer » | Envoi à @jean « loyer » | Versement de LightPay
 *   PAYMENT     Paiement à Boutique · réf. CMD-12
 *   CHARGE      Débit automatique par Boutique
 *   SALE        Vente sur Boutique · réf. CMD-12
 *   COMMISSION  Commission de Boutique sur une vente de 18 000 FCFA
 *   REFUND      Remboursement de votre achat chez Boutique · réf. CMD-12 | Remboursement envoyé vers MTN MoMo · +242 …
 */
export function describeActivity(a: ActivityRow): string {
  const w = who(a);
  switch (a.kind) {
    case 'DEPOSIT':
      return w ? `Dépôt depuis ${w}` : 'Dépôt sur votre wallet';
    case 'WITHDRAWAL':
      return w ? `Retrait vers ${w}` : 'Retrait vers un compte mobile money';
    case 'TRANSFER':
      if (a.direction === 'IN') return fromLightPay(a) ? `Versement de LightPay${note(a)}` : `Argent reçu de ${w || 'un compte LightPay'}${note(a)}`;
      return `Envoi à ${w || 'un compte LightPay'}${note(a)}`;
    case 'PAYMENT':
      return `Paiement à ${w || 'un marchand'}${ref(a)}`;
    case 'CHARGE':
      return `Débit automatique par ${w || 'une app connectée'}${ref(a)}`;
    case 'SALE':
      return `Vente sur ${w || 'une app connectée'}${ref(a)}`;
    case 'COMMISSION':
      return a.metadata?.sale_amount
        ? `Commission de ${w || 'l’app'} sur une vente de ${money(a.metadata.sale_amount, a.currency)}`
        : `Commission de ${w || 'l’app'} sur une vente`;
    case 'REFUND':
      return a.direction === 'IN'
        ? `Remboursement de votre achat chez ${w || 'un marchand'}${ref(a)}`
        : `Remboursement envoyé vers ${w || 'l’acheteur'}${ref(a)}`;
    default:
      return w ? `${a.kind} · ${w}` : a.kind;
  }
}

const reasonOr = (a: ActivityRow, fallback: string) => (a.reason && a.reason.trim() ? a.reason.trim() : fallback);

/**
 * La notification d'une opération qui change d'état (`previous` : son état d'avant, null si nouvelle).
 * Null quand rien ne mérite d'être dit (ex. un dépôt qui démarre : la personne est devant l'écran).
 */
export function activityMessage(a: ActivityRow, previous: string | null): Message | null {
  const m = money(walletAmount(a), a.currency);
  const w = who(a);
  const route = `/activity/${encodeURIComponent(a.id)}`;
  const msg = (event: string, title: string, body: string, email = true): Message => ({ event, title, body, email, route });
  const isNew = previous === null;
  const now = a.status;

  switch (a.kind) {
    case 'DEPOSIT':
      if (now === 'SUCCEEDED') return msg('deposit.succeeded', 'Dépôt reçu', `${m} ajoutés à votre wallet${w ? ` depuis ${w}` : ''}.`);
      if (now === 'FAILED' || now === 'EXPIRED' || now === 'CANCELLED')
        return msg('deposit.failed', 'Dépôt non effectué', reasonOr(a, 'L’opérateur n’a pas confirmé le paiement. Aucun argent n’a été pris.'), false);
      return null;

    case 'TRANSFER':
      if (a.direction === 'IN' && now === 'SUCCEEDED')
        return fromLightPay(a)
          ? msg('transfer.received', 'Versement de LightPay', `LightPay vous a versé ${m}.${note(a)}`)
          : msg('transfer.received', 'Argent reçu', `${w || 'Un compte LightPay'} vous a envoyé ${m}.${note(a)}`);
      if (a.direction !== 'IN' && now === 'SUCCEEDED') return msg('transfer.sent', 'Argent envoyé', `${m} envoyés à ${w || 'un compte LightPay'}.`);
      if (a.direction !== 'IN' && now === 'FAILED') return msg('transfer.failed', 'Envoi non effectué', reasonOr(a, 'L’envoi a été refusé.'), false);
      return null;

    case 'WITHDRAWAL':
      if (now === 'PENDING' && isNew) return msg('withdrawal.requested', 'Retrait demandé', `${m} débités de votre wallet pour un retrait ${w ? `vers ${w}` : ''}.`.replace(' .', '.'));
      if (now === 'SUCCEEDED') return msg('withdrawal.sent', 'Retrait envoyé', `${money(a.amount, a.currency)} envoyés ${w ? `vers ${w}` : 'sur votre mobile money'}. Vous allez recevoir un SMS de votre opérateur.`);
      if (now === 'FAILED' && !isNew)
        return msg('withdrawal.failed', 'Retrait échoué', `${reasonOr(a, 'L’opérateur a refusé l’envoi.')} Les ${m} ont été restitués sur votre wallet.`);
      if (now === 'FAILED' && isNew) return msg('withdrawal.refused', 'Retrait refusé', reasonOr(a, 'Le retrait n’a pas pu être fait.'), false);
      if (now === 'CANCELLED') return msg('withdrawal.cancelled', 'Retrait annulé', `${reasonOr(a, 'Envoi annulé par LightPay après vérification.')} Les ${m} ont été restitués sur votre wallet.`);
      return null;

    case 'PAYMENT':
      if (now === 'SUCCEEDED' || (now === 'LOCKED' && isNew)) return msg('payment.succeeded', 'Paiement effectué', `${m} payés à ${w || 'un marchand'}${ref(a)}.`);
      if (now === 'FAILED') return msg('payment.failed', 'Paiement non effectué', reasonOr(a, 'Le paiement a été refusé.'), false);
      if (now === 'REFUNDED') return msg('payment.refunded', 'Paiement remboursé', `${w || 'Le marchand'} vous a remboursé ${money(a.amount, a.currency)}${ref(a)}.`);
      return null;

    case 'CHARGE':
      if (now === 'SUCCEEDED' || (now === 'LOCKED' && isNew)) return msg('charge.succeeded', `Débit par ${w || 'une app'}`, `${w || 'Une app connectée'} a débité ${m} de votre wallet${ref(a)}.`);
      if (now === 'FAILED') return msg('charge.failed', 'Débit refusé', `${w || 'Une app connectée'} : ${reasonOr(a, 'débit refusé.')}`, false);
      if (now === 'REFUNDED') return msg('charge.refunded', 'Débit remboursé', `${w || 'L’app'} vous a remboursé ${money(a.amount, a.currency)}.`);
      return null;

    case 'SALE':
      if (now === 'LOCKED' && isNew) return msg('sale.received', 'Nouvelle vente', `${m} sur ${w || 'une app connectée'}${ref(a)}, bloqués jusqu’à la livraison.`);
      if (now === 'LOCKED' && a.reason_code === 'DISPUTED') return msg('sale.disputed', 'Litige ouvert', `${m}${ref(a)} : fonds gelés jusqu’à la décision.`);
      if (now === 'SUCCEEDED') return msg('sale.released', 'Vente validée', `${m} de ${w || 'votre vente'}${ref(a)} sont disponibles dans votre wallet.`);
      if (now === 'REFUNDED') return msg('sale.refunded', 'Vente annulée', `${reasonOr(a, 'Commande annulée : le montant a été rendu à l’acheteur.')}${ref(a)}`);
      return null;

    case 'COMMISSION':
      if (now === 'SUCCEEDED') return msg('commission.taken', 'Commission prélevée', `${w || 'L’app'} a retenu ${m} sur votre vente${ref(a)}.`, false);
      return null;

    case 'REFUND':
      if (a.direction === 'IN' && now === 'SUCCEEDED') return msg('refund.received', 'Remboursement reçu', `${w || 'Un marchand'} vous a remboursé ${m}${ref(a)}.`);
      if (a.direction !== 'IN' && now === 'PENDING' && isNew) return msg('refund.requested', 'Remboursement en cours', `${m} débités pour un remboursement ${w ? `vers ${w}` : ''}.`.replace(' .', '.'));
      if (a.direction !== 'IN' && now === 'SUCCEEDED') return msg('refund.sent', 'Remboursement envoyé', `${money(a.amount, a.currency)} remboursés${w ? ` vers ${w}` : ''}.`);
      if (a.direction !== 'IN' && (now === 'FAILED' || now === 'CANCELLED'))
        return msg('refund.failed', 'Remboursement non effectué', `${reasonOr(a, 'L’opérateur a refusé l’envoi.')} Les ${m} ont été restitués sur votre wallet.`);
      return null;

    default:
      return null;
  }
}

/** Événements du compte (hors opérations d'argent). */
export const ACCOUNT = {
  signIn: (device: string, when: string, place: string | null): Message => ({
    event: 'account.sign_in',
    title: 'Nouvelle connexion',
    body: `Connexion à votre compte LightPay depuis ${device}, le ${when}${place ? ` (${place})` : ''}. Si ce n’est pas vous, sécurisez votre compte Google (changez son mot de passe) : c’est lui qui ouvre LightPay.`,
    email: true,
    route: '/account',
  }),
  appAuthorized: (app: string, scopes: string[]): Message => ({
    event: 'account.app_authorized',
    title: 'App autorisée',
    body: `${app} peut maintenant utiliser votre compte LightPay${scopes.length ? ` : ${scopes.join(', ')}` : ''}. Vous pouvez retirer cet accès à tout moment depuis Compte > Apps connectées.`,
    email: true,
    route: '/account/apps',
  }),
  appRevoked: (app: string): Message => ({
    event: 'account.app_revoked',
    title: 'Accès retiré',
    body: `${app} n’a plus accès à votre compte LightPay.`,
    email: true,
    route: '/account/apps',
  }),
  usernameChanged: (username: string): Message => ({
    event: 'account.username',
    title: 'Nom d’utilisateur modifié',
    body: `On vous envoie maintenant de l’argent avec @${username}.`,
    email: true,
    route: '/account',
  }),
  accountClosed: (): Message => ({
    event: 'account.closed',
    title: 'Compte supprimé',
    body: 'Votre compte LightPay a été fermé. Les apps connectées ont perdu leur accès ; l’historique comptable est conservé.',
    email: true,
  }),
  withdrawalsSuspended: (until: string, auto: boolean): Message => ({
    event: 'account.withdrawals_suspended',
    title: 'Retraits et envois suspendus',
    body: auto
      ? `Trop de tentatives de retrait : par sécurité, les retraits et les envois de votre compte sont suspendus jusqu’à ${until}.`
      : `Les retraits et les envois de votre compte sont suspendus jusqu’à ${until}. Contactez le support LightPay.`,
    email: true,
    route: '/home',
  }),
};
