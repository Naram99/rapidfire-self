import { describe, expect, it } from 'vitest';
import {
  signUpSchema,
  resetPasswordSchema,
  passwordSchema,
  nicknameSchema,
  emailSchema,
  profileUpdateSchema,
} from '../src/http.js';

describe('HTTP auth and profile boundaries', () => {
  it('requires every password category and enforces 8–128 characters without rejecting Unicode letters', () => {
    for (const password of [
      'Aa1!abc',
      'lowercase1!',
      'UPPERCASE1!',
      'MixedCase!',
      'MixedCase12',
      `${'a'.repeat(126)}A1!`,
    ])
      expect(passwordSchema.safeParse(password).success).toBe(false);
    expect(passwordSchema.safeParse('ÁrvízTűrő9!').success).toBe(true);
    expect(passwordSchema.safeParse('Password1!').success).toBe(true);
    expect(passwordSchema.safeParse(`${'a'.repeat(125)}A1!`).success).toBe(
      true,
    );
  });
  it('requires matching confirmation on registration and reset even without a frontend', () => {
    const body = {
      name: 'Player',
      email: 'player@example.invalid',
      password: 'Password1!',
      passwordConfirm: 'Password1!',
    };
    expect(signUpSchema.safeParse(body).success).toBe(true);
    expect(
      signUpSchema.safeParse({ ...body, passwordConfirm: 'different' }).success,
    ).toBe(false);
    expect(
      signUpSchema.safeParse({
        name: body.name,
        email: body.email,
        password: body.password,
      }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        token: 't',
        newPassword: body.password,
        passwordConfirm: 'different',
      }).success,
    ).toBe(false);
    expect(
      signUpSchema.safeParse({ ...body, image: 'https://image.invalid' })
        .success,
    ).toBe(false);
  });
  it('normalizes email and surrounding nickname whitespace, and keeps ELO server-owned', () => {
    expect(emailSchema.parse('Player@Example.invalid')).toBe(
      'player@example.invalid',
    );
    expect(nicknameSchema.parse('  Player  ')).toBe('Player');
    expect(nicknameSchema.safeParse('   ').success).toBe(false);
    expect(nicknameSchema.safeParse('a'.repeat(41)).success).toBe(false);
    expect(
      profileUpdateSchema.safeParse({ nickname: 'Player', elo: 2000 }).success,
    ).toBe(false);
  });
});
