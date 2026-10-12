/**
 * E-mails to the person (their Google address), through Resend's HTTP API, no SDK.
 *
 *   RESEND_API_KEY        the API key (resend.com > API Keys)
 *   LIGHTPAY_MAIL_FROM    the sender, on a domain verified in Resend, e.g. "LightPay <notifications@smlab.xyz>"
 *   LIGHTPAY_ACCOUNT_URL  where "Ouvrir LightPay" leads (default https://checkout.smlab.xyz/account)
 * Without the key, e-mails are skipped (logged once): nothing else changes.
 */

let warned = false;

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.LIGHTPAY_MAIL_FROM);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const accountUrl = () => process.env.LIGHTPAY_ACCOUNT_URL || `${process.env.CHECKOUT_BASE_URL || 'https://checkout.smlab.xyz'}/account`;

/** The web account opens the same screen as the app (#/activity/<id>, #/apps…). */
export const webLink = (route?: string) => {
  const base = accountUrl();
  if (!route) return base;
  const hash = route.replace(/^\/account\/apps/, '/apps').replace(/^\//, '');
  return `${base}#/${hash}`;
};

/** Simple, readable on every mail client: white card, green accent, one button. */
export function renderEmail(m: { title: string; body: string; route?: string; sandbox?: boolean }) {
  const link = webLink(m.route);
  const text = `${m.title}\n\n${m.body}\n\nOuvrir LightPay : ${link}\n\n—\nLightPay vous écrit à chaque opération sur votre compte et à chaque nouvelle connexion.`;
  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:24px 12px;background:#f4f4f6;font-family:Poppins,Segoe UI,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #e4e4e7">
<tr><td style="padding:28px 28px 8px;font-size:18px;font-weight:600;letter-spacing:-.01em">Light<span style="color:#047857">Pay</span>${m.sandbox ? ' <span style="font-size:11px;color:#d97706;font-weight:600">TEST</span>' : ''}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:20px;font-weight:600;line-height:1.3">${esc(m.title)}</td></tr>
<tr><td style="padding:10px 28px 0;font-size:15px;line-height:1.55;color:#3f3f46">${esc(m.body).split(String.fromCharCode(10)).join('<br>')}</td></tr>
<tr><td style="padding:24px 28px 28px"><a href="${esc(link)}" style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:.08em;text-transform:uppercase;padding:14px 22px;border-radius:12px">Ouvrir LightPay</a></td></tr>
</table>
<p style="max-width:480px;font-size:12px;line-height:1.5;color:#71717a;margin:16px auto 0">LightPay vous écrit à chaque opération sur votre compte et à chaque nouvelle connexion. Ne répondez pas à cet e-mail.</p>
</td></tr></table></body></html>`;
  return { html, text };
}

export type EmailResult = 'sent' | 'failed' | 'skipped';

export async function sendEmail(to: string, m: { title: string; body: string; route?: string; sandbox?: boolean }): Promise<EmailResult> {
  if (!emailConfigured()) {
    if (!warned) console.warn('[EMAIL] RESEND_API_KEY / LIGHTPAY_MAIL_FROM not set: e-mails skipped');
    warned = true;
    return 'skipped';
  }
  const { html, text } = renderEmail(m);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.LIGHTPAY_MAIL_FROM, to: [to], subject: `${m.sandbox ? '[Test] ' : ''}${m.title}`, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return 'sent';
    console.error('[EMAIL] send failed', res.status);
    return 'failed';
  } catch (err: any) {
    console.error('[EMAIL] send failed', err?.message);
    return 'failed';
  }
}
