import Link from 'next/link';
import { AssetsTable } from '@/components/dashboard/assets-table';
import { CompanySetup } from '@/components/dashboard/company-setup';
import styles from '@/components/dashboard/dashboard.module.css';
import { DomainBreakdown } from '@/components/dashboard/domain-breakdown';
import { EmailPanel } from '@/components/dashboard/email-panel';
import { ExposurePanel } from '@/components/dashboard/exposure-panel';
import { formatDate } from '@/components/dashboard/format';
import { RecentFindings } from '@/components/dashboard/recent-findings';
import { ReputationPanel } from '@/components/dashboard/reputation-panel';
import { ScanControls } from '@/components/dashboard/scan-controls';
import { ScoreGauge } from '@/components/dashboard/score-gauge';
import { SourcesCard } from '@/components/dashboard/sources-card';
import { StatCard } from '@/components/dashboard/stat-card';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { InfoTip } from '@/components/info-tip';
import { alertText } from '@/components/reports/alert-text';
import { loadDashboard } from '@/lib/dashboard-data';
import { SCORING_HELP } from '@/lib/dashboard-types';

// Lee Supabase en cada request: los escaneos del worker cambian los datos.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const state = await loadDashboard();
  if (state.kind === 'no-company') return <CompanySetup />;

  const { company, domains, assets, recentFindings, trend, exposure, email, reputation, sources, lastScan, isAdmin, mode, latestAlert } =
    state.data;
  const delta =
    company.score === null || company.previousScore === null ? null : company.score - company.previousScore;
  const confirmedAssets = assets.filter((a) => a.status === 'confirmed').length;
  const pendingAssets = assets.filter((a) => a.status === 'pending').length;
  const affectedDomains = domains.filter((d) => d.findingsCount > 0).length;
  const live = mode === 'live';

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{company.name}</h1>
          <p className={styles.subtitle}>
            {company.primaryDomain}
            {company.lastScanAt ? ` · último escaneo completo ${formatDate(company.lastScanAt)}` : ' · sin escaneos'}
            {company.nextScanAt && ` · próximo ${formatDate(company.nextScanAt)}`}
            {!live && ' · datos de ejemplo'}
          </p>
        </div>
        {live && <ScanControls companyId={company.id} lastScan={lastScan} />}
      </div>

      {latestAlert && (
        <p className={styles.notice} style={{ color: 'var(--grade-f)', borderLeft: '3px solid var(--grade-f)' }}>
          <strong>Alerta:</strong> {alertText(latestAlert)} ·{' '}
          <Link href={`/reports/${latestAlert.scoreId}`} className={styles.linkButton}>
            Ver reporte
          </Link>
        </p>
      )}

      <div className={styles.statsGrid}>
        <StatCard
          label={<InfoTip tip={SCORING_HELP.kri}>KRI</InfoTip>}
          value={company.score === null ? '—' : company.score.toFixed(1)}
          hint={
            company.score === null
              ? 'sin escaneos calificados'
              : delta === null
                ? 'de 100'
                : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} vs. escaneo anterior`
          }
          aside={company.grade && company.score !== null && <ScoreGauge grade={company.grade} score={company.score} />}
        />
        <StatCard
          label="Hallazgos abiertos"
          value={company.openFindings}
          hint={`en ${affectedDomains} de ${domains.length} dominios`}
        />
        <StatCard label="Críticos abiertos" value={company.openCriticalFindings} hint="hallazgos sin resolver" />
        <StatCard
          label="Activos"
          value={confirmedAssets}
          hint={pendingAssets > 0 ? `confirmados · ${pendingAssets} por confirmar` : 'confirmados'}
        />
      </div>

      <ExposurePanel exposure={exposure} isAdmin={isAdmin && live} />

      {/* Reputación y Correo apilados a la izquierda: juntos igualan la altura de Fuentes. */}
      <div className={styles.rowWide}>
        <div className={styles.columnStack}>
          <ReputationPanel reputation={reputation} isAdmin={isAdmin && live} />
          <EmailPanel email={email} isAdmin={isAdmin && live} />
        </div>
        <SourcesCard sources={sources} isAdmin={isAdmin && live} />
      </div>

      <div className={styles.rowHalf}>
        <DomainBreakdown domains={domains} />
        <TrendChart points={trend} />
      </div>

      <div className={styles.rowWide}>
        <AssetsTable assets={assets} editable={live} />
        <RecentFindings findings={recentFindings} />
      </div>
    </div>
  );
}
