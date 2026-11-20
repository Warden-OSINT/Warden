'use client';

import { ASSET_TYPES, type AssetType } from '@warden/shared';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { addAsset, setAssetsStatus, type ActionResult } from '@/app/(dashboard)/actions';
import styles from '@/components/dashboard/dashboard.module.css';
import { formatDate } from '@/components/dashboard/format';
import { StatCard } from '@/components/dashboard/stat-card';
import type { AttributionStatus } from '@/lib/dashboard-types';
import type { AssetDetail } from '@/lib/assets';
import own from './assets.module.css';

const TYPE_LABELS: Record<AssetType, string> = {
  domain: 'Dominio',
  subdomain: 'Subdominio',
  ip: 'IP',
  ip_range: 'Rango IP',
  asn: 'ASN',
  code_org: 'Org. de código',
};

const TYPE_PLACEHOLDERS: Record<AssetType, string> = {
  domain: 'empresa.com.mx',
  subdomain: 'portal.empresa.com.mx',
  ip: '203.0.113.10',
  ip_range: '203.0.113.0/24',
  asn: 'AS64500',
  code_org: 'github.com/empresa',
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

const STATUSES = Object.keys(STATUS_LABELS) as AttributionStatus[];
// Los pendientes van primero: solo los confirmados se escanean (ver run-scan.ts).
const STATUS_ORDER: Record<AttributionStatus, number> = { pending: 0, confirmed: 1, discarded: 2 };

export function AssetInventory({ assets }: { assets: AssetDetail[] }) {
  const [status, setStatus] = useState<AttributionStatus | ''>(
    assets.some((a) => a.status === 'pending') ? 'pending' : '',
  );
  const [type, setType] = useState<AssetType | ''>('');
  const [origin, setOrigin] = useState<'' | 'auto' | 'manual'>('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const rows = assets
    .filter((a) => !status || a.status === status)
    .filter((a) => !type || a.type === type)
    .filter((a) => !origin || a.discoverySource === origin)
    .filter((a) => !q || a.value.toLowerCase().includes(q))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.value.localeCompare(b.value));
  const countBy = (s: AttributionStatus) => assets.filter((a) => a.status === s).length;

  // La selección solo cuenta lo que sigue visible con los filtros actuales.
  const visibleSelected = rows.filter((a) => selected.has(a.id));
  const allVisibleSelected = rows.length > 0 && visibleSelected.length === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(rows.map((a) => a.id)));
  }

  function apply(ids: string[], next: AttributionStatus) {
    setError(null);
    startTransition(async () => {
      const result = await setAssetsStatus(ids, next);
      if (result.error) setError(result.error);
      else setSelected(new Set());
    });
  }

  return (
    <>
      <div className={styles.statsGrid}>
        <StatCard label="Confirmados" value={countBy('confirmed')} hint="entran en cada escaneo" />
        <StatCard label="Por confirmar" value={countBy('pending')} hint="descubiertos, sin revisar" />
        <StatCard label="Descartados" value={countBy('discarded')} hint="no pertenecen a la empresa" />
        <StatCard
          label="Con hallazgos abiertos"
          value={assets.filter((a) => a.openFindings > 0).length}
          hint={`de ${assets.length} activos`}
        />
      </div>

      <AddAssetForm />

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Inventario</h2>
            <p className={styles.cardHint}>
              Los activos descubiertos llegan como &quot;por confirmar&quot;; solo los confirmados se escanean
            </p>
          </div>
          <span className={styles.inlineActions}>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={styles.chip}
                style={{ color: STATUS_COLORS[s], cursor: 'pointer', opacity: status === s ? 1 : 0.6 }}
                onClick={() => setStatus(status === s ? '' : s)}
              >
                {STATUS_LABELS[s]} · {countBy(s)}
              </button>
            ))}
          </span>
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
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select className={styles.select} value={type} onChange={(e) => setType(e.target.value as AssetType | '')}>
            <option value="">Todos los tipos</option>
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={origin}
            onChange={(e) => setOrigin(e.target.value as '' | 'auto' | 'manual')}
          >
            <option value="">Cualquier origen</option>
            <option value="auto">Descubierto</option>
            <option value="manual">Manual</option>
          </select>
        </div>

        {visibleSelected.length > 0 && (
          <div className={own.bulkBar}>
            <span>{visibleSelected.length} seleccionados</span>
            <span className={styles.inlineActions}>
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={s === 'confirmed' ? styles.button : styles.buttonGhost}
                  disabled={pending || visibleSelected.every((a) => a.status === s)}
                  onClick={() => apply(visibleSelected.map((a) => a.id), s)}
                >
                  {s === 'pending' ? 'Volver a por confirmar' : s === 'confirmed' ? 'Confirmar' : 'Descartar'}
                </button>
              ))}
            </span>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={own.check}>
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos los visibles"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th>Activo</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Origen</th>
                <th className={styles.num}>Hallazgos abiertos</th>
                <th>Primera vez</th>
                <th>Última vez</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className={own.check}>
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${a.value}`}
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                  </td>
                  <td>{a.value}</td>
                  <td className={styles.muted}>{TYPE_LABELS[a.type]}</td>
                  <td>
                    <span className={styles.pill} style={{ color: STATUS_COLORS[a.status] }}>
                      {STATUS_LABELS[a.status]}
                    </span>
                  </td>
                  <td className={styles.muted}>{a.discoverySource === 'auto' ? 'Descubierto' : 'Manual'}</td>
                  <td className={`${styles.num} ${a.openFindings === 0 ? styles.muted : ''}`}>{a.openFindings}</td>
                  <td className={styles.muted}>{formatDate(a.firstSeen)}</td>
                  <td className={styles.muted}>{formatDate(a.lastSeen)}</td>
                  <td className={styles.num}>
                    {a.status !== 'confirmed' && (
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={pending}
                        onClick={() => apply([a.id], 'confirmed')}
                      >
                        Confirmar
                      </button>
                    )}
                    {a.status === 'pending' && (
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={pending}
                        onClick={() => apply([a.id], 'discarded')}
                      >
                        Descartar
                      </button>
                    )}
                    {a.status === 'confirmed' && (
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={pending}
                        onClick={() => apply([a.id], 'pending')}
                      >
                        Quitar confirmación
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className={styles.empty}>
              {assets.length === 0 ? 'Todavía no hay activos registrados.' : 'Ningún activo coincide con los filtros.'}
            </p>
          )}
        </div>
      </section>
    </>
  );
}

function AddAssetForm() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(addAsset, {});
  const [type, setType] = useState<AssetType>('subdomain');
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  // Limpia el valor tras un alta correcta, sin perder el tipo elegido.
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) formRef.current?.reset();
    wasPending.current = pending;
  }, [pending, state]);

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Agregar activo</h2>
          <p className={styles.cardHint}>
            Lo que registres aquí entra confirmado. Warden solo lo consulta en fuentes públicas, nunca le envía tráfico.
          </p>
        </div>
      </header>
      <form ref={formRef} action={formAction} className={own.addForm}>
        <select
          className={styles.select}
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as AssetType)}
          aria-label="Tipo de activo"
        >
          {ASSET_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          className={`${styles.input} ${own.valueInput}`}
          name="value"
          required
          placeholder={TYPE_PLACEHOLDERS[type]}
          aria-label="Valor del activo"
          autoComplete="off"
        />
        <button type="submit" className={styles.button} disabled={pending}>
          {pending ? 'Agregando…' : 'Agregar'}
        </button>
      </form>
      {state.error && <p className={styles.error}>{state.error}</p>}
    </section>
  );
}
