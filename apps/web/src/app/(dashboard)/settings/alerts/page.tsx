import Link from 'next/link';
import styles from '@/components/dashboard/dashboard.module.css';
import { AlertList } from '@/components/reports/alert-list';
import { AlertSettingsForm } from '@/components/settings/alert-settings-form';
import { loadEmailDeliveries, loadRecentAlerts } from '@/lib/alerts';
import { loadActiveCompany } from '@/lib/dashboard-data';
import { loadAlertSettings } from '@/lib/scoring-settings';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AlertSettingsPage() {
  const state = await loadAlertSettings();
  if (state.kind !== 'ready') {
    return (
      <div className={styles.page}>
        <h1 className={styles.pageTitle}>Alertas</h1>
        <p className={styles.notice}>Inicia sesión para ver las alertas.</p>
      </div>
    );
  }
  const supabase = await createClient();
  const company = await loadActiveCompany(supabase);
  const alerts = company ? await loadRecentAlerts(supabase, company.id, 50) : [];
  const deliveries = state.isAdmin ? await loadEmailDeliveries(supabase, alerts.map((a) => a.id)) : undefined;

  return (
    <div className={styles.page}>
      <div>
        <Link href="/settings" className={styles.linkButton}>← Configuración</Link>
        <h1 className={styles.pageTitle}>Alertas</h1>
        <p className={styles.subtitle}>Se registran al calificar cada escaneo y se envían por correo a los destinatarios</p>
      </div>
      {state.isAdmin ? (
        <AlertSettingsForm settings={state.settings} />
      ) : (
        <p className={styles.notice}>Solo un administrador puede cambiar las reglas de alerta.</p>
      )}
      <AlertList
        alerts={alerts}
        deliveries={deliveries}
        title="Historial de alertas"
        hint="Últimas 50, de la más reciente a la más antigua"
      />
    </div>
  );
}
