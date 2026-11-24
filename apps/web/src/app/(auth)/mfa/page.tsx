'use client';

// Segundo paso obligatorio tras la contraseña: inscribir el factor TOTP (primer ingreso)
// o escribir su código. El proxy manda aquí toda sesión AAL1.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TotpChallenge } from '@/components/mfa/totp-challenge';
import { TotpEnroll } from '@/components/mfa/totp-enroll';
import styles from '@/components/mfa/mfa.module.css';
import { createClient } from '@/lib/supabase/client';

type Step = { kind: 'loading' } | { kind: 'challenge'; factorId: string } | { kind: 'enroll' } | { kind: 'error' };

export default function MfaPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'loading' });

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const [{ data: aal }, { data: factors, error }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      if (aal?.currentLevel === 'aal2') {
        router.replace('/');
        return;
      }
      if (error) {
        setStep({ kind: 'error' });
        return;
      }
      const verified = factors.totp.find((factor) => factor.status === 'verified');
      setStep(verified ? { kind: 'challenge', factorId: verified.id } : { kind: 'enroll' });
    })();
  }, [router]);

  function enter() {
    router.replace('/');
    router.refresh();
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="mfa-heading">
        <p className={styles.brand}>WARDEN <span className={styles.brandMark}>/</span> OSINT</p>
        {step.kind === 'enroll' ? (
          <>
            <h1 id="mfa-heading" className={styles.title}>Configura tu autenticador</h1>
            <p className={styles.intro}>
              Warden exige verificación en dos pasos para todas las cuentas. Vincula una app como Google
              Authenticator; en cada ingreso te pediremos el código que genera.
            </p>
            <TotpEnroll onEnrolled={enter} />
          </>
        ) : (
          <>
            <h1 id="mfa-heading" className={styles.title}>Verificación en dos pasos</h1>
            <p className={styles.intro}>Escribe el código que muestra tu app autenticadora para Warden.</p>
            {step.kind === 'challenge' && <TotpChallenge factorId={step.factorId} onVerified={enter} />}
            {step.kind === 'loading' && <p className={styles.hint}>Cargando…</p>}
            {step.kind === 'error' && (
              <div className={styles.errorBox} role="alert">No se pudo consultar tu autenticador. Recarga la página.</div>
            )}
          </>
        )}
        <button type="button" className={styles.signOut} onClick={signOut}>
          Cerrar sesión y usar otra cuenta
        </button>
      </section>
    </main>
  );
}
