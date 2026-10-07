import type { BetterAuthOptions } from 'better-auth';

// The generator and runtime share these schema-affecting options.
export const authOptions = {
  appName: 'Rapidfire',
  basePath: '/api/auth',
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 900,
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: false,
    autoSignInAfterVerification: false,
    expiresIn: 86400,
  },
  session: {
    expiresIn: 1800,
    updateAge: 300,
    cookieCache: { enabled: false },
  },
  advanced: { database: { generateId: 'uuid' } },
  user: { deleteUser: { enabled: false } },
  logger: { disabled: true },
  rateLimit: { enabled: true, window: 60, max: 60 },
} satisfies BetterAuthOptions;
