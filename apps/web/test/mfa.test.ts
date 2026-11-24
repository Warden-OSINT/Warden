import assert from 'node:assert/strict';
import test from 'node:test';
import { isTotpCode, mfaGate, normalizeTotpCode } from '../src/lib/mfa.ts';

test('exige AAL2 en toda la app y manda al paso del código con AAL1', () => {
  assert.equal(mfaGate('/', 'aal1'), 'to-mfa');
  assert.equal(mfaGate('/settings/users', null), 'to-mfa');
  assert.equal(mfaGate('/api/scans', 'aal1'), 'to-mfa');
  assert.equal(mfaGate('/mfa', 'aal1'), 'allow');
  assert.equal(mfaGate('/', 'aal2'), 'allow');
  assert.equal(mfaGate('/mfa', 'aal2'), 'to-home');
  assert.equal(mfaGate('/mfasomething', 'aal1'), 'to-mfa');
});

test('deja /login libre para cambiar de cuenta', () => {
  assert.equal(mfaGate('/login', 'aal1'), 'allow');
  assert.equal(mfaGate('/login', 'aal2'), 'allow');
});

test('valida códigos TOTP de 6 dígitos', () => {
  assert.equal(normalizeTotpCode(' 123 456 '), '123456');
  assert.ok(isTotpCode('012345'));
  for (const code of ['12345', '1234567', '12a456', '']) assert.ok(!isTotpCode(code));
});
