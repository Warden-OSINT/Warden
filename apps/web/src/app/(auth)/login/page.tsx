'use client';

// Formulario portado de frontend/frontend (Login.tsx), ahora contra Supabase Auth
// con usuario local o correo + contraseña. Los roles viven en public.profiles.

import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { isValidIdentifier, normalizeIdentifier, toAuthEmail } from '@/lib/local-user';
import { createClient } from '@/lib/supabase/client';
import styles from './login.module.css';

interface LoginError {
  field: 'email' | 'password' | 'general';
  message: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [error, setError] = useState<LoginError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setCredentials((prev) => ({ ...prev, [name]: value }));
    if (error?.field === name) setError(null);
  }

  function validate(): boolean {
    if (!credentials.email.trim()) {
      setError({ field: 'email', message: 'El usuario o correo es obligatorio' });
      return false;
    }
    if (!isValidIdentifier(normalizeIdentifier(credentials.email))) {
      setError({ field: 'email', message: 'Usuario o correo inválido' });
      return false;
    }
    if (credentials.password.length < 6) {
      setError({ field: 'password', message: 'La contraseña debe tener al menos 6 caracteres' });
      return false;
    }
    return true;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setIsLoading(true);
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: toAuthEmail(normalizeIdentifier(credentials.email)),
        password: credentials.password,
      });
      if (authError) {
        setError({ field: 'general', message: 'Credenciales incorrectas' });
        return;
      }
      const { data: profile, error: profileError } = await supabase.from('profiles')
        .select('is_active').eq('id', data.user.id).single();
      if (profileError || !profile?.is_active) {
        await supabase.auth.signOut();
        setError({ field: 'general', message: profileError
          ? 'No se pudo comprobar el acceso. Intenta de nuevo.'
          : 'Tu cuenta está inactiva. Solicita su activación a un administrador.' });
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError({ field: 'general', message: 'No se pudo conectar con el servidor' });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        <h1 className={styles.brand}>Warden</h1>
        <h2 className={styles.title}>Iniciar sesión</h2>

        {error?.field === 'general' && <div className={styles.errorBox}>{error.message}</div>}

        <div className={styles.field}>
          <label htmlFor="email" className={styles.label}>
            Usuario o correo
          </label>
          <input
            id="email"
            name="email"
            type="text"
            value={credentials.email}
            onChange={handleChange}
            placeholder="analista o tu@email.com"
            className={`${styles.input} ${error?.field === 'email' ? styles.inputError : ''}`}
            disabled={isLoading}
            autoComplete="username"
          />
          {error?.field === 'email' && <span className={styles.errorText}>{error.message}</span>}
        </div>

        <div className={styles.field}>
          <label htmlFor="password" className={styles.label}>
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            value={credentials.password}
            onChange={handleChange}
            placeholder="******"
            className={`${styles.input} ${error?.field === 'password' ? styles.inputError : ''}`}
            disabled={isLoading}
            autoComplete="current-password"
          />
          {error?.field === 'password' && <span className={styles.errorText}>{error.message}</span>}
        </div>

        <button type="submit" disabled={isLoading} className={styles.button}>
          {isLoading ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
