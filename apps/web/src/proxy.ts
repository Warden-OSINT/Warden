import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { hasFreshMfa, lastTotpAt, MFA_PATH, mfaGate } from '@/lib/mfa';

// Refresca la sesión de Supabase en cada request y manda a /login a quien no esté autenticado.
// El control por rol (admin/analyst) lo aplica RLS en la BD.
export async function proxy(request: NextRequest) {
  // Solo en desarrollo: permite ver las páginas sin Supabase corriendo. Nunca aplica en producción.
  if (process.env.NODE_ENV !== 'production' && process.env.WARDEN_DEV_SKIP_AUTH === 'true') {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // MFA obligatoria: con AAL1 (solo contraseña) o con un código de hace más de una semana
  // únicamente se puede usar /mfa. RLS también exige AAL2 (app_role()).
  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const fresh = hasFreshMfa(aal?.currentLevel, lastTotpAt(aal?.currentAuthenticationMethods));
    const gate = mfaGate(request.nextUrl.pathname, fresh);
    if (gate !== 'allow') {
      const url = request.nextUrl.clone();
      url.pathname = gate === 'to-mfa' ? MFA_PATH : '/';
      url.search = '';
      const redirect = NextResponse.redirect(url);
      // Conserva las cookies de sesión que Supabase pudo haber refrescado en este request.
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return redirect;
    }
  }

  return response;
}

export const config = {
  // Imágenes de public/ fuera: el optimizador de next/image las pide sin sesión y recibiría el login.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)'],
};
