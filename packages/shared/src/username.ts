/**
 * Public username rules (Sprint 14): lowercase, 3–20 chars, `[a-z0-9_]`.
 * Mirrored by the `users_username_format` CHECK constraint in the DB.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** True when `s` is a valid public username. */
export function isValidUsername(s: string): boolean {
  return USERNAME_RE.test(s);
}

/**
 * Reduce arbitrary text (e.g. an email local-part or display name) to a
 * username-safe base: lowercase, strip everything outside `[a-z0-9_]`, and
 * clamp to the max length. May return fewer than `USERNAME_MIN` chars (or
 * empty) — callers that need a guaranteed-valid handle should pad / suffix.
 */
export function normalizeUsernameBase(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, USERNAME_MAX);
}
