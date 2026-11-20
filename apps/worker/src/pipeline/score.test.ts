import { describe, expect, it } from 'vitest';
import { toWeightItems } from './score';

describe('toWeightItems', () => {
  it('convierte numeric y jsonb de BD e ignora dominios desconocidos', () => {
    const items = toWeightItems([
      {
        weight: '25.00',
        severity_points: { critical: 40, high: 20, extra: 1 },
        confidence_factors: { high: 1, medium: '0.75' },
        risk_domains: { key: 'exposure' },
      },
      { weight: 10, severity_points: {}, confidence_factors: {}, risk_domains: { key: 'credentials' } },
    ]);

    expect(items).toEqual([{
      riskDomain: 'exposure',
      weight: 25,
      severityPoints: { critical: 40, high: 20 },
      // Un valor no numérico se descarta y computeScore rechaza la versión incompleta.
      confidenceFactors: { high: 1 },
    }]);
  });
});
