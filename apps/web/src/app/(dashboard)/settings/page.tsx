import Link from 'next/link';
import styles from '@/components/dashboard/dashboard.module.css';

const SECTIONS = [
  {
    href: '/settings/users',
    title: 'Usuarios',
    hint: 'Crear cuentas locales, asignar roles, activar accesos y cambiar contraseñas. Solo administradores.',
  },
  {
    href: '/settings/scoring',
    title: 'Pesos del KRI',
    hint: 'Versiones de pesos por dominio, puntos por severidad y factores por confianza. Editar requiere rol admin.',
  },
  {
    href: '/settings/schedule',
    title: 'Programación de escaneos',
    hint: 'Frecuencia y fecha del próximo escaneo automático. Editar requiere rol admin.',
  },
  {
    href: '/settings/alerts',
    title: 'Alertas',
    hint: 'Umbral de nota, destinatarios e historial de alertas. Editar requiere rol admin.',
  },
];

export default function SettingsPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Configuración</h1>
      {SECTIONS.map((s) => (
        <section key={s.href} className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>{s.title}</h2>
              <p className={styles.cardHint}>{s.hint}</p>
            </div>
            <Link href={s.href} className={styles.button}>
              Administrar
            </Link>
          </div>
        </section>
      ))}
    </div>
  );
}
