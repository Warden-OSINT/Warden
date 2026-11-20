import Link from 'next/link';
import styles from '@/components/dashboard/dashboard.module.css';
import { ScoringWeights } from '@/components/settings/scoring-weights';
import { loadScoringSettings } from '@/lib/scoring-settings';

export const dynamic = 'force-dynamic';

export default async function ScoringSettingsPage() {
  const state = await loadScoringSettings();
  return (
    <div className={styles.page}>
      <div>
        <Link href="/settings" className={styles.linkButton}>← Configuración</Link>
        <h1 className={styles.pageTitle}>Pesos del KRI</h1>
        <p className={styles.subtitle}>
          Modelo en docs/scoring-model.md · {state.kind === 'ready' && !state.isAdmin ? 'solo lectura: cambiar pesos requiere rol admin' : 'los cambios crean una versión nueva'}
        </p>
      </div>
      {state.kind === 'ready' ? (
        <ScoringWeights versions={state.versions} isAdmin={state.isAdmin} />
      ) : (
        <p className={styles.notice}>Inicia sesión para ver los pesos.</p>
      )}
    </div>
  );
}
