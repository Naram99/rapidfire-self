import { z } from 'zod';

export const nicknameSchema = z.string().trim().min(1).max(40);
export const emailSchema = z
  .email()
  .max(254)
  .transform((email) => email.toLowerCase());
export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine(
    (password) =>
      /\p{Ll}/u.test(password) &&
      /\p{Lu}/u.test(password) &&
      /\p{Nd}/u.test(password) &&
      /[^\p{L}\p{N}\s]/u.test(password),
    { message: 'PASSWORD_REQUIREMENTS_NOT_MET' },
  );
export const signUpSchema = z
  .strictObject({
    name: nicknameSchema,
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string(),
    callbackURL: z.string().max(2048).optional(),
  })
  .refine((body) => body.password === body.passwordConfirm, {
    message: 'PASSWORD_CONFIRMATION_MISMATCH',
    path: ['passwordConfirm'],
  });
export const resetPasswordSchema = z
  .strictObject({
    token: z.string().min(1).max(1024),
    newPassword: passwordSchema,
    passwordConfirm: z.string(),
  })
  .refine((body) => body.newPassword === body.passwordConfirm, {
    message: 'PASSWORD_CONFIRMATION_MISMATCH',
    path: ['passwordConfirm'],
  });
export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
    passwordConfirm: z.string(),
    revokeOtherSessions: z.boolean().optional(),
  })
  .refine((body) => body.newPassword === body.passwordConfirm, {
    message: 'PASSWORD_CONFIRMATION_MISMATCH',
    path: ['passwordConfirm'],
  });
export const signInSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().optional(),
  callbackURL: z.string().max(2048).optional(),
});
export const profileUpdateSchema = z.strictObject({ nickname: nicknameSchema });
export const deleteAccountSchema = z.strictObject({
  password: z.string().min(1).max(128),
});
export const emailRequestSchema = z.strictObject({
  email: emailSchema,
  redirectTo: z.string().max(2048).optional(),
  callbackURL: z.string().max(2048).optional(),
});
export const historyQuerySchema = z
  .strictObject({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.iso.datetime({ offset: true }).optional(),
    beforeId: z.uuid().optional(),
  })
  .refine((query) => Boolean(query.before) === Boolean(query.beforeId));
export type Profile = Readonly<{
  userId: string;
  email: string;
  nickname: string;
  elo: number;
}>;
export type HistoryEntry = Readonly<{
  topicId: string | null;
  id: string;
  mode: 'solo' | 'multiplayer';
  status: 'in_progress' | 'completed' | 'interrupted';
  startedAt: string;
  endedAt: string | null;
  score: number;
  rank: number | null;
  rounds: number;
  answerTimeMs: number;
}>;
export type HistoryParticipant = Readonly<{
  id: string;
  name: string | null;
  identityState: 'registered' | 'deleted_user';
  order: number;
  score: number;
  rank: number | null;
  participation: 'participating' | 'left';
}>;
export const PASSWORD_RESET_REQUEST_MESSAGE =
  'If an account exists with this email address, we will send a password reset link.';
export const EMAIL_VERIFICATION_REQUEST_MESSAGE =
  'If this email address needs verification, we will send a verification link.';
export const HTTP_ENGLISH_MESSAGES = {
  INVALID_PAYLOAD: 'The request contains invalid data.',
  PASSWORD_REQUIREMENTS_NOT_MET:
    'Use 8–128 characters including a lowercase letter, an uppercase letter, a number and a special character.',
  PASSWORD_CONFIRMATION_MISMATCH: 'The passwords do not match.',
  EMAIL_NOT_VERIFIED: 'Verify your email address before signing in.',
  INVALID_EMAIL_OR_PASSWORD: 'The email address or password is incorrect.',
  INVALID_TOKEN: 'This link is invalid or has expired.',
  AUTH_REQUIRED: 'Sign in to continue.',
  INVALID_PASSWORD: 'The password is incorrect.',
  FORBIDDEN: 'You cannot perform this action.',
  NOT_FOUND: 'This result is not available.',
  RATE_LIMITED: 'Too many requests. Try again shortly.',
  SERVER_UNAVAILABLE: 'The server is temporarily unavailable.',
  MATCH_ACCESS_EXPIRED: 'Sign in again to reconnect to this game.',
  DELETED_USER: 'Deleted user',
} as const;
