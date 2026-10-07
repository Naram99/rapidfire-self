import type { SmtpSettings } from '../email/smtp.js';

export function serverConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  const publicUrl = process.env.BETTER_AUTH_URL || 'http://localhost:5173';
  if (!databaseUrl || !secret || secret.length < 32)
    throw new Error(
      'DATABASE_URL and a 32+ character BETTER_AUTH_SECRET are required. Run npm run env:init.',
    );
  const url = new URL(publicUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('BETTER_AUTH_URL must be a public HTTP(S) origin.');
  if (
    process.env.NODE_ENV === 'production' &&
    url.protocol !== 'https:' &&
    !['127.0.0.1', 'localhost'].includes(url.hostname)
  )
    throw new Error('Production BETTER_AUTH_URL requires HTTPS.');
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be between 1 and 65535');
  const publicPort =
    process.env.NODE_ENV === 'production'
      ? port
      : Number(process.env.WEB_PORT || 5173);
  const allowedOrigins = process.env.GAME_ALLOWED_ORIGINS?.trim()
    ? process.env.GAME_ALLOWED_ORIGINS.split(',').map(
        (origin) => new URL(origin.trim()).origin,
      )
    : [
        ...new Set([
          url.origin,
          `http://127.0.0.1:${publicPort}`,
          `http://localhost:${publicPort}`,
        ]),
      ];
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  let smtp: SmtpSettings | null = null;
  if (SMTP_USER && SMTP_PASSWORD && SMTP_FROM) {
    const smtpPort = Number(process.env.SMTP_PORT || 587);
    if (
      !Number.isInteger(smtpPort) ||
      smtpPort < 1 ||
      smtpPort > 65535 ||
      /[\r\n]/.test(SMTP_FROM)
    )
      throw new Error('Invalid SMTP configuration');
    smtp = {
      host: SMTP_HOST || 'mail.smtp2go.com',
      port: smtpPort,
      secure: smtpPort === 465,
      username: SMTP_USER,
      password: SMTP_PASSWORD,
      from: SMTP_FROM,
    };
  }
  return {
    databaseUrl,
    secret,
    publicUrl: url.origin,
    port,
    host: process.env.HOST || '127.0.0.1',
    allowedOrigins,
    smtp,
  };
}
