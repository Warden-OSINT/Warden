'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatDateTime } from '@/components/dashboard/format';
import { isTotpCode, normalizeTotpCode, TOTP_ISSUER } from '@/lib/mfa';
import { createClient } from '@/lib/supabase/client';
import styles from './mfa.module.css';

interface PendingFactor {
  id: string;
  qrCode: string;
  secret: string;
}

// Inscribe un factor TOTP: muestra el QR y el secreto y lo activa al verificar el primer código.
// Verificarlo sube la sesión a AAL2.
export function TotpEnroll({ onEnrolled, onCancel }: { onEnrolled: () => void; onCancel?: () => void }) {
  const [factor, setFactor] = useState<PendingFactor | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // En desarrollo React monta dos veces los efectos: evita inscribir dos factores.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const supabase = createClient();
      // Un intento anterior sin terminar deja un factor sin verificar que ya no sirve.
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const old of list?.all ?? []) {
        if (old.factor_type === 'totp' && old.status === 'unverified') {
          await supabase.auth.mfa.unenroll({ factorId: old.id });
        }
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: TOTP_ISSUER,
        friendlyName: `Autenticador · ${formatDateTime(new Date().toISOString())}`,
      });
      if (enrollError || !data) {
        setError('No se pudo iniciar la inscripción. Recarga la página e intenta de nuevo.');
        return;
      }
      setFactor({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factor) return;
    const value = normalizeTotpCode(code);
    if (!isTotpCode(value)) {
      setError('Escribe el código de 6 dígitos que muestra tu app');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId: factor.id, code: value });
    setBusy(false);
    if (verifyError) {
      setError('Código incorrecto o vencido. Espera el siguiente e intenta de nuevo.');
      return;
    }
    onEnrolled();
  }

  return (
    <div className={styles.enroll}>
      <ol className={styles.steps}>
        <li>Abre Google Authenticator (u otra app TOTP) y elige agregar una cuenta.</li>
        <li>Escanea el código QR o escribe la clave manualmente.</li>
        <li>Escribe el código de 6 dígitos que aparece en la app.</li>
      </ol>

      {factor ? (
        <div className={styles.qrBlock}>
          {/* El QR llega como data URI SVG generado por Supabase Auth; no pasa por el optimizador. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={factor.qrCode} alt="Código QR para tu app autenticadora" className={styles.qr} width={180} height={180} />
          <div className={styles.secret}>
            <span className={styles.secretLabel}>Clave para ingreso manual</span>
            <code className={styles.secretValue}>{factor.secret}</code>
          </div>
        </div>
      ) : (
        !error && <p className={styles.hint}>Generando código QR…</p>
      )}

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        {error && <div className={styles.errorBox} role="alert">{error}</div>}
        <label htmlFor="totp-enroll-code" className={styles.label}>Código de verificación</label>
        <input
          id="totp-enroll-code"
          className={styles.codeInput}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={!factor || busy}
        />
        <div className={styles.actions}>
          <button type="submit" className={styles.button} disabled={!factor || busy}>
            {busy ? 'Verificando…' : 'Activar autenticador'}
          </button>
          {onCancel && (
            <button type="button" className={styles.buttonGhost} onClick={onCancel} disabled={busy}>
              Cancelar
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
