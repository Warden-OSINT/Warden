'use client';

import { useActionState } from 'react';
import { registerCompany, type ActionResult } from '@/app/(dashboard)/actions';
import styles from './dashboard.module.css';

// Primer uso: Warden evalúa a una sola empresa, así que el dashboard pide registrarla.
export function CompanySetup() {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(registerCompany, {});

  return (
    <section className={`${styles.card} ${styles.setup}`}>
      <h1 className={styles.pageTitle}>Registra la empresa a evaluar</h1>
      <p className={styles.subtitle}>
        Warden solo consulta fuentes públicas sobre este dominio; nunca envía tráfico a sus servidores.
      </p>
      <form action={formAction} className={styles.form}>
        <label className={styles.field}>
          <span>Nombre</span>
          <input className={styles.input} name="name" required placeholder="Empresa S.A. de C.V." />
        </label>
        <label className={styles.field}>
          <span>Dominio principal</span>
          <input className={styles.input} name="domain" required placeholder="empresa.com.mx" />
        </label>
        {state.error && <p className={styles.error}>{state.error}</p>}
        <button type="submit" className={styles.button} disabled={pending}>
          {pending ? 'Registrando…' : 'Registrar empresa'}
        </button>
      </form>
    </section>
  );
}
