import nodemailer from 'nodemailer';
import type { EmailPort } from './types.js';

export type SmtpSettings = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
}>;
function isPermanent(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (
    ('responseCode' in error &&
      typeof error.responseCode === 'number' &&
      error.responseCode >= 500) ||
    ('code' in error && (error.code === 'EAUTH' || error.code === 'EENVELOPE'))
  );
}
export function smtpEmailPort(settings: SmtpSettings | null): EmailPort {
  return {
    send: async (message, signal) => {
      if (!settings || signal.aborted) return 'permanent_failure';
      const transport = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        requireTLS: !settings.secure,
        auth: { user: settings.username, pass: settings.password },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
        tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      });
      const abort = () => transport.close();
      signal.addEventListener('abort', abort, { once: true });
      try {
        await transport.sendMail({ ...message, from: settings.from });
        return signal.aborted ? 'temporary_failure' : 'accepted';
      } catch (error) {
        return isPermanent(error) ? 'permanent_failure' : 'temporary_failure';
      } finally {
        signal.removeEventListener('abort', abort);
        transport.close();
      }
    },
  };
}
