// Reglas de la MFA obligatoria (TOTP). Sin dependencias para poder probarlas con node --test.

// Nombre que muestran Google Authenticator y apps similares junto a la cuenta.
export const TOTP_ISSUER = 'Warden';

// Ruta donde se inscribe el factor o se escribe el código tras la contraseña.
export const MFA_PATH = '/mfa';

export function normalizeTotpCode(value: string): string {
  return value.replace(/\s+/g, '');
}

export function isTotpCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export type MfaGate = 'allow' | 'to-mfa' | 'to-home';

// Decide qué hace el proxy con un usuario ya autenticado según el nivel de su sesión.
// Toda la app exige AAL2; /login queda libre para poder cambiar de cuenta.
export function mfaGate(pathname: string, currentLevel: string | null | undefined): MfaGate {
  if (pathname.startsWith('/login')) return 'allow';
  const onMfa = pathname === MFA_PATH || pathname.startsWith(`${MFA_PATH}/`);
  if (currentLevel === 'aal2') return onMfa ? 'to-home' : 'allow';
  return onMfa ? 'allow' : 'to-mfa';
}
