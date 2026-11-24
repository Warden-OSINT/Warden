'use client';

import { useEffect, useState } from 'react';
import styles from './theme-toggle.module.css';

const STORAGE_KEY = 'warden-theme';

export function ThemeToggle() {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    let theme: 'light' | 'dark' = 'dark';
    try {
      theme = window.localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      // Si el almacenamiento local está bloqueado, se conserva el tema oscuro predeterminado.
    }
    document.documentElement.dataset.theme = theme;
    setIsLight(theme === 'light');
  }, []);

  function toggleTheme() {
    const nextTheme = isLight ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    setIsLight(nextTheme === 'light');
    try {
      window.localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // El tema sigue aplicado en esta página aunque no se pueda guardar la preferencia.
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isLight}
      aria-label="Modo claro"
      title={isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      className={styles.toggle}
      onClick={toggleTheme}
    >
      <span className={styles.label}>{isLight ? 'Claro' : 'Oscuro'}</span>
      <span className={`${styles.track} ${isLight ? styles.checked : ''}`} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </button>
  );
}
