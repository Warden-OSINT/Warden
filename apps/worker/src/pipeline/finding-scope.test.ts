import { createClient } from '@supabase/supabase-js';
import type { Database } from '@warden/db';
import { FINDING_ASSET_SCOPE_COLUMNS, isAssetInScope, onlyInScopeFindings } from '@warden/shared';
import { describe, expect, it } from 'vitest';

describe('isAssetInScope', () => {
  it('cuenta los hallazgos sin activo', () => {
    expect(isAssetInScope(null)).toBe(true);
  });

  it('cuenta los activos confirmados, manuales o descubiertos', () => {
    expect(isAssetInScope({ attribution_status: 'confirmed', discovery_source: 'manual' })).toBe(true);
    expect(isAssetInScope({ attribution_status: 'confirmed', discovery_source: 'auto' })).toBe(true);
  });

  it('cuenta los pendientes descubiertos por una fuente (aún sin revisar)', () => {
    expect(isAssetInScope({ attribution_status: 'pending', discovery_source: 'auto' })).toBe(true);
  });

  it('excluye los manuales a los que se les quitó la confirmación', () => {
    expect(isAssetInScope({ attribution_status: 'pending', discovery_source: 'manual' })).toBe(false);
  });

  it('excluye los descartados, sin importar su origen', () => {
    expect(isAssetInScope({ attribution_status: 'discarded', discovery_source: 'manual' })).toBe(false);
    expect(isAssetInScope({ attribution_status: 'discarded', discovery_source: 'auto' })).toBe(false);
  });
});

describe('onlyInScopeFindings', () => {
  // El builder real de supabase-js arma la URL sin red: así se prueba el filtro que llega a PostgREST.
  const db = createClient<Database>('http://127.0.0.1:54321', 'llave-de-prueba');

  it('filtra el embed de assets y descarta las filas con activo fuera de alcance', () => {
    const query = onlyInScopeFindings(
      db.from('findings').select(`id, assets(${FINDING_ASSET_SCOPE_COLUMNS})`).eq('status', 'open'),
    );
    const params = new URL(String((query as unknown as { url: URL }).url)).searchParams;

    expect(params.get('select')).toBe('id,assets(attribution_status,discovery_source)');
    expect(params.get('assets.or')).toBe(
      '(attribution_status.eq.confirmed,and(attribution_status.eq.pending,discovery_source.eq.auto))',
    );
    expect(params.get('or')).toBe('(asset_id.is.null,assets.not.is.null)');
    expect(params.get('status')).toBe('eq.open');
  });
});
