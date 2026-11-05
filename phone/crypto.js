// ======================================================================
// crypto.js: كل التشفير والتوقيع. بيشتغل في المتصفح وفي اختبار Node.
//   - فك ملف KeyGen: نفس خزنة Vault.cs بالظبط
//     (PBKDF2-SHA256 + مفتاحين فرعيين + HMAC-SHA256 + AES-256-CBC).
//   - التوقيع: مطابق لـ LicenseBuilder.Build
//     البيانات Program|Machine|Expiry و RSA PKCS#1 SHA-256 و base64.
// المفتاح الخاص بيتحمّل غير قابل للاستخراج (extractable = false).
// ======================================================================
(function (root) {
  'use strict';
  var subtle = (root.crypto || globalThis.crypto).subtle;
  var enc = new TextEncoder(), dec = new TextDecoder();
  var RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

  function fromB64(text) {
    var bin = atob(text.trim()), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function toB64(bytes) {
    var bin = '', u = new Uint8Array(bytes);
    for (var i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return btoa(bin);
  }

  // JWK لازم من غير أصفار في الأول، و .NET ممكن يحطها
  function b64ToJwk(text) {
    var u = fromB64(text), start = 0;
    while (start < u.length - 1 && u[start] === 0) start++;
    return toB64(u.subarray(start)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function join() {
    var parts = Array.prototype.slice.call(arguments), size = 0, at = 0;
    parts.forEach(function (p) { size += p.length; });
    var out = new Uint8Array(size);
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  async function hmac(keyBytes, data) {
    var key = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await subtle.sign('HMAC', key, data));
  }

  function same(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  async function derive(password, salt, iterations) {
    var key = await subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iterations }, key, 256));
  }

  /** بيفك ملف KeyGen. null لو الكود غلط أو الملف اتعدّل. */
  async function openFile(text, code) {
    var v = {}, lines = String(text).replace(/\r/g, '').split('\n');
    if (lines[0].replace(/^﻿/, '') !== 'SAMVAULT1') throw new Error('bad-file');
    lines.forEach(function (line) {
      var eq = line.indexOf('=');
      if (eq > 0) v[line.substring(0, eq)] = line.substring(eq + 1);
    });
    if (!v.iterations || !v.salt || !v.iv || !v.data || !v.mac) throw new Error('bad-file');

    var iterations = parseInt(v.iterations, 10);
    var salt = fromB64(v.salt), iv = fromB64(v.iv), data = fromB64(v.data);
    var master = await derive(code, salt, iterations);
    var encKey = await hmac(master, enc.encode('SamKeyGen encrypt'));
    var macKey = await hmac(master, enc.encode('SamKeyGen sign'));

    var header = 'SAMVAULT1|' + iterations + '|' + toB64(salt) + '|' + toB64(iv) + '|';
    if (!same(await hmac(macKey, join(enc.encode(header), data)), fromB64(v.mac))) return null;

    var aes = await subtle.importKey('raw', encKey, 'AES-CBC', false, ['decrypt']);
    var plain = dec.decode(await subtle.decrypt({ name: 'AES-CBC', iv: iv }, aes, data));

    var items = {};
    plain.split('\n').forEach(function (line) {
      var colon = line.indexOf(':');
      if (colon <= 0) return;
      items[dec.decode(fromB64(line.substring(0, colon)))] = dec.decode(fromB64(line.substring(colon + 1)));
    });
    return items;
  }

  function xmlValue(xml, tag) {
    var m = new RegExp('<' + tag + '>([^<]+)</' + tag + '>').exec(xml);
    if (!m) throw new Error('bad-key');
    return b64ToJwk(m[1]);
  }

  /** من XML بتاع .NET لمفتاحين: الخاص غير قابل للاستخراج، والعام للمراجعة. */
  async function importKeys(xml) {
    var jwk = {
      kty: 'RSA', alg: 'RS256', ext: false,
      n: xmlValue(xml, 'Modulus'), e: xmlValue(xml, 'Exponent'), d: xmlValue(xml, 'D'),
      p: xmlValue(xml, 'P'), q: xmlValue(xml, 'Q'),
      dp: xmlValue(xml, 'DP'), dq: xmlValue(xml, 'DQ'), qi: xmlValue(xml, 'InverseQ')
    };
    var priv = await subtle.importKey('jwk', jwk, RSA, false, ['sign']);
    var pub = await subtle.importKey('jwk', { kty: 'RSA', alg: 'RS256', ext: false, n: jwk.n, e: jwk.e }, RSA, false, ['verify']);
    return { priv: priv, pub: pub };
  }

  /** نص ملف .lic موقّع، بعد مراجعته بالمفتاح العام زي KeyGen. */
  async function buildLicense(program, machine, expiry, plan, keys) {
    var data = enc.encode(program + '|' + machine + '|' + expiry);
    var sig = await subtle.sign(RSA, keys.priv, data);
    if (!(await subtle.verify(RSA, keys.pub, sig, data))) throw new Error('self-check');
    plan = String(plan || '').replace(/[\r\n]/g, ' ').trim();
    return 'Program=' + program + '\nMachine=' + machine + '\nExpiry=' + expiry +
           '\nPlan=' + plan + '\nSignature=' + toB64(sig) + '\n';
  }

  // ---------- قفل الإعدادات بالـ PIN ----------

  async function pinKey(pin, salt) {
    var bits = await derive(pin, salt, 300000);
    return subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  async function sealConfig(config, pin) {
    var salt = (root.crypto || globalThis.crypto).getRandomValues(new Uint8Array(16));
    var iv = (root.crypto || globalThis.crypto).getRandomValues(new Uint8Array(12));
    var data = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, await pinKey(pin, salt), enc.encode(JSON.stringify(config)));
    return { salt: salt, iv: iv, data: new Uint8Array(data) };
  }

  /** null = PIN غلط. */
  async function openConfig(box, pin) {
    try {
      var plain = await subtle.decrypt({ name: 'AES-GCM', iv: box.iv }, await pinKey(pin, box.salt), box.data);
      return JSON.parse(dec.decode(plain));
    } catch (x) { return null; }
  }

  var api = { openFile: openFile, importKeys: importKeys, buildLicense: buildLicense,
              sealConfig: sealConfig, openConfig: openConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SamCrypto = api;
})(typeof window !== 'undefined' ? window : globalThis);
