'use client';

import { useState, useTransition } from 'react';
import { setSourceEnabled } from '@/app/(dashboard)/actions';
import styles from './dashboard.module.css';

export function SourceToggle({ sourceKey, enabled }: { sourceKey: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await setSourceEnabled(sourceKey, !enabled);
      if (result.error) setError(result.error);
    });
  }

  return (
    <span className={styles.inlineActions}>
      <button
        type="button"
        className={enabled ? styles.buttonGhost : styles.button}
        onClick={onClick}
        disabled={pending}
      >
        {enabled ? 'Deshabilitar fuente' : 'Habilitar fuente'}
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </span>
  );
}
