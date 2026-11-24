'use client';

import { useState, type FormEvent } from 'react';
import { isTotpCode, normalizeTotpCode } from '@/lib/mfa';
import { createClient } from '@/lib/supabase/client';
import styles from './mfa.module.css';

// Segundo paso del login: verifica el código TOTP y sube la sesión de AAL1 a AAL2.
export function TotpChallenge({ factorId, onVerified }: { factorId: string; onVerified: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = normalizeTotpCode(code);
    if (!isTotpCode(value)) {
      setError('Escribe el código de 6 dígitos que muestra tu app');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: value });
    if (verifyError) {
      setBusy(false);
      setCode('');
      setError('Código incorrecto o vencido. Espera el siguiente e intenta de nuevo.');
      return;
    }
    onVerified();
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form} noValidate>
      {error && <div className={styles.errorBox} role="alert">{error}</div>}
      <label htmlFor="totp-code" className={styles.label}>Código de 6 dígitos</label>
      <input
        id="totp-code"
        className={styles.codeInput}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        disabled={busy}
        autoFocus
      />
      <button type="submit" className={styles.button} disabled={busy}>
        {busy ? 'Verificando…' : 'Verificar'}
      </button>
    </form>
  );
}
