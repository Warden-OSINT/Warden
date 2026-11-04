// Formas y etiquetas de la programación de escaneos, sin dependencias del servidor:
// las usan tanto la página (Server Component) como el formulario (Client Component).

import type { ScanStatus } from '@warden/shared';

export const SCHEDULE_FREQUENCIES = ['weekly', 'monthly'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  weekly: 'Cada semana',
  monthly: 'Cada mes',
};

export interface Schedule {
  frequency: ScheduleFrequency;
  nextRunAt: string;
  isActive: boolean;
}

export interface ScheduledScan {
  id: string;
  status: ScanStatus;
  createdAt: string;
}
