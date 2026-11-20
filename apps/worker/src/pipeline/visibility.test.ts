import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../supabase';
import { keepInvisible } from './visibility';

afterEach(() => vi.useRealTimers());

describe('keepInvisible', () => {
  it('renueva la visibilidad cada tercio del timeout y se detiene con stop()', async () => {
    vi.useFakeTimers();
    const rpc = vi.fn(async () => ({ error: null }));
    const heartbeat = keepInvisible({ rpc } as unknown as Db, 'scan_requests', 7, 900);

    await vi.advanceTimersByTimeAsync(300_000);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('queue_set_vt', { p_queue: 'scan_requests', p_msg_id: 7, p_visibility_timeout: 900 });

    await vi.advanceTimersByTimeAsync(600_000);
    expect(rpc).toHaveBeenCalledTimes(3);

    heartbeat.stop();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('un latido fallido no lanza', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rpc = vi.fn(async () => { throw new Error('red caída'); });
    const heartbeat = keepInvisible({ rpc } as unknown as Db, 'scan_requests', 7, 900);

    await vi.advanceTimersByTimeAsync(300_000);
    expect(warn).toHaveBeenCalledTimes(1);
    heartbeat.stop();
    warn.mockRestore();
  });
});
