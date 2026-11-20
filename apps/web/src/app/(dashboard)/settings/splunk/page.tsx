import Link from 'next/link';
import styles from '@/components/dashboard/dashboard.module.css';
import { SiemStatusPanel } from '@/components/settings/siem-status';
import { loadSiemStatus } from '@/lib/siem';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function SplunkSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: React.ReactNode;
  if (!user) {
    body = <p className={styles.notice}>Inicia sesión para ver la integración con Splunk.</p>;
  } else {
    const { data: isAdmin } = await supabase.rpc('is_admin');
    // RLS de integration_outbox: solo admin lee los envíos.
    body = isAdmin
      ? <SiemStatusPanel status={await loadSiemStatus(supabase)} />
      : <p className={styles.notice}>Solo un administrador puede ver los envíos a Splunk.</p>;
  }

  return (
    <div className={styles.page}>
      <div>
        <Link href="/settings" className={styles.linkButton}>← Configuración</Link>
        <h1 className={styles.pageTitle}>Splunk (SIEM)</h1>
        <p className={styles.subtitle}>
          Calificación de cada escaneo y alertas enviadas a Splunk HTTP Event Collector, sin evidencia
        </p>
      </div>
      {body}
    </div>
  );
}
