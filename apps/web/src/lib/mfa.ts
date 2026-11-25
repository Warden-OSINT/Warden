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

// La MFA se vuelve a pedir una vez por semana: la sesión de Supabase dura mucho más (la cookie
// vive 400 días y el refresh conserva AAL2), así que sin este límite el código solo se pediría al
// volver a iniciar sesión.
export const MFA_REVERIFY_MS = 7 * 24 * 60 * 60 * 1000;

const TOTP_METHODS = new Set(['totp', 'mfa/totp']);

// Momento (ms) del último código TOTP verificado en esta sesión, según el claim `amr` del JWT.
export function lastTotpAt(methods: ReadonlyArray<{ method: string; timestamp: number } | string> | null | undefined): number | null {
  let latest: number | null = null;
  for (const entry of methods ?? []) {
    if (typeof entry === 'string' || !TOTP_METHODS.has(entry.method)) continue;
    const at = entry.timestamp * 1000;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

// AAL2 con un código verificado hace menos de una semana.
export function hasFreshMfa(
  currentLevel: string | null | undefined,
  totpAt: number | null,
  now: number = Date.now(),
): boolean {
  return currentLevel === 'aal2' && totpAt !== null && now - totpAt < MFA_REVERIFY_MS;
}

export type MfaGate = 'allow' | 'to-mfa' | 'to-home';

// Decide qué hace el proxy con un usuario ya autenticado según si su MFA sigue vigente.
// Con MFA vigente, /login y /mfa mandan al dashboard (volver a entrar crearía una sesión nueva
// y pediría el código otra vez); para cambiar de cuenta se usa "Cerrar sesión".
export function mfaGate(pathname: string, freshMfa: boolean): MfaGate {
  const onLogin = pathname === '/login' || pathname.startsWith('/login/');
  const onMfa = pathname === MFA_PATH || pathname.startsWith(`${MFA_PATH}/`);
  if (freshMfa) return onLogin || onMfa ? 'to-home' : 'allow';
  return onLogin || onMfa ? 'allow' : 'to-mfa';
}
