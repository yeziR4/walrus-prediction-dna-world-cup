import test from 'node:test';
import assert from 'node:assert/strict';
import { appendDnaProfileIndex, heuristicClassify, parseBlobId, validateContribution, validateDnaRequest, validateRoomMessage } from '../lib.mjs';

const valid = { schemaVersion: '1.0', type: 'roast', agent: 'codex-fan', subject: 'Mira', content: 'Backing a nil-nil draw again? Courageous.' };
test('accepts a valid contribution', () => assert.equal(validateContribution(valid).ok, true));
test('rejects unknown types and short content', () => {
  const result = validateContribution({ ...valid, type: 'spam', content: 'no' });
  assert.equal(result.ok, false); assert.equal(result.errors.length, 2);
});
test('rejects undeclared fields', () => assert.equal(validateContribution({ ...valid, admin: true }).ok, false));
test('extracts a Walrus blob id', () => assert.equal(parseBlobId('Blob ID: abcDEF_12345678901234567890'), 'abcDEF_12345678901234567890'));
test('accepts a public Polymarket address for DNA creation', () => assert.equal(validateDnaRequest({ polymarketAddress: `0x${'a'.repeat(40)}` }).ok, true));
test('rejects private-key-shaped or invalid DNA input', () => assert.equal(validateDnaRequest({ polymarketAddress: 'not-an-address' }).ok, false));
test('accepts a plain-language room message without a type', () => assert.equal(validateRoomMessage({ contributor: 'Ada', message: 'Remember that I called the comeback before halftime.' }).ok, true));
test('fallback classifier separates corrections and fan matches', () => {
  assert.equal(heuristicClassify('Correct the confidence using this receipt'), 'audit_note');
  assert.equal(heuristicClassify('These two fans have similar predictions'), 'fan_twin_update');
});
test('appending a DNA profile never removes existing profiles', () => {
  const before = { version: 2, profiles: [{ id: 'one' }, { id: 'two' }] };
  const after = appendDnaProfileIndex(before, { id: 'three' }, '2026-06-22T00:00:00.000Z');
  assert.deepEqual(after.profiles.map(profile => profile.id), ['one', 'two', 'three']);
  assert.equal(after.version, 3);
  assert.equal(before.profiles.length, 2);
});
