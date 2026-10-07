import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import {
  changePasswordSchema,
  emailRequestSchema,
  EMAIL_VERIFICATION_REQUEST_MESSAGE,
  PASSWORD_RESET_REQUEST_MESSAGE,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from '@rapidfire/contracts';
import type { Clock } from '../application/ports.js';
import type { Database } from '../database/client.js';
import * as schema from '../database/auth-schema.js';
import type { EmailQueue } from '../email/queue.js';
import { authOptions } from './options.js';
import { EmailRateLimit, RequestRateLimit } from './rate-limit.js';

export function createAuth(
  options: Readonly<{
    db: Database;
    secret: string;
    publicUrl: string;
    allowedOrigins: readonly string[];
    clock: Clock;
    email: EmailQueue;
    revokeUser: (userId: string) => Promise<void>;
    returningUser: (cookie: string | null) => string | null;
  }>,
) {
  const emailLimit = new EmailRateLimit(options.clock);
  const enqueue = (
    purpose: 'verify_email' | 'reset_password',
    identity: Readonly<{ id: string; email: string }>,
    url: string,
  ) => {
    const now = options.clock.now();
    const accepted = options.email.enqueue({
      id: randomUUID(),
      purpose,
      userId: identity.id,
      recipient: identity.email,
      locale: 'en',
      templateVersion: 1,
      actionUrl: url,
      createdAt: now,
      expiresAt: now + (purpose === 'verify_email' ? 86400000 : 900000),
    });
    if (!accepted) console.warn('EMAIL_QUEUE_FULL');
  };
  const auth = betterAuth({
    ...authOptions,
    advanced: {
      ...authOptions.advanced,
      ipAddress: { ipAddressHeaders: ['x-rapidfire-client-ip'] },
    },
    rateLimit: {
      ...authOptions.rateLimit,
      customStorage: new RequestRateLimit(options.clock),
    },
    secret: options.secret,
    baseURL: options.publicUrl,
    trustedOrigins: [...options.allowedOrigins],
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      schema,
      transaction: true,
    }),
    emailAndPassword: {
      ...authOptions.emailAndPassword,
      sendResetPassword: async ({ user, url }) =>
        enqueue('reset_password', user, url),
      onPasswordReset: async ({ user }) => {
        options.email.cancelUser(user.id);
        await options.revokeUser(user.id);
      },
    },
    emailVerification: {
      ...authOptions.emailVerification,
      sendVerificationEmail: async ({ user, url }) =>
        enqueue('verify_email', user, url),
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const parsed =
          ctx.path === '/sign-up/email'
            ? signUpSchema.safeParse(ctx.body)
            : ctx.path === '/sign-in/email'
              ? signInSchema.safeParse(ctx.body)
              : ctx.path === '/reset-password'
                ? resetPasswordSchema.safeParse(ctx.body)
                : ctx.path === '/change-password'
                  ? changePasswordSchema.safeParse(ctx.body)
                  : null;
        if (parsed && !parsed.success) {
          const code =
            parsed.error.issues.find(
              (issue) =>
                issue.message === 'PASSWORD_CONFIRMATION_MISMATCH' ||
                issue.message === 'PASSWORD_REQUIREMENTS_NOT_MET',
            )?.message ?? 'INVALID_PAYLOAD';
          throw new APIError('BAD_REQUEST', { code, message: code });
        }
        if (parsed?.success) return { context: { body: parsed.data } };
        if (
          ctx.path === '/request-password-reset' ||
          ctx.path === '/send-verification-email'
        ) {
          const body = emailRequestSchema.safeParse(ctx.body);
          if (!body.success)
            throw new APIError('BAD_REQUEST', {
              code: 'INVALID_PAYLOAD',
              message: 'INVALID_PAYLOAD',
            });
          if (!emailLimit.allow(ctx.path, body.data.email))
            return ctx.json({
              status: true,
              message:
                ctx.path === '/request-password-reset'
                  ? PASSWORD_RESET_REQUEST_MESSAGE
                  : EMAIL_VERIFICATION_REQUEST_MESSAGE,
            });
          return {
            context: {
              body: {
                ...body.data,
                ...(ctx.path === '/request-password-reset'
                  ? {
                      redirectTo:
                        body.data.redirectTo ??
                        `${options.publicUrl}/reset-password`,
                    }
                  : {
                      callbackURL:
                        body.data.callbackURL ?? `${options.publicUrl}/sign-in`,
                    }),
              },
            },
          };
        }
        if (ctx.path === '/sign-out' || ctx.path === '/revoke-sessions') {
          const identity = ctx.headers
            ? await auth.api.getSession({
                headers: ctx.headers,
                query: { disableRefresh: true },
              })
            : null;
          if (identity) await options.revokeUser(identity.user.id);
          else {
            const userId = options.returningUser(
              ctx.headers?.get('cookie') ?? null,
            );
            if (userId) await options.revokeUser(userId);
          }
        }
        if (
          [
            '/update-user',
            '/change-email',
            '/set-password',
            '/revoke-session',
            '/revoke-other-sessions',
          ].includes(ctx.path)
        )
          throw new APIError('FORBIDDEN', {
            code: 'FORBIDDEN',
            message: 'FORBIDDEN',
          });
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === '/request-password-reset' ||
          ctx.path === '/send-verification-email'
        ) {
          // Neither account existence nor verification state is exposed.
          if (!(ctx.context.returned instanceof APIError))
            return ctx.json({
              status: true,
              message:
                ctx.path === '/request-password-reset'
                  ? PASSWORD_RESET_REQUEST_MESSAGE
                  : EMAIL_VERIFICATION_REQUEST_MESSAGE,
            });
        }
        if (
          ctx.path === '/change-password' &&
          !(ctx.context.returned instanceof APIError)
        ) {
          // Password change also replaces old access on every device. Sign in again.
          const identity = ctx.context.session;
          if (identity) await options.revokeUser(identity.user.id);
        }
      }),
    },
  });
  return auth;
}
export type Auth = ReturnType<typeof createAuth>;
