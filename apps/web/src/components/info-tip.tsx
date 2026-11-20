'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './info-tip.module.css';

const GAP = 6;
/** Espacio mínimo arriba del término para abrir la burbuja hacia arriba. */
const ROOM_ABOVE = 140;
/** Media anchura máxima de la burbuja: la mantiene dentro de la ventana. */
const HALF_WIDTH = 150;

interface Position {
  top: number;
  left: number;
  above: boolean;
}

/**
 * Término con una explicación breve al pasar el mouse o enfocarlo con el teclado (Esc la
 * cierra). La burbuja usa posición fija para no quedar recortada dentro de tablas con scroll.
 * La web la usan personas sin formación en ciberseguridad: el texto debe ser simple.
 */
export function InfoTip({ children, tip }: { children: ReactNode; tip: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.top > ROOM_ABOVE;
    const center = r.left + r.width / 2;
    setPos({
      top: above ? r.top - GAP : r.bottom + GAP,
      left: Math.min(Math.max(center, HALF_WIDTH + 8), window.innerWidth - HALF_WIDTH - 8),
      above,
    });
  }
  const hide = () => setPos(null);

  // Con posición fija, al desplazar la página la burbuja quedaría flotando fuera de lugar.
  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [pos]);

  return (
    <span className={styles.wrap} onMouseEnter={show} onMouseLeave={hide}>
      <span
        ref={ref}
        className={styles.trigger}
        tabIndex={0}
        aria-describedby={id}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => e.key === 'Escape' && hide()}
      >
        {children}
        <span className={styles.icon} aria-hidden>
          ?
        </span>
      </span>
      <span
        role="tooltip"
        id={id}
        className={`${styles.bubble} ${pos ? styles.open : ''}`}
        style={
          pos
            ? { top: pos.top, left: pos.left, transform: `translate(-50%, ${pos.above ? '-100%' : '0'})` }
            : undefined
        }
      >
        {tip}
      </span>
    </span>
  );
}
