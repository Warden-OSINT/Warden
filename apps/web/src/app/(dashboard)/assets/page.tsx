import { AssetInventory } from '@/components/assets/asset-inventory';
import styles from '@/components/dashboard/dashboard.module.css';
import { loadAssets } from '@/lib/assets';

// Lee Supabase en cada request: el worker descubre activos y los analistas los confirman.
export const dynamic = 'force-dynamic';

export default async function AssetsPage() {
  const state = await loadAssets();

  if (state.kind !== 'ready') {
    return (
      <div className={styles.page}>
        <h1 className={styles.pageTitle}>Activos</h1>
        <p className={styles.notice}>
          {state.kind === 'no-company'
            ? 'Registra primero la empresa a evaluar desde el Dashboard.'
            : 'Inicia sesión para ver los activos: sin sesión no hay datos que consultar.'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.pageTitle}>Activos</h1>
        <p className={styles.subtitle}>
          {state.company.name} · {state.company.primaryDomain} · dominios, subdominios, IPs y ASN que Warden evalúa
        </p>
      </div>
      <AssetInventory assets={state.assets} />
    </div>
  );
}
