import { describe, expect, it } from 'vitest';
import type { Db } from '../supabase';
import { isCancellation, watchCancellation } from './cancellation';

/** BD mínima: solo la lectura de scans.status que hace el vigilante. */
const fakeDb = (status: () => string) =>
  ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: status() }, error: null }) }) }),
    }),
  }) as unknown as Db;

describe('watchCancellation', () => {
  it('aborta la señal cuando el escaneo pasa a cancelled', async () => {
    let status = 'running';
    const watch = watchCancellation(fakeDb(() => status), 's1', 60_000);
    try {
      await expect(watch.checkNow()).resolves.toBeUndefined();
      expect(watch.signal.aborted).toBe(false);

      status = 'cancelled';
      await expect(watch.checkNow()).rejects.toSatisfy(isCancellation);
      expect(isCancellation(watch.signal.reason)).toBe(true);
    } finally {
      watch.stop();
    }
  });
});
