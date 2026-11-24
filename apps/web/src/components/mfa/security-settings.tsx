'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import dashboard from '@/components/dashboard/dashboard.module.css';
import { formatDateTime } from '@/components/dashboard/format';
import { MFA_PATH } from '@/lib/mfa';
import { createClient } from '@/lib/supabase/client';
import styles from './mfa.module.css';
import { TotpEnroll } from './totp-enroll';

interface FactorRow {
  id: string;
  name: string;
  createdAt: string;
}

// Autenticadores TOTP del usuario actual: agregar uno (p. ej. un teléfono nuevo) y dar de baja.
export function SecuritySettings() {
  const router = useRouter();
  const [factors, setFactors] = useState<FactorRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: listError } = await createClient().auth.mfa.listFactors();
    if (listError) {
      setError('No se pudieron cargar tus autenticadores');
      return;
    }
    setFactors(data.totp.filter((f) => f.status === 'verified').map((f) => ({
      id: f.id, name: f.friendly_name || 'App autenticadora', createdAt: f.created_at,
    })));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(factor: FactorRow) {
    const isLast = factors?.length === 1;
    const warning = isLast
      ? 'Es tu único autenticador. La verificación en dos pasos es obligatoria: deberás inscribir uno nuevo de inmediato. ¿Continuar?'
      : `¿Dar de baja «${factor.name}»? Ese dispositivo dejará de servir para ingresar.`;
    if (!window.confirm(warning)) return;
    setBusyId(factor.id);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (unenrollError) {
      setBusyId(null);
      setError('No se pudo dar de baja el autenticador');
      return;
    }
    // Auth baja la sesión a AAL1 al quitar un factor verificado: el proxy pedirá el código o un factor nuevo.
    await supabase.auth.refreshSession();
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== 'aal2') {
      router.replace(MFA_PATH);
      router.refresh();
      return;
    }
    setBusyId(null);
    setMessage('Autenticador dado de baja');
    await load();
  }

  return (
    <section className={dashboard.card}>
      <div className={dashboard.cardHeader}>
        <div>
          <h2 className={dashboard.cardTitle}>Verificación en dos pasos (TOTP)</h2>
          <p className={dashboard.cardHint}>
            Obligatoria para todas las cuentas. Cada ingreso pide el código de una app como Google Authenticator.
          </p>
        </div>
        {!adding && (
          <button type="button" className={dashboard.button} onClick={() => setAdding(true)}>
            Agregar autenticador
          </button>
        )}
      </div>

      {error && <p className={dashboard.error} role="alert">{error}</p>}
      {message && <p className={styles.success}>{message}</p>}

      {factors === null ? (
        !error && <p className={styles.hint}>Cargando…</p>
      ) : (
        <ul className={styles.factorList}>
          {factors.map((factor) => (
            <li key={factor.id} className={styles.factor}>
              <div>
                <div className={styles.factorName}>{factor.name}</div>
                <div className={styles.factorMeta}>Inscrito el {formatDateTime(factor.createdAt)}</div>
              </div>
              <button
                type="button"
                className={dashboard.buttonGhost}
                onClick={() => remove(factor)}
                disabled={busyId !== null}
              >
                {busyId === factor.id ? 'Dando de baja…' : 'Dar de baja'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <TotpEnroll
          onCancel={() => setAdding(false)}
          onEnrolled={() => {
            setAdding(false);
            setMessage('Autenticador agregado');
            void load();
          }}
        />
      )}
    </section>
  );
}
