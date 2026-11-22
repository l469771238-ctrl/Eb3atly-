// Smoke tests for the real UI: builds src/main.js, runs it in jsdom with an in-memory
// IndexedDB and a stubbed microphone, then checks save / reload / folder rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const fake = require('fake-indexeddb');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-smoke-'));
await build({
  root, configFile: false, logLevel: 'silent',
  build: {
    outDir, emptyOutDir: true, minify: false,
    lib: { entry: path.join(root, 'src/main.js'), formats: ['iife'], name: 'MainApp', fileName: () => 'main.js' },
  },
});
const bundle = fs.readFileSync(path.join(outDir, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/, '');

function canvasStub() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' ? () => grad : k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
}

async function boot({ meta = null, blobs = {} } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, { pretendToBeVisual: true, runScripts: 'dangerously', url: 'http://localhost/' });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', e => errors.push(String(e.error || e.message)));
  w.indexedDB = fake.indexedDB; w.IDBKeyRange = fake.IDBKeyRange;
  w.HTMLCanvasElement.prototype.getContext = canvasStub;
  w.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: 300, height: 60 });
  w.HTMLElement.prototype.scrollTo = () => {};
  w.devicePixelRatio = 1;
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  // fake microphone + MediaRecorder
  w.__gumCalls = 0;
  w.navigator.mediaDevices = { getUserMedia: async () => { w.__gumCalls++; await new Promise(r => setTimeout(r, 40)); return { getTracks: () => [{ stop() {} }] }; } };
  w.AudioContext = class {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 256, frequencyBinCount: 128, getByteTimeDomainData(b) { b.fill(140); }, connect() {} }; }
    close() {}
  };
  w.MediaRecorder = class {
    static isTypeSupported() { return false; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable && this.ondataavailable({ data: new w.Blob([new Uint8Array(4000)], { type: 'audio/webm' }) });
      this.onstop && this.onstop();
    }
  };
  if (meta) w.localStorage.setItem('recorder.meta.v1', JSON.stringify(meta));
  if (Object.keys(blobs).length) {
    await new Promise((res, rej) => {
      const req = fake.indexedDB.open('recorder', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('blobs');
      req.onsuccess = () => {
        const t = req.result.transaction('blobs', 'readwrite');
        for (const [k, v] of Object.entries(blobs)) t.objectStore('blobs').put(new w.Blob([v]), k);
        t.oncomplete = res; t.onerror = rej;
      };
      req.onerror = rej;
    });
  }
  w.eval(bundle);
  await sleep(250);
  const $ = s => w.document.querySelector(s);
  return { w, $, errors, meta: () => JSON.parse(w.localStorage.getItem('recorder.meta.v1')) };
}

test('fresh install starts empty and persists the default folders', async () => {
  const app = await boot();
  assert.deepEqual(app.errors, []);
  assert.ok(app.$('#homeSub').textContent.includes('سجّل وخزّن'));
  assert.equal(app.meta().folders.length, 3);
  app.w.close();
});

test('a saved recording comes back after a reload', async () => {
  const meta = {
    folders: [{ id: 'f1', name: 'عام' }, { id: 'f2', name: 'شغل' }],
    recs: [{ id: 'r1', name: 'اختبار', folderId: 'f1', dur: 3, date: new Date().toISOString(), ext: '.wav', markers: [] }],
  };
  const app = await boot({ meta, blobs: { r1: new Uint8Array([1, 2, 3, 4]) } });
  assert.ok(app.$('#homeSub').textContent.includes('1 تسجيل في 2 فولدرات'));
  app.$('#tFiles').click(); await sleep(30);
  app.w.document.querySelector('#folList .fbtn').click(); await sleep(30);
  assert.ok(app.$('#list').textContent.includes('اختبار'));
  app.w.close();
});

test('a recording without audio in storage is dropped instead of breaking the app', async () => {
  const meta = { folders: [{ id: 'f1', name: 'عام' }], recs: [{ id: 'ghost', name: 'مفقود', folderId: 'f1', dur: 1, date: new Date().toISOString(), markers: [] }] };
  const app = await boot({ meta });
  assert.deepEqual(app.errors, []);
  assert.ok(app.$('#homeSub').textContent.includes('سجّل وخزّن'));
  app.w.close();
});

test('record -> pause -> stop -> save persists the recording', async () => {
  const app = await boot();
  app.$('#tRec').click(); await sleep(30);
  app.$('#micBtn').click(); await sleep(60);
  assert.ok(!app.$('#rpRow').classList.contains('hidden'), 'record controls visible');
  app.$('#pauseBtn').click(); await sleep(20);
  assert.ok(app.$('#rpState').textContent.includes('متوقف'));
  app.$('#pauseBtn').click(); await sleep(20);
  app.$('#stopBtn').click(); await sleep(80);
  app.$('#sn').value = 'تسجيل تجريبي';
  app.$('#sn').dispatchEvent(new app.w.Event('input'));
  app.$('#ss').click(); await sleep(150);
  const recs = app.meta().recs;
  assert.equal(recs.length, 1);
  assert.equal(recs[0].name, 'تسجيل تجريبي');
  assert.deepEqual(app.errors, []);
  app.w.close();
});

test('the last remaining folder cannot be deleted', async () => {
  const app = await boot({ meta: { folders: [{ id: 'only', name: 'وحيد' }], recs: [] } });
  app.$('#tFiles').click(); await sleep(30);
  app.w.document.querySelector('#folList .fbtn').click(); await sleep(30);
  app.$('#fvMore').click(); await sleep(30);
  app.w.document.querySelector('#o2').click(); await sleep(30);
  assert.ok(app.$('#toast').textContent.includes('فولدر واحد على الأقل'));
  assert.equal(app.meta().folders.length, 1);
  app.w.close();
});

test('double tap on the mic starts only one recording', async () => {
  const app = await boot();
  app.$('#tRec').click(); await sleep(30);
  app.$('#micBtn').click();
  app.$('#micBtn').click();
  await sleep(120);
  assert.equal(app.w.__gumCalls, 1);
  app.w.close();
});

test('marker rename and delete are saved, not just shown', async () => {
  const meta = {
    folders: [{ id: 'f1', name: 'عام' }],
    recs: [{ id: 'r1', name: 'محاضرة', folderId: 'f1', dur: 60, date: new Date().toISOString(), ext: '.wav', markers: [{ id: 'm1', t: 5, name: 'قديم' }, { id: 'm2', t: 9, name: 'اتحذف' }] }],
  };
  const app = await boot({ meta, blobs: { r1: new Uint8Array([1, 2]) } });
  app.$('#tFiles').click(); await sleep(30);
  app.w.document.querySelector('#folList .fbtn').click(); await sleep(30);
  app.w.document.querySelector('#list .play').click(); await sleep(60);
  // rename the first marker
  app.w.document.querySelectorAll('#mkList .more')[0].click(); await sleep(20);
  app.w.document.querySelector('#k1').click(); await sleep(20);
  app.$('#mi').value = 'جديد'; app.w.document.querySelector('#mo').click(); await sleep(30);
  // delete the second marker
  app.w.document.querySelectorAll('#mkList .more')[1].click(); await sleep(20);
  app.w.document.querySelector('#k2').click(); await sleep(30);
  const saved = app.meta().recs[0].markers;
  assert.equal(saved.length, 1, JSON.stringify(saved));
  assert.equal(saved[0].name, 'جديد');
  app.w.close();
});

test('search ignores letter case', async () => {
  const meta = {
    folders: [{ id: 'f1', name: 'عام' }],
    recs: [{ id: 'r1', name: 'Meeting Notes', folderId: 'f1', dur: 3, date: new Date().toISOString(), markers: [] }],
  };
  const app = await boot({ meta, blobs: { r1: new Uint8Array([1]) } });
  app.$('#tFiles').click(); await sleep(30);
  app.w.document.querySelector('#folList .fbtn').click(); await sleep(30);
  app.$('#q').value = 'meeting';
  app.$('#q').dispatchEvent(new app.w.Event('input')); await sleep(20);
  assert.ok(app.$('#list').textContent.includes('Meeting Notes'));
  app.w.close();
});

test('the old WAV quality setting falls back to the default', async () => {
  const app = await boot({ meta: { folders: [{ id: 'f1', name: 'عام' }], recs: [], quality: 'wav' } });
  assert.equal(app.meta().quality, 'm4a-high');
  app.$('#gearBtn').click(); await sleep(30);
  assert.equal(app.w.document.querySelectorAll('#qOpts .optrow').length, 2);
  app.w.close();
});

test('audio is read from storage only when a recording is opened', async () => {
  const meta = {
    folders: [{ id: 'f1', name: 'عام' }],
    recs: [{ id: 'r1', name: 'ملف كبير', folderId: 'f1', dur: 30, date: new Date().toISOString(), ext: '.webm', size: 4000, markers: [] }],
  };
  const app = await boot({ meta, blobs: { r1: new Uint8Array(4000) } });
  assert.equal(app.meta().recs[0].size, 4000);
  app.$('#tFiles').click(); await sleep(30);
  app.w.document.querySelector('#folList .fbtn').click(); await sleep(30);
  app.w.document.querySelector('#list .play').click(); await sleep(80);
  assert.equal(app.$('#pTitle').textContent, 'ملف كبير');
  assert.deepEqual(app.errors, []);
  app.w.close();
});
