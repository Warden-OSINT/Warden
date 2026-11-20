'use client';

import styles from '@/components/dashboard/dashboard.module.css';
import own from './reports.module.css';

// El navegador ofrece "Guardar como PDF"; la generación de PDF en el servidor queda pendiente.
export function PrintButton() {
  return (
    <button type="button" className={`${styles.button} ${own.noPrint}`} onClick={() => window.print()}>
      Imprimir / PDF
    </button>
  );
}
