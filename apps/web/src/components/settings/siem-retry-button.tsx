'use client';

import { useActionState } from 'react';
import { retrySiemEvents, type ActionResult } from '@/app/(dashboard)/settings/actions';
import styles from '@/components/dashboard/dashboard.module.css';

export function SiemRetryButton({ failed }: { failed: number }) {
  const [state, formAction, pending] = useActionState<ActionResult>(retrySiemEvents, {});
  return (
    <form action={formAction} style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
      <button type="submit" className={styles.button} disabled={pending || failed === 0}>
        {pending ? 'Reintentando…' : `Reintentar fallidos (${failed})`}
      </button>
      {state.error && <p className={styles.error}>{state.error}</p>}
      {state.ok && <p className={styles.notice}>{state.ok}</p>}
    </form>
  );
}
