'use client';

import { GRADES } from '@warden/shared';
import { useActionState } from 'react';
import { saveAlertSettings, type ActionResult } from '@/app/(dashboard)/settings/actions';
import styles from '@/components/dashboard/dashboard.module.css';
import type { AlertSettings } from '@/lib/scoring-settings';

export function AlertSettingsForm({ settings }: { settings: AlertSettings }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(saveAlertSettings, {});
  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Reglas de alerta</h2>
          <p className={styles.cardHint}>
            Siempre se alerta cuando la nota global baja. Con umbral, también al quedar por debajo de él.
          </p>
        </div>
      </header>
      <form action={formAction} className={styles.form} style={{ marginTop: 0 }}>
        {state.error && <p className={styles.error}>{state.error}</p>}
        {state.ok && <p className={styles.notice}>{state.ok}</p>}
        <label className={styles.field}>
          Alertar si la nota queda por debajo de
          <select name="threshold" className={styles.select} defaultValue={settings.thresholdGrade ?? ''}>
            <option value="">Sin umbral</option>
            {/* F no tiene nota peor: no sirve como umbral. */}
            {GRADES.filter((g) => g !== 'F').map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          Destinatarios (correo; uno por línea o separados por coma)
          <textarea
            name="recipients"
            className={styles.input}
            rows={3}
            defaultValue={settings.recipients.join('\n')}
            placeholder="seguridad@empresa.com"
          />
          <span className={styles.subText}>
            Cada alerta nueva se envía por correo a estos destinatarios. Sin destinatarios, solo se ve en Warden.
          </span>
        </label>
        <div>
          <button type="submit" className={styles.button} disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </section>
  );
}
