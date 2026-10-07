import type { EmailJob, EmailMessage } from './types.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
export function renderEmail(job: EmailJob): EmailMessage {
  const verification = job.purpose === 'verify_email';
  const subject = verification
    ? 'Verify your Rapidfire email address'
    : 'Reset your Rapidfire password';
  const action = verification ? 'Verify email address' : 'Set a new password';
  const expiry = verification
    ? 'This link expires in 24 hours.'
    : 'This link expires in 15 minutes and can be used once.';
  const note = 'If you did not request this, you can ignore this email.';
  return {
    to: job.recipient,
    subject,
    text: `${action}:\n${job.actionUrl}\n\n${expiry}\n${note}`,
    html: `<p>${action}</p><p><a href="${escapeHtml(job.actionUrl)}">${action}</a></p><p>${expiry}</p><p>${note}</p>`,
    messageId: `<${job.id}@rapidfire.local>`,
  };
}
