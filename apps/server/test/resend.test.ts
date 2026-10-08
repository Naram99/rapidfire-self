import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverConfig } from '../src/bootstrap/config.js';
import { resendEmailPort } from '../src/email/resend.js';
import type { EmailMessage } from '../src/email/types.js';

const settings = {
  apiKey: 're_test_only_not_a_real_secret',
  from: 'Rapidfire <no-reply@example.invalid>',
};
const message: EmailMessage = {
  to: 'player@example.invalid',
  subject: 'Verify your email address',
  text: 'Open https://game.example.invalid/verify?token=test-only',
  html: '<p>Verify your email address.</p>',
  messageId: '<stable-email-job@rapidfire.local>',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Resend delivery adapter', () => {
  it('sends the replaceable email contract through the authenticated HTTPS API', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: 'delivery-id' }));

    const result = await resendEmailPort(settings, request).send(
      message,
      new AbortController().signal,
    );

    expect(result).toBe('accepted');
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.messageId,
        },
        signal: expect.any(AbortSignal),
      }),
    );
    const [, options] = request.mock.calls[0] ?? [];
    const payload: unknown =
      typeof options?.body === 'string' ? JSON.parse(options.body) : null;
    expect(payload).toEqual({
      from: settings.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    expect(options?.body).not.toContain(settings.apiKey);
    expect(options?.body).not.toContain(message.messageId);
  });

  it('reuses the same idempotency key and payload when a delivery is retried', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ name: 'rate_limit_exceeded' }, { status: 429 }),
      )
      .mockResolvedValueOnce(Response.json({ id: 'delivery-id' }));
    const port = resendEmailPort(settings, request);

    expect(await port.send(message, new AbortController().signal)).toBe(
      'temporary_failure',
    );
    expect(await port.send(message, new AbortController().signal)).toBe(
      'accepted',
    );
    const first = request.mock.calls[0]?.[1];
    const second = request.mock.calls[1]?.[1];
    expect(second?.headers).toEqual(first?.headers);
    expect(second?.body).toBe(first?.body);
  });

  it.each([408, 429, 500, 502, 503, 504])(
    'retries an HTTP %i response',
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ message: 'Provider error' }, { status }),
        );
      expect(
        await resendEmailPort(settings, request).send(
          message,
          new AbortController().signal,
        ),
      ).toBe('temporary_failure');
    },
  );

  it('releases an unread error response before retrying delivery', async () => {
    const cancel = vi.fn(() => undefined);
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      status: 503,
    });
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);

    expect(
      await resendEmailPort(settings, request).send(
        message,
        new AbortController().signal,
      ),
    ).toBe('temporary_failure');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 403, 404, 422])(
    'does not retry an HTTP %i configuration or validation failure',
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ message: 'Provider error' }, { status }),
        );
      expect(
        await resendEmailPort(settings, request).send(
          message,
          new AbortController().signal,
        ),
      ).toBe('permanent_failure');
    },
  );

  it.each([
    ['concurrent_idempotent_requests', 'temporary_failure'],
    ['invalid_idempotent_request', 'permanent_failure'],
  ])('handles a 409 %s response', async (name, outcome) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ name }, { status: 409 }));
    expect(
      await resendEmailPort(settings, request).send(
        message,
        new AbortController().signal,
      ),
    ).toBe(outcome);
  });

  it.each([null, {}, { id: 123 }, { id: '' }, { message: 'success' }])(
    'does not acknowledge an unvalidated success response: %j',
    async (payload) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(payload));
      expect(
        await resendEmailPort(settings, request).send(
          message,
          new AbortController().signal,
        ),
      ).toBe('temporary_failure');
    },
  );

  it('retries a malformed success body instead of claiming delivery succeeded', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('not JSON'));
    expect(
      await resendEmailPort(settings, request).send(
        message,
        new AbortController().signal,
      ),
    ).toBe('temporary_failure');
  });

  it('retries transport failures without leaking provider error details to logs', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`Provider rejected ${settings.apiKey}`));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(
        await resendEmailPort(settings, request).send(
          message,
          new AbortController().signal,
        ),
      ).toBe('temporary_failure');
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('forwards cancellation to the request and does not acknowledge an aborted delivery', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, options) => {
        requestSignal = options?.signal;
        return new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        });
      });

    const delivery = resendEmailPort(settings, request).send(
      message,
      controller.signal,
    );
    expect(requestSignal?.aborted).toBe(false);
    controller.abort();
    expect(requestSignal?.aborted).toBe(true);
    expect(await delivery).toBe('temporary_failure');
  });

  it('does not make a request for an already cancelled job', async () => {
    const request = vi.fn<typeof fetch>();
    const controller = new AbortController();
    controller.abort();
    expect(
      await resendEmailPort(settings, request).send(message, controller.signal),
    ).toBe('permanent_failure');
    expect(request).not.toHaveBeenCalled();
  });

  it('does not make a request while the provider configuration is missing', async () => {
    const request = vi.fn<typeof fetch>();
    expect(
      await resendEmailPort(null, request).send(
        message,
        new AbortController().signal,
      ),
    ).toBe('permanent_failure');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('Resend startup configuration', () => {
  function configureAuth() {
    vi.stubEnv('DATABASE_URL', 'postgres://local:local@localhost:5432/local');
    vi.stubEnv(
      'BETTER_AUTH_SECRET',
      'test-only-secret-at-least-thirty-two-characters',
    );
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:5173');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('EMAIL_FROM', '');
  }

  it('loads the API key and sender without consulting the legacy SMTP provider', () => {
    configureAuth();
    vi.stubEnv('RESEND_API_KEY', settings.apiKey);
    vi.stubEnv('EMAIL_FROM', settings.from);
    vi.stubEnv('SMTP_HOST', 'obsolete.invalid');
    vi.stubEnv('SMTP_USER', 'obsolete');
    vi.stubEnv('SMTP_PASSWORD', 'obsolete');
    expect(serverConfig().resend).toEqual(settings);
  });

  it.each([
    ['', settings.from],
    [settings.apiKey, ''],
    ['', ''],
  ])(
    'leaves email disabled for an incomplete configuration',
    (apiKey, from) => {
      configureAuth();
      vi.stubEnv('RESEND_API_KEY', apiKey);
      vi.stubEnv('EMAIL_FROM', from);
      expect(serverConfig().resend).toBeNull();
    },
  );

  it.each([
    ['RESEND_API_KEY', 're_bad key'],
    ['RESEND_API_KEY', 're_bad\nkey'],
    ['RESEND_API_KEY', 're_bad\u0001key'],
    ['EMAIL_FROM', 'Rapidfire\r\nBcc: someone@example.invalid'],
    ['EMAIL_FROM', 'Rapidfire\u007f <no-reply@example.invalid>'],
  ])('rejects unsafe %s values before any email can be sent', (key, value) => {
    configureAuth();
    vi.stubEnv('RESEND_API_KEY', settings.apiKey);
    vi.stubEnv('EMAIL_FROM', settings.from);
    vi.stubEnv(key, value);
    expect(serverConfig).toThrow('Invalid Resend configuration');
  });
});
