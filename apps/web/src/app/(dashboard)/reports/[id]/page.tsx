import { notFound } from 'next/navigation';
import styles from '@/components/dashboard/dashboard.module.css';
import { ReportView } from '@/components/reports/report-view';
import { loadReport } from '@/lib/reports';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const state = await loadReport(id);
  if (state.kind === 'not-found') notFound();
  if (state.kind !== 'ready') {
    return (
      <div className={styles.page}>
        <h1 className={styles.pageTitle}>Reporte</h1>
        <p className={styles.notice}>
          {state.kind === 'no-company'
            ? 'Registra primero la empresa a evaluar desde el Dashboard.'
            : 'Inicia sesión para ver el reporte.'}
        </p>
      </div>
    );
  }
  return <ReportView report={state.report} />;
}
