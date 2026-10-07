export type EmailPurpose = 'verify_email' | 'reset_password';
export type EmailJob = Readonly<{
  id: string;
  purpose: EmailPurpose;
  userId: string;
  recipient: string;
  locale: 'en';
  templateVersion: 1;
  actionUrl: string;
  createdAt: number;
  expiresAt: number;
}>;
export type EmailMessage = Readonly<{
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
}>;
export type EmailOutcome =
  'accepted' | 'temporary_failure' | 'permanent_failure';
export type EmailPort = Readonly<{
  send: (message: EmailMessage, signal: AbortSignal) => Promise<EmailOutcome>;
}>;
export type EmailLog = Readonly<{
  jobId: string;
  purpose: EmailPurpose;
  attempt: number;
  code:
    | 'accepted'
    | 'temporary_failure'
    | 'permanent_failure'
    | 'expired'
    | 'cancelled'
    | 'queue_full';
}>;
