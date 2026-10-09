// Builds the email from an APPROVED message: plain text + escaped HTML + unsubscribe footer/headers.
// Pure (no database) → tested directly.
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const oneLine = (s, max) => String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

export function buildEmail({ msg, lead, smtpConfig, settings, unsubscribeUrl }) {
  const signature = settings?.outreach?.emailSignature || '';
  const address = settings?.outreach?.postalAddress || '';
  const footer = [address, `Don't want emails from us? Unsubscribe: ${unsubscribeUrl}`].filter(Boolean).join('\n');
  const text = [msg.body, signature, `—\n${footer}`].filter(Boolean).join('\n\n');
  const para = (t) => escapeHtml(t).replace(/\n/g, '<br>');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${para(msg.body)}${signature ? `<br><br>${para(signature)}` : ''}<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 8px"><p style="font-size:12px;color:#777">${address ? `${para(address)}<br>` : ''}Don't want emails from us? <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p></div>`;
  const fromName = oneLine(smtpConfig.fromName, 80).replace(/["\\]/g, '');
  return {
    from: fromName ? `"${fromName}" <${smtpConfig.fromEmail}>` : smtpConfig.fromEmail,
    to: lead.email,
    subject: oneLine(msg.subject, 150) || `Message from ${fromName || smtpConfig.fromEmail}`,
    text,
    html,
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

