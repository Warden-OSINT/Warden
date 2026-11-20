'use client';

import type { AssetType } from '@warden/shared';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { setAssetStatus } from '@/app/(dashboard)/actions';
import type { AssetRow, AttributionStatus } from '@/lib/dashboard-types';
import styles from './dashboard.module.css';
import { formatDate } from './format';

const TYPE_LABELS: Record<AssetType, string> = {
  domain: 'Dominio',
  subdomain: 'Subdominio',
  ip: 'IP',
  ip_range: 'Rango IP',
  asn: 'ASN',
  code_org: 'Org. de código',
};

const STATUS_LABELS: Record<AttributionStatus, string> = {
  pending: 'Por confirmar',
  confirmed: 'Confirmado',
  discarded: 'Descartado',
};

const STATUS_COLORS: Record<AttributionStatus, string> = {
  pending: 'var(--grade-c)',
  confirmed: 'var(--grade-a)',
  discarded: 'var(--muted)',
};

// Los pendientes van primero: solo los confirmados se escanean (ver run-scan.ts).
const STATUS_ORDER: Record<AttributionStatus, number> = { pending: 0, confirmed: 1, discarded: 2 };

// El dashboard es un resumen: el inventario completo vive en /assets.
const MAX_ROWS = 15;

export function AssetsTable({ assets, editable }: { assets: AssetRow[]; editable: boolean }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AttributionStatus | ''>('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function changeStatus(assetId: string, next: AttributionStatus) {
    setError(null);
    startTransition(async () => {
      const result = await setAssetStatus(assetId, next);
      if (result.error) setError(result.error);
    });
  }

  const q = query.trim().toLowerCase();
  const rows = assets
    .filter((a) => !q || a.value.toLowerCase().includes(q))
    .filter((a) => !status || a.status === status)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.value.localeCompare(b.value));
  const visible = rows.slice(0, MAX_ROWS);
  const pendingCount = assets.filter((a) => a.status === 'pending').length;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Activos</h2>
          <p className={styles.cardHint}>Solo los confirmados entran en los escaneos</p>
        </div>
        {pendingCount > 0 && (
          <span className={styles.chip} style={{ color: STATUS_COLORS.pending }}>
            {pendingCount} por confirmar
          </span>
        )}
      </header>

      <div className={styles.filters}>
        <input
          className={styles.input}
          type="search"
          placeholder="Buscar activo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={styles.select}
          value={status}
          onChange={(e) => setStatus(e.target.value as AttributionStatus | '')}
        >
          <option value="">Todos los estados</option>
          {(Object.keys(STATUS_LABELS) as AttributionStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={`${styles.tableWrap} ${styles.tableScroll}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Activo</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Origen</th>
              <th>Visto por última vez</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.id}>
                <td>{a.value}</td>
                <td className={styles.muted}>{TYPE_LABELS[a.type]}</td>
                <td>
                  <span className={styles.pill} style={{ color: STATUS_COLORS[a.status] }}>
                    {STATUS_LABELS[a.status]}
                  </span>
                </td>
                <td className={styles.muted}>{a.discoverySource === 'auto' ? 'Descubierto' : 'Manual'}</td>
                <td className={styles.muted}>{formatDate(a.lastSeen)}</td>
                {editable && (
                  <td className={styles.num}>
                    {a.status !== 'confirmed' && (
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={pending}
                        onClick={() => changeStatus(a.id, 'confirmed')}
                      >
                        Confirmar
                      </button>
                    )}
                    {a.status === 'pending' && (
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={pending}
                        onClick={() => changeStatus(a.id, 'discarded')}
                      >
                        Descartar
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className={styles.empty}>Ningún activo coincide con los filtros.</p>}
      </div>

      {rows.length > MAX_ROWS && (
        <div className={styles.tableFooter}>
          <span>
            Mostrando {MAX_ROWS} de {rows.length}
          </span>
          <Link href="/assets" className={styles.linkButton}>
            Ver todos en Activos
          </Link>
        </div>
      )}
    </section>
  );
}
