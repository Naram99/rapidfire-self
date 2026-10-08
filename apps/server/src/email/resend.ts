import type { EmailPort } from './types.js';

export type ResendSettings = Readonly<{
  apiKey: string;
  from: string;
}>;

export function resendEmailPort(
  settings: ResendSettings | null,
  request: typeof fetch = fetch,
): EmailPort {
  return {
    send: async (message, signal) => {
      if (!settings || signal.aborted) return 'permanent_failure';
      try {
        const response = await request('https://api.resend.com/emails', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
            // Keep this identical across retries after a timeout or lost response.
            'Idempotency-Key': message.messageId,
          },
          body: JSON.stringify({
            from: settings.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });
        if (!response.ok && response.status !== 409) {
          await response.body?.cancel();
          return response.status === 408 ||
            response.status === 429 ||
            response.status >= 500
            ? 'temporary_failure'
            : 'permanent_failure';
        }
        if (response.status === 409) {
          const error: unknown = await response.json();
          return typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            error.name === 'concurrent_idempotent_requests'
            ? 'temporary_failure'
            : 'permanent_failure';
        }
        const result: unknown = await response.json();
        return !signal.aborted &&
          typeof result === 'object' &&
          result !== null &&
          'id' in result &&
          typeof result.id === 'string' &&
          result.id.length > 0
          ? 'accepted'
          : 'temporary_failure';
      } catch {
        // Provider responses can contain recipient addresses or authentication details.
        return 'temporary_failure';
      }
    },
  };
}
