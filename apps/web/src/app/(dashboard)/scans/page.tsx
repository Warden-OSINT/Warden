import styles from '@/components/dashboard/dashboard.module.css';
import { ScanControls } from '@/components/dashboard/scan-controls';
import { ScanHistoryTable } from '@/components/scans/scan-history-table';
import { latestScanSummary, loadScanHistory } from '@/lib/scan-history';

// Lee Supabase en cada request: el worker cambia el estado de los escaneos.
export const dynamic = 'force-dynamic';

export default async function ScansPage() {
  const state = await loadScanHistory();

  if (state.kind !== 'ready') {
    return (
      <div className={styles.page}>
        <h1 className={styles.pageTitle}>Escaneos</h1>
        <p className={styles.notice}>
          {state.kind === 'no-company'
            ? 'Registra primero la empresa a evaluar desde el Dashboard.'
            : 'Inicia sesión para ver el historial: sin sesión no hay datos que consultar.'}
        </p>
      </div>
    );
  }

  const { company, scans } = state;
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Escaneos</h1>
          <p className={styles.subtitle}>
            {company.name} · {company.primaryDomain}
          </p>
        </div>
        <ScanControls companyId={company.id} lastScan={latestScanSummary(scans)} />
      </div>
      <ScanHistoryTable scans={scans} />
    </div>
  );
}
