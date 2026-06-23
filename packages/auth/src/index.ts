export {
  roleOrder,
  rolePrivilegeLevel,
  hasMinRole,
  highestRole,
  mfaRequiredRoles,
  requiresMfa,
  isAdminAppRole,
} from './roles';
export { COOKIE_NAMES, buildCookieAttributes, type CookieAttributes } from './cookies';
export {
  generateSessionId,
  defaultLimits,
  isIdleExpired,
  isMfaFresh,
  createSession,
  loadActiveSession,
  touchSession,
  revokeSession,
  markMfaVerified,
  type SessionLimits,
  type AuthDb,
} from './session';
export type { AuthProvider, LoginInput, LoginResult, VerifiedIdentity } from './provider';
export { MockAuthProvider } from './providers/mock';
export {
  ADMIN_PERMISSIONS,
  MFA_REQUIRED_ACTIONS,
  can,
  requiresMfaForAction,
  type AdminPermission,
} from './permissions';
export { decodeEncryptionKey, encryptSecret, decryptSecret } from './crypto';
export {
  TOTP_STEP_SECONDS,
  TOTP_WINDOW,
  generateTotpSecret,
  totpKeyUri,
  verifyTotp,
  type TotpVerifyResult,
} from './totp';
export {
  MFA_RATE_LIMIT,
  evaluateMfaAttempt,
  buildEnrollment,
  loadMfaUserState,
  storePendingMfaSecret,
  applyMfaSuccess,
  applyMfaFailure,
  type MfaUserState,
  type MfaAttemptOutcome,
  type MfaAttemptResult,
  type EnrollmentMaterial,
} from './mfa';
