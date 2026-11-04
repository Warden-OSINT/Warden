'use client';

import { useActionState, useEffect, useState } from 'react';
import { saveSchedule, type ActionResult } from '@/app/(dashboard)/settings/actions';
import styles from '@/components/dashboard/dashboard.module.css';
import { FREQUENCY_LABELS, SCHEDULE_FREQUENCIES, type Schedule } from '@/lib/schedule';
import settings from './settings.module.css';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → valor de <input type="datetime-local"> en la hora local del navegador. */
function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Sugerencia para la primera programación: el próximo lunes a las 03:00, fuera de horario laboral. */
function nextMondayAt3(): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setHours(3, 0, 0, 0);
  return d;
}

export function ScheduleForm({ schedule }: { schedule: Schedule | null }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(saveSchedule, {});
  // La hora local solo se conoce en el navegador: se calcula tras montar para que el HTML
  // del servidor y el del cliente coincidan.
  const [localValue, setLocalValue] = useState('');
  const [zone, setZone] = useState('');
  useEffect(() => {
    setLocalValue(toLocalInput(schedule ? new Date(schedule.nextRunAt) : nextMondayAt3()));
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [schedule]);

  const parsed = localValue ? new Date(localValue) : null;
  const iso = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : '';

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
            Hora local{zone ? ` (${zone})` : ''}. Conviene fuera de horario laboral: el escaneo tarda varios minutos.
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

