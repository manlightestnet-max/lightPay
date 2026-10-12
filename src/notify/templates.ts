import { query } from '../db/pool.js';
import { Environment } from '../types/index.js';

/**
 * Message templates: every automatic message (push + e-mail) is a template the admin can rewrite
 * from the administration (« Messages »), turn its push / e-mail on or off, or switch off.
 * The texts below are the originals (« Rétablir le texte d'origine » brings them back).
 *
 *   {montant}        what left or reached the wallet           « 1 000 FCFA »
 *   {montant_signe}  the same, signed                          « +1 000 FCFA » / « −1 000 FCFA »
 *   {montant_recu}   what reached the phone (withdrawals)      « 5 000 FCFA »
 *   {qui}            the other side                            « Man Light », « MTN MoMo · +242 06 ••• •• 81 »
 *   {ref}            the order reference, if any               « · réf. CMD-12 » (empty otherwise)
 *   {message}        the sender's message, if any              « « loyer » » (empty otherwise)
 *   {raison}         why it was refused                        « Solde insuffisant… »
 *   account events: {appareil} {date} {app} {permissions} {nom} {heure}
 *
 * Overrides live in the production database (table message_templates, one row): the same texts
 * for real and test. Read at startup, every minute and right after a save.
 */

export interface Template {
  title: string;
  body: string;
  subject: string;
  push: boolean;
  email: boolean;
  enabled: boolean;
}

export interface TemplateDef extends Template {
  event: string;
  group: string;
  /** When it is sent, in the admin's words. */
  label: string;
  vars: string[];
}

const MONEY_IN = ['montant_signe', 'montant', 'qui', 'ref', 'message'];
const MONEY_OUT = ['montant_signe', 'montant', 'qui', 'ref', 'message'];

const def = (event: string, group: string, label: string, vars: string[], title: string, body: string, subject: string, email = true): TemplateDef => ({
  event, group, label, vars, title, body, subject, push: true, email, enabled: true,
});

/** The originals, in the order the admin sees them. */
export const DEFAULT_TEMPLATES: TemplateDef[] = [
  // ---------------------------------------------------------------- deposits
  def('deposit.succeeded', 'Dépôts', 'Dépôt réussi', MONEY_IN, '{montant_signe}', 'Dépôt reçu avec succès\nDepuis {qui}. Le montant a été ajouté à votre solde.', 'Dépôt reçu avec succès · {montant_signe}'),
  def('deposit.failed', 'Dépôts', 'Dépôt refusé, expiré ou annulé', ['montant', 'qui', 'raison'], 'Dépôt non effectué', '{raison}', 'Dépôt non effectué', false),

  // ---------------------------------------------------------------- transfers
  def('transfer.received', 'Envois', 'Argent reçu d’un compte LightPay', MONEY_IN, '{montant_signe}', 'Argent reçu avec succès\nDe {qui}{message}. Le montant a été ajouté à votre solde.', 'Argent reçu avec succès · {montant_signe}'),
  def('transfer.lightpay', 'Envois', 'Versement fait par LightPay (administration)', MONEY_IN, '{montant_signe}', 'Versement de LightPay reçu\nLe montant a été ajouté à votre solde.{message}', 'Versement de LightPay reçu · {montant_signe}'),
  def('transfer.sent', 'Envois', 'Argent envoyé', MONEY_OUT, '{montant_signe}', 'Argent envoyé avec succès\nÀ {qui}{message}.', 'Argent envoyé avec succès · {montant_signe}'),
  def('transfer.failed', 'Envois', 'Envoi refusé', ['montant', 'qui', 'raison'], 'Envoi non effectué', '{raison}', 'Envoi non effectué', false),

  // ---------------------------------------------------------------- withdrawals
  def('withdrawal.requested', 'Retraits', 'Retrait demandé (argent débité)', ['montant_signe', 'montant', 'montant_recu', 'qui'], '{montant_signe}', 'Retrait en préparation\n{montant_recu} vers {qui}. Le montant a été débité de votre solde, frais compris.', 'Retrait en préparation · {montant_signe}'),
  def('withdrawal.sent', 'Retraits', 'Retrait arrivé sur le téléphone', ['montant_signe', 'montant', 'montant_recu', 'qui'], '{montant_signe}', 'Retrait envoyé avec succès\n{montant_recu} envoyés vers {qui}. Vous allez recevoir un SMS de votre opérateur.', 'Retrait envoyé avec succès · {montant_signe}'),
  def('withdrawal.failed', 'Retraits', 'Retrait échoué après l’envoi (argent rendu)', ['montant_signe', 'montant', 'qui', 'raison'], '{montant_signe}', 'Retrait échoué\n{raison} Le montant a été restitué sur votre solde.', 'Retrait échoué · {montant_signe}'),
  def('withdrawal.refused', 'Retraits', 'Retrait refusé tout de suite', ['montant', 'qui', 'raison'], 'Retrait refusé', '{raison}', 'Retrait refusé', false),
  def('withdrawal.cancelled', 'Retraits', 'Retrait annulé par LightPay (argent rendu)', ['montant_signe', 'montant', 'qui', 'raison'], '{montant_signe}', 'Retrait annulé\n{raison} Le montant a été restitué sur votre solde.', 'Retrait annulé · {montant_signe}'),

  // ---------------------------------------------------------------- payments and charges
  def('payment.succeeded', 'Paiements et débits', 'Achat payé avec le wallet', MONEY_OUT, '{montant_signe}', 'Paiement effectué avec succès\nÀ {qui}{ref}.', 'Paiement effectué avec succès · {montant_signe}'),
  def('payment.failed', 'Paiements et débits', 'Achat refusé', ['montant', 'qui', 'ref', 'raison'], 'Paiement non effectué', '{raison}', 'Paiement non effectué', false),
  def('payment.refunded', 'Paiements et débits', 'Achat remboursé', MONEY_IN, '{montant_signe}', 'Paiement remboursé\nPar {qui}{ref}. Le montant a été ajouté à votre solde.', 'Paiement remboursé · {montant_signe}'),
  def('charge.succeeded', 'Paiements et débits', 'Débit par une app connectée', MONEY_OUT, '{montant_signe}', 'Débit par {qui}\n{qui} a débité votre wallet{ref}.', 'Débit par {qui} · {montant_signe}'),
  def('charge.failed', 'Paiements et débits', 'Débit d’une app refusé', ['montant', 'qui', 'ref', 'raison'], 'Débit refusé', '{qui} : {raison}', 'Débit refusé', false),
  def('charge.refunded', 'Paiements et débits', 'Débit d’une app remboursé', MONEY_IN, '{montant_signe}', 'Débit remboursé\nPar {qui}. Le montant a été ajouté à votre solde.', 'Débit remboursé · {montant_signe}'),

  // ---------------------------------------------------------------- sales
  def('sale.paid', 'Ventes', 'Vente payée (sans séquestre : argent disponible)', MONEY_IN, '{montant_signe}', 'Paiement reçu avec succès\nVente sur {qui}{ref}. Le montant a été ajouté à votre solde.', 'Paiement reçu avec succès · {montant_signe}'),
  def('sale.received', 'Ventes', 'Nouvelle vente (argent bloqué)', MONEY_IN, '{montant_signe}', 'Nouvelle vente sur {qui}\nLe montant est bloqué jusqu’à la livraison{ref}.', 'Nouvelle vente sur {qui} · {montant_signe}'),
  def('sale.disputed', 'Ventes', 'Litige ouvert sur une vente', ['montant', 'qui', 'ref'], '{montant}', 'Litige ouvert\nFonds gelés jusqu’à la décision{ref}.', 'Litige ouvert · {montant}'),
  def('sale.released', 'Ventes', 'Vente validée (argent disponible)', MONEY_IN, '{montant_signe}', 'Vente validée avec succès\nSur {qui}{ref}. Le montant a été ajouté à votre solde disponible.', 'Vente validée avec succès · {montant_signe}'),
  def('sale.refunded', 'Ventes', 'Vente annulée (rendue à l’acheteur)', ['montant', 'qui', 'ref', 'raison'], 'Vente annulée', '{raison}{ref}', 'Vente annulée'),
  def('commission.taken', 'Ventes', 'Commission prélevée par une app', MONEY_OUT, '{montant_signe}', 'Commission prélevée\nPar {qui} sur votre vente{ref}.', 'Commission prélevée · {montant_signe}', false),

  // ---------------------------------------------------------------- refunds
  def('refund.received', 'Remboursements', 'Remboursement reçu', MONEY_IN, '{montant_signe}', 'Remboursement reçu avec succès\nDe {qui}{ref}. Le montant a été ajouté à votre solde.', 'Remboursement reçu avec succès · {montant_signe}'),
  def('refund.requested', 'Remboursements', 'Remboursement envoyé : demandé', ['montant_signe', 'montant', 'montant_recu', 'qui', 'ref'], '{montant_signe}', 'Remboursement en préparation\n{montant_recu} vers {qui}. Le montant a été débité de votre solde, frais compris.', 'Remboursement en préparation · {montant_signe}'),
  def('refund.sent', 'Remboursements', 'Remboursement envoyé : arrivé', ['montant_signe', 'montant', 'montant_recu', 'qui', 'ref'], '{montant_signe}', 'Remboursement envoyé avec succès\n{montant_recu} remboursés vers {qui}.', 'Remboursement envoyé avec succès · {montant_signe}'),
  def('refund.failed', 'Remboursements', 'Remboursement envoyé : échoué (argent rendu)', ['montant_signe', 'montant', 'qui', 'raison'], '{montant_signe}', 'Remboursement non effectué\n{raison} Le montant a été restitué sur votre solde.', 'Remboursement non effectué · {montant_signe}'),

  // ---------------------------------------------------------------- account and security
  def('account.sign_in', 'Compte et sécurité', 'Connexion depuis un nouvel appareil', ['appareil', 'date'], 'Nouvelle connexion', 'Connexion à votre compte LightPay depuis {appareil}, le {date}.\nSi ce n’est pas vous, sécurisez votre compte Google (changez son mot de passe) : c’est lui qui ouvre LightPay.', 'Nouvelle connexion à votre compte LightPay'),
  def('account.app_authorized', 'Compte et sécurité', 'App autorisée (LightPay Connect)', ['app', 'permissions'], 'App autorisée', '{app} peut maintenant utiliser votre compte LightPay : {permissions}.\nVous pouvez retirer cet accès à tout moment depuis Compte > Apps connectées.', 'App autorisée : {app}'),
  def('account.app_revoked', 'Compte et sécurité', 'Accès d’une app retiré', ['app'], 'Accès retiré', '{app} n’a plus accès à votre compte LightPay.', 'Accès retiré : {app}'),
  def('account.username', 'Compte et sécurité', 'Nom d’utilisateur changé', ['nom'], 'Nom d’utilisateur modifié', 'On vous envoie maintenant de l’argent avec @{nom}.', 'Nom d’utilisateur modifié'),
  def('account.withdrawals_suspended', 'Compte et sécurité', 'Retraits suspendus : trop de tentatives', ['heure'], 'Retraits et envois suspendus', 'Trop de tentatives de retrait : par sécurité, les retraits et les envois de votre compte sont suspendus jusqu’à {heure}.', 'Retraits et envois suspendus'),
  def('account.withdrawals_suspended_manual', 'Compte et sécurité', 'Retraits suspendus par LightPay', ['heure'], 'Retraits et envois suspendus', 'Les retraits et les envois de votre compte sont suspendus jusqu’à {heure}. Contactez le support LightPay.', 'Retraits et envois suspendus'),
  def('account.closed', 'Compte et sécurité', 'Compte supprimé', [], 'Compte supprimé', 'Votre compte LightPay a été fermé. Les apps connectées ont perdu leur accès ; l’historique comptable est conservé.', 'Compte supprimé'),
];

const DEFAULTS = new Map(DEFAULT_TEMPLATES.map((d) => [d.event, d]));

/** What each variable means and an example (the admin's preview and test messages). */
export const VARIABLES: Record<string, { help: string; sample: string }> = {
  montant_signe: { help: 'Montant signé (+ reçu, − sorti)', sample: '+1 000 FCFA' },
  montant: { help: 'Montant (frais compris pour une sortie)', sample: '1 000 FCFA' },
  montant_recu: { help: 'Montant arrivé sur le téléphone', sample: '5 000 FCFA' },
  qui: { help: 'L’autre partie (personne, app, numéro)', sample: 'Man Light' },
  ref: { help: 'Référence de commande, si elle existe', sample: ' · réf. CMD-12' },
  message: { help: 'Message de l’expéditeur, s’il existe', sample: ' « loyer de mars »' },
  raison: { help: 'Pourquoi c’est refusé', sample: 'Solde insuffisant sur ce compte mobile money.' },
  appareil: { help: 'L’appareil de la connexion', sample: 'Chrome sur Windows' },
  date: { help: 'Date et heure de la connexion', sample: '12 octobre à 18:04' },
  app: { help: 'Nom de l’app connectée', sample: 'Boutique' },
  permissions: { help: 'Ce que l’app peut faire', sample: 'Voir le solde, Recevoir des paiements' },
  nom: { help: 'Le @nom (sans @)', sample: 'awa.k' },
  heure: { help: 'Heure de fin de la suspension', sample: '18:30' },
};

let overrides: Record<string, Partial<Template>> = {};

const pick = (event: string): (Template & { event: string }) | null => {
  const d = DEFAULTS.get(event);
  if (!d) return null;
  const o = overrides[event] ?? {};
  return { event, title: o.title ?? d.title, body: o.body ?? d.body, subject: o.subject ?? d.subject, push: o.push ?? d.push, email: o.email ?? d.email, enabled: o.enabled ?? d.enabled };
};

const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{([a-z_]+)\}/g, (all, k) => (k in vars ? vars[k] : all)).replace(/[ \t]+\./g, '.').trim();

export interface Rendered {
  event: string;
  title: string;
  body: string;
  subject: string;
  push: boolean;
  email: boolean;
}

/** The message for an event with its values, or null when the admin switched it off. */
export function renderTemplate(event: string, vars: Record<string, string>): Rendered | null {
  const t = pick(event);
  if (!t || !t.enabled || (!t.push && !t.email)) return null;
  return { event, title: fill(t.title, vars), body: fill(t.body, vars), subject: fill(t.subject || t.title, vars), push: t.push, email: t.email };
}

/** For the admin: originals, current texts and variables of every message. */
export function listTemplates() {
  return DEFAULT_TEMPLATES.map((d) => ({
    event: d.event,
    group: d.group,
    label: d.label,
    vars: d.vars.map((name) => ({ name, ...VARIABLES[name] })),
    defaults: { title: d.title, body: d.body, subject: d.subject, push: d.push, email: d.email, enabled: d.enabled },
    current: pick(d.event),
    custom: Boolean(overrides[d.event]),
  }));
}

/** Sample values of an event's variables (preview, test). */
export const sampleVars = (event: string) => Object.fromEntries((DEFAULTS.get(event)?.vars ?? []).map((v) => [v, VARIABLES[v]?.sample ?? '']));

export class TemplateError extends Error {
  code = 'INVALID_TEMPLATE';
  statusCode = 400;
}

/** A full template for one event: lengths, and only the variables this message knows. */
export function validateTemplate(event: string, input: unknown): Template {
  const d = DEFAULTS.get(event);
  if (!d) throw new TemplateError('Message inconnu.');
  const b = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const text = (k: 'title' | 'body' | 'subject', max: number, required: boolean) => {
    const v = String(b[k] ?? '').replace(/\r\n/g, '\n').trim();
    if (required && !v) throw new TemplateError(k === 'title' ? 'Le titre est obligatoire.' : k === 'body' ? 'Le texte est obligatoire.' : 'L’objet est obligatoire.');
    if (v.length > max) throw new TemplateError(`${k === 'title' ? 'Titre' : k === 'body' ? 'Texte' : 'Objet'} trop long (${max} caractères au plus).`);
    for (const m of v.matchAll(/\{([^}]*)\}/g)) {
      if (!d.vars.includes(m[1])) throw new TemplateError(`Variable inconnue pour ce message : {${m[1]}}.`);
    }
    return v;
  };
  return {
    title: text('title', 80, true),
    body: text('body', 500, true),
    subject: text('subject', 120, false) || text('title', 80, true),
    push: b.push !== false,
    email: b.email === true,
    enabled: b.enabled !== false,
  };
}

const ID_DB: Environment = 'production';

export async function loadTemplates() {
  try {
    const [row] = await query(`SELECT templates FROM message_templates WHERE id = 1`, [], ID_DB);
    overrides = row?.templates && typeof row.templates === 'object' ? row.templates : {};
  } catch (err: any) {
    console.error('[NOTIFY] templates not read', err?.message);
  }
}

async function store(next: Record<string, Partial<Template>>, by: string) {
  await query(
    `INSERT INTO message_templates (id, templates, updated_by, updated_at) VALUES (1, $1::jsonb, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET templates = EXCLUDED.templates, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(next), by],
    ID_DB
  );
  overrides = next;
}

/** Saves one message; identical to the original = back to the original. Returns before / after. */
export async function saveTemplate(event: string, t: Template, by: string) {
  const d = DEFAULTS.get(event)!;
  const before = pick(event);
  const next = { ...overrides };
  const same = t.title === d.title && t.body === d.body && t.subject === d.subject && t.push === d.push && t.email === d.email && t.enabled === d.enabled;
  if (same) delete next[event];
  else next[event] = t;
  await store(next, by);
  return { before, after: pick(event) };
}

export async function resetTemplate(event: string, by: string) {
  if (!DEFAULTS.has(event)) throw new TemplateError('Message inconnu.');
  const before = pick(event);
  const next = { ...overrides };
  delete next[event];
  await store(next, by);
  return { before, after: pick(event) };
}
