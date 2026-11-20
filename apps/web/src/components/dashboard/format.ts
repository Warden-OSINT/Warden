// Fechas en la hora del centro de México, fija (no la del navegador) para que el render del
// servidor y del cliente coincidan. Desde 2022 México no cambia de horario: es CST (UTC−6)
// todo el año.
export const TIME_ZONE = 'America/Mexico_City';
export const TIME_ZONE_LABEL = 'CST';

const dateFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: TIME_ZONE });

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

const dateTimeFormat = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});

/** Fecha y hora en CST, para el estado de escaneos. */
export function formatDateTime(iso: string): string {
  return `${dateTimeFormat.format(new Date(iso))} ${TIME_ZONE_LABEL}`;
}

const partsFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23', timeZone: TIME_ZONE,
});

/** Fecha y hora de pared en TIME_ZONE, como milisegundos "UTC" (sirve para calcular el desfase). */
function wallClockMs(date: Date): number {
  const p = Object.fromEntries(partsFormat.formatToParts(date).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → valor de <input type="datetime-local"> en hora CST. */
export function toZonedInput(iso: string): string {
  const d = new Date(wallClockMs(new Date(iso)));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Valor de <input type="datetime-local"> leído como hora CST → ISO. '' si no es válido. */
export function zonedInputToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return '';
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Desfase de la zona en ese instante (−6 h en CST), sin suponerlo fijo.
  const offset = wallClockMs(new Date(asUtc)) - asUtc;
  return new Date(asUtc - offset).toISOString();
}
