import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipStore, zipRead } from '../src/zip.js';

const enc = new TextEncoder();
const concat = parts => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
});

test('zip round-trip keeps names (Arabic too) and binary content', () => {
  const audio = new Uint8Array(70000).map((_, i) => (i * 37) & 255);
  const files = [
    ['manifest.json', enc.encode(JSON.stringify({ app: 'recorder', name: 'تسجيل' }))],
    ['audio/r1.m4a', audio],
    ['empty.txt', new Uint8Array(0)],
  ];
  const zip = concat(zipStore(files));
  const back = zipRead(zip);
  assert.deepEqual(Object.keys(back).sort(), ['audio/r1.m4a', 'empty.txt', 'manifest.json']);
  assert.deepEqual(back['audio/r1.m4a'], audio);
  assert.equal(new TextDecoder().decode(back['manifest.json']), JSON.stringify({ app: 'recorder', name: 'تسجيل' }));
  assert.equal(back['empty.txt'].length, 0);
});

test('zipRead rejects data that is not a zip', () => {
  assert.throws(() => zipRead(enc.encode('this is not a zip file at all, just text')), /zip/);
});

test('zipRead rejects a zip whose central directory is corrupted', () => {
  const zip = concat(zipStore([['a.txt', enc.encode('hello')]]));
  // central directory header signature is PK\x01\x02
  const idx = [...zip].findIndex((b, i) => b === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x01 && zip[i + 3] === 0x02);
  assert.ok(idx > 0, 'signature found');
  zip[idx + 2] = 0x00;
  assert.throws(() => zipRead(zip));
});

test('zipRead rejects a truncated archive instead of returning partial audio', () => {
  const audio = new Uint8Array(5000).fill(7);
  const zip = concat(zipStore([['audio/a.m4a', audio]]));
  // cut off the tail, which holds the central directory and the end record
  assert.throws(() => zipRead(zip.subarray(0, zip.length - 60)));
  assert.throws(() => zipRead(zip.subarray(0, 40)));
});

test('zipRead keeps unusual names as plain keys (no prototype pollution)', () => {
  const zip = concat(zipStore([['__proto__', enc.encode('x')], ['constructor', enc.encode('y')]]));
  const back = zipRead(zip);
  assert.equal(new TextDecoder().decode(back['__proto__']), 'x');
  assert.equal(new TextDecoder().decode(back['constructor']), 'y');
  assert.equal(Object.getPrototypeOf(back), null);
});
