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
import { renderTemplate } from './templates.js';

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
  /** Titre de la notification (le montant signé quand de l'argent bouge). */
  title: string;
  /** Texte : ce qui s'est passé, puis le détail (lignes séparées par 
). */
  body: string;
  /** Objet de l'e-mail (le titre si absent). */
  subject?: string;
  /** Notification push (l'admin peut la couper par message). */
  push?: boolean;
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
 * Null quand rien ne mérite d'être dit (ex. un dépôt qui démarre : la personne est devant l'écran)
 * ou quand l'admin a coupé ce message. Les textes sont des modèles (templates.ts), modifiables
 * depuis l'administration > Messages ; ici on choisit l'événement et ses valeurs.
 */
export function activityMessage(a: ActivityRow, previous: string | null): Message | null {
  const total = money(walletAmount(a), a.currency);
  const w = who(a);
  const isNew = previous === null;
  const now = a.status;
  const vars = (fallbackWho: string, fallbackReason = '', sign: '+' | '−' | '' = '') => ({
    montant: total,
    montant_signe: `${sign}${total}`,
    montant_recu: money(a.amount, a.currency),
    qui: w || fallbackWho,
    ref: ref(a),
    message: note(a),
    raison: reasonOr(a, fallbackReason),
  });
  const ev = (event: string, v: Record<string, string>) => fromTemplate(event, v, `/activity/${encodeURIComponent(a.id)}`);

  switch (a.kind) {
    case 'DEPOSIT':
      if (now === 'SUCCEEDED') return ev('deposit.succeeded', vars('votre mobile money', '', '+'));
      if (now === 'FAILED' || now === 'EXPIRED' || now === 'CANCELLED')
        return ev('deposit.failed', vars('votre mobile money', 'L’opérateur n’a pas confirmé le paiement. Aucun argent n’a été pris.'));
      return null;

    case 'TRANSFER':
      if (a.direction === 'IN' && now === 'SUCCEEDED') return ev(fromLightPay(a) ? 'transfer.lightpay' : 'transfer.received', vars('un compte LightPay', '', '+'));
      if (a.direction !== 'IN' && now === 'SUCCEEDED') return ev('transfer.sent', vars('un compte LightPay', '', '−'));
      if (a.direction !== 'IN' && now === 'FAILED') return ev('transfer.failed', vars('un compte LightPay', 'L’envoi a été refusé.'));
      return null;

    case 'WITHDRAWAL':
      if (now === 'PENDING' && isNew) return ev('withdrawal.requested', vars('votre mobile money', '', '−'));
      if (now === 'SUCCEEDED') return ev('withdrawal.sent', vars('votre mobile money', '', '−'));
      if (now === 'FAILED' && !isNew) return ev('withdrawal.failed', vars('votre mobile money', 'L’opérateur a refusé l’envoi.', '+'));
      if (now === 'FAILED' && isNew) return ev('withdrawal.refused', vars('votre mobile money', 'Le retrait n’a pas pu être fait.'));
      if (now === 'CANCELLED') return ev('withdrawal.cancelled', vars('votre mobile money', 'Envoi annulé par LightPay après vérification.', '+'));
      return null;

    case 'PAYMENT':
      if (now === 'SUCCEEDED' || (now === 'LOCKED' && isNew)) return ev('payment.succeeded', vars('un marchand', '', '−'));
      if (now === 'FAILED') return ev('payment.failed', vars('un marchand', 'Le paiement a été refusé.'));
      if (now === 'REFUNDED') return ev('payment.refunded', { ...vars('le marchand', '', '+'), montant_signe: `+${money(a.amount, a.currency)}` });
      return null;

    case 'CHARGE':
      if (now === 'SUCCEEDED' || (now === 'LOCKED' && isNew)) return ev('charge.succeeded', vars('une app connectée', '', '−'));
      if (now === 'FAILED') return ev('charge.failed', vars('une app connectée', 'débit refusé.'));
      if (now === 'REFUNDED') return ev('charge.refunded', { ...vars('l’app', '', '+'), montant_signe: `+${money(a.amount, a.currency)}` });
      return null;

    case 'SALE':
      if (now === 'LOCKED' && isNew) return ev('sale.received', vars('une app connectée', '', '+'));
      if (now === 'LOCKED' && a.reason_code === 'DISPUTED') return ev('sale.disputed', vars('une app connectée'));
      if (now === 'SUCCEEDED') return ev('sale.released', vars('une app connectée', '', '+'));
      if (now === 'REFUNDED') return ev('sale.refunded', vars('une app connectée', 'Commande annulée : le montant a été rendu à l’acheteur.'));
      return null;

    case 'COMMISSION':
      if (now === 'SUCCEEDED') return ev('commission.taken', vars('l’app', '', '−'));
      return null;

    case 'REFUND':
      if (a.direction === 'IN' && now === 'SUCCEEDED') return ev('refund.received', vars('un marchand', '', '+'));
      if (a.direction !== 'IN' && now === 'PENDING' && isNew) return ev('refund.requested', vars('l’acheteur', '', '−'));
      if (a.direction !== 'IN' && now === 'SUCCEEDED') return ev('refund.sent', vars('l’acheteur', '', '−'));
      if (a.direction !== 'IN' && (now === 'FAILED' || now === 'CANCELLED')) return ev('refund.failed', vars('l’acheteur', 'L’opérateur a refusé l’envoi.', '+'));
      return null;

    default:
      return null;
  }
}

/** Un modèle rempli (null si l'admin l'a coupé). */
export function fromTemplate(event: string, vars: Record<string, string>, route?: string): Message | null {
  const r = renderTemplate(event, vars);
  return r ? { event, title: r.title, body: r.body, subject: r.subject, push: r.push, email: r.email, route } : null;
}

/** Événements du compte (hors opérations d'argent). */
export const ACCOUNT = {
  signIn: (device: string, when: string) => fromTemplate('account.sign_in', { appareil: device, date: when }, '/account'),
  appAuthorized: (app: string, scopes: string[]) => fromTemplate('account.app_authorized', { app, permissions: scopes.join(', ') || 'utiliser votre compte' }, '/account/apps'),
  appRevoked: (app: string) => fromTemplate('account.app_revoked', { app }, '/account/apps'),
  usernameChanged: (username: string) => fromTemplate('account.username', { nom: username }, '/account'),
  withdrawalsSuspended: (until: string, auto: boolean) => fromTemplate(auto ? 'account.withdrawals_suspended' : 'account.withdrawals_suspended_manual', { heure: until }, '/home'),
  accountClosed: () => fromTemplate('account.closed', {}),
};
