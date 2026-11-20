'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './top-nav.module.css';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/assets', label: 'Activos' },
  { href: '/findings', label: 'Hallazgos' },
  { href: '/scans', label: 'Escaneos' },
  { href: '/reports', label: 'Reportes' },
  { href: '/settings', label: 'Configuración' },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    try {
      await createClient().auth.signOut();
    } catch {
      // Sin Supabase configurado (modo WARDEN_DEV_SKIP_AUTH) no hay sesión que cerrar.
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <nav className={styles.nav}>
      <Link href="/" className={styles.brand}>
        {/* El PNG trae mucho margen alrededor del dibujo: el recorte lo ajusta al alto de la barra. */}
        <span className={styles.logoCrop} aria-hidden>
          <Image src="/logoWarden.png" alt="" width={48} height={48} className={styles.logo} priority />
        </span>
        Warden
      </Link>
      <ul className={styles.tabs}>
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} className={`${styles.tab} ${active ? styles.active : ''}`} aria-current={active ? 'page' : undefined}>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <button type="button" className={styles.logout} onClick={logout}>
        Cerrar sesión
      </button>
    </nav>
  );
}
