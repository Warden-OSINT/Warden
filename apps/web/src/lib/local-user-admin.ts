export function isLocalUserAdminEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}
