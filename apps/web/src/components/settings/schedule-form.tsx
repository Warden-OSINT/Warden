'use client';

import { useActionState, useEffect, useState } from 'react';
import { saveSchedule, type ActionResult } from '@/app/(dashboard)/settings/actions';
import styles from '@/components/dashboard/dashboard.module.css';
import { TIME_ZONE_LABEL, toZonedInput, zonedInputToIso } from '@/components/dashboard/format';
import { FREQUENCY_LABELS, SCHEDULE_FREQUENCIES, type Schedule } from '@/lib/schedule';
import settings from './settings.module.css';

const pad = (n: number) => String(n).padStart(2, '0');

/** Sugerencia para la primera programación: el próximo lunes a las 03:00 CST, fuera de horario laboral. */
function nextMondayAt3(): string {
  const [y, m, d] = toZonedInput(new Date().toISOString()).slice(0, 10).split('-').map(Number) as [number, number, number];
  const today = new Date(Date.UTC(y, m - 1, d));
  today.setUTCDate(today.getUTCDate() + ((8 - today.getUTCDay()) % 7 || 7));
  return `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}T03:00`;
}

export function ScheduleForm({ schedule }: { schedule: Schedule | null }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(saveSchedule, {});
  // La fecha se captura en CST, sin importar la zona del navegador. La sugerencia depende de
  // "ahora": se calcula tras montar para que el HTML del servidor y el del cliente coincidan.
  const [localValue, setLocalValue] = useState('');
  useEffect(() => {
    setLocalValue(schedule ? toZonedInput(schedule.nextRunAt) : nextMondayAt3());
  }, [schedule]);

  const iso = zonedInputToIso(localValue);

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>{schedule ? 'Editar programación' : 'Programar escaneos'}</h2>
          <p className={styles.cardHint}>
            Warden revisa cada 15 minutos si toca escanear; al ejecutarse, la próxima fecha avanza según la frecuencia.
          </p>
        </div>
      </header>
      <form action={formAction} className={styles.form} style={{ marginTop: 0 }}>
        {state.error && <p className={styles.error}>{state.error}</p>}
        {state.ok && <p className={styles.notice}>{state.ok}</p>}
        <label className={styles.field}>
          Frecuencia
          <select name="frequency" className={styles.select} defaultValue={schedule?.frequency ?? 'weekly'}>
            {SCHEDULE_FREQUENCIES.map((f) => (
              <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Próxima ejecución
          <input
            type="datetime-local"
            className={styles.input}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            required
          />
          <span className={styles.subText}>
            Hora del centro de México ({TIME_ZONE_LABEL}). Conviene fuera de horario laboral: el escaneo tarda varios minutos.
          </span>
        </label>
        <input type="hidden" name="nextRunAt" value={iso} />
        <label className={settings.checkbox}>
          <input type="checkbox" name="active" defaultChecked={schedule?.isActive ?? true} />
          Programación activa
        </label>
        <div>
          <button type="submit" className={styles.button} disabled={pending || !iso}>
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </section>
  );
}

