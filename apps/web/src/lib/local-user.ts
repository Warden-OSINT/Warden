// Cuentas locales sin correo real: "analista" vive en Supabase Auth como
// "analista@warden.test". Debe coincidir con supabase/functions/manage-users/handler.ts.
export const LOCAL_USER_DOMAIN = 'warden.test';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidIdentifier(identifier: string): boolean {
  return identifier.includes('@') ? EMAIL_PATTERN.test(identifier) : USERNAME_PATTERN.test(identifier);
}

export function toAuthEmail(identifier: string): string {
  return identifier.includes('@') ? identifier : `${identifier}@${LOCAL_USER_DOMAIN}`;
}

// Muestra "analista" en lugar de "analista@warden.test"; los correos reales quedan igual.
export function displayIdentifier(email: string): string {
  const suffix = `@${LOCAL_USER_DOMAIN}`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}
