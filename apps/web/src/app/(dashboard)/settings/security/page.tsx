import Link from 'next/link';
import styles from '@/components/dashboard/dashboard.module.css';
import { SecuritySettings } from '@/components/mfa/security-settings';

export default function SecuritySettingsPage() {
  return (
    <div className={styles.page}>
      <div>
        <Link href="/settings" className={styles.linkButton}>← Configuración</Link>
        <h1 className={styles.pageTitle}>Seguridad</h1>
      </div>
      <SecuritySettings />
    </div>
  );
}
