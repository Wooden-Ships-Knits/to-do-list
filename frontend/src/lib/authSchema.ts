import { z } from 'zod';

/** Same rules as the backend (app/schemas.py). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username').max(50, 'Username is too long'),
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX, 'Password is too long'),
});
export type LoginValues = z.infer<typeof loginSchema>;

export function makePasswordSchema(username: string) {
  return z
    .object({
      current: z.string().min(1, 'Enter your current password'),
      next: z
        .string()
        .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
        .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`),
      confirm: z.string().min(1, 'Type the new password again'),
    })
    .superRefine((v, ctx) => {
      if (v.next && v.next.toLowerCase() === username.toLowerCase()) {
        ctx.addIssue({
          code: 'custom',
          path: ['next'],
          message: 'The new password cannot be your username',
        });
      } else if (v.next && v.next === v.current) {
        ctx.addIssue({
          code: 'custom',
          path: ['next'],
          message: 'The new password must be different from the current one',
        });
      }
      if (v.confirm && v.confirm !== v.next) {
        ctx.addIssue({ code: 'custom', path: ['confirm'], message: 'The passwords do not match' });
      }
    });
}
export type PasswordValues = z.infer<ReturnType<typeof makePasswordSchema>>;

export const userSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Use at least 2 characters')
    .max(50, 'Use at most 50 characters')
    .regex(/^[a-z0-9._-]+$/, 'Use only letters, numbers, dots, dashes or underscores'),
  name: z.string().trim().min(1, "Enter the person's name").max(100, 'Name is too long'),
});
export type UserValues = z.infer<typeof userSchema>;

const AUTH_PAGES = ['/login', '/change-password'];

/** Where to go after logging in: only a path inside this app (never another site, and never
 *  back to a login screen). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/';
  }
  const path = next.split(/[?#]/)[0] ?? '';
  return AUTH_PAGES.includes(path) ? '/' : next;
}

/** "/login?next=..." for the page the user is on now. */
export function loginUrl(current: string): string {
  const next = safeNext(current);
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}
