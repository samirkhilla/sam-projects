// ======================================================================
// app.js: واجهة صفحة التفعيل.
//   المفاتيح في IndexedDB بشكل غير قابل للاستخراج، والرابط و PHONE_SECRET
//   مشفّرين بالـ PIN. أي نص جاي من الطلبات بيتعرض بـ textContent بس.
// ======================================================================
(function () {
  'use strict';
  var C = window.SamCrypto;
  var app = document.getElementById('app');
  var MAX_TRIES = 5, IDLE_MS = 5 * 60 * 1000;
  var config = null, keys = {}, idleTimer = null, hiddenAt = 0;

  // ---------- IndexedDB ----------
  function db() {
    return new Promise(function (ok, fail) {
      var r = indexedDB.open('sam-activate', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { fail(r.error); };
    });
  }
  async function store(mode, work) {
    var d = await db();
    return new Promise(function (ok, fail) {
      var tx = d.transaction('kv', mode), s = tx.objectStore('kv'), req = work(s);
      tx.oncomplete = function () { d.close(); ok(req && req.result); };
      tx.onerror = function () { d.close(); fail(tx.error); };
    });
  }
  function dbGet(k) { return store('readonly', function (s) { return s.get(k); }); }
  function dbPut(k, v) { return store('readwrite', function (s) { return s.put(v, k); }); }
  function dbClear() { return store('readwrite', function (s) { return s.clear(); }); }

  // ---------- أدوات الواجهة ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function msg(text, kind) {
    var old = document.getElementById('msg');
    if (old) old.remove();
    if (!text) return;
    var m = el('div', 'msg ' + (kind || ''), text);
    m.id = 'msg';
    app.prepend(m);
    window.scrollTo(0, 0);
  }
  function line(parent, name, value, ltr) {
    var r = el('div', 'line');
    r.appendChild(el('span', '', name));
    r.appendChild(el('b', ltr ? 'ltr' : '', value));
    parent.appendChild(r);
  }
  function input(type, id, cls, attrs) {
    var i = el('input', cls);
    i.type = type; i.id = id;
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }
  function ask(title, fill, yesText) {
    var d = document.getElementById('dialog'), body = document.getElementById('dlgBody');
    var yes = document.getElementById('dlgYes'), no = document.getElementById('dlgNo');
    document.getElementById('dlgTitle').textContent = title;
    body.textContent = '';
    fill(body);
    yes.textContent = yesText;
    d.hidden = false;
    return new Promise(function (ok) {
      function done(v) { d.hidden = true; yes.onclick = no.onclick = null; ok(v); }
      yes.onclick = function () { done(true); };
      no.onclick = function () { done(false); };
    });
  }

  // ---------- الاتصال ----------
  async function api(action, data) {
    var body = Object.assign({ phoneAction: action, secret: config.phone }, data || {});
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 60000);
    var res;
    try {
      res = await fetch(config.url, {
        method: 'POST', redirect: 'follow', signal: ctl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
    } catch (x) { throw new Error('تعذّر الاتصال بالسكريبت. تأكد من الإنترنت.'); }
    finally { clearTimeout(t); }

    var json;
    try { json = JSON.parse(await res.text()); }
    catch (x) { throw new Error('رد السكريبت غير صحيح. تأكد من نشر الإصدار الجديد.'); }
    if (!json.ok) {
      if (json.error === 'unauthorized') throw new Error('PHONE_SECRET غير مطابق لخصائص السكريبت.');
      if (json.error === 'not_new') throw new Error('هذا الطلب لم يعد جديدًا.');
      if (json.error === 'busy') throw new Error('السكريبت مشغول، أعد المحاولة.');
      throw new Error('خطأ من السكريبت: ' + (json.error || 'غير معروف'));
    }
    return json;
  }

  async function loadPlans(program) {
    var url = 'https://raw.githubusercontent.com/' + config.repo + '/refs/heads/' + config.branch +
              '/' + encodeURIComponent(program) + '.ini?t=' + Date.now();
    var res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('تعذّر تحميل خطط البرنامج.');
    var text = await res.text(), inside = false, plans = [];
    text.replace(/\r/g, '').split('\n').forEach(function (raw) {
      var l = raw.trim().replace(/^﻿/, '');
      if (!l || l[0] === '#' || l[0] === ';') return;
      if (l[0] === '[' && l[l.length - 1] === ']') { inside = l.toLowerCase() === '[license]'; return; }
      var eq = l.indexOf('=');
      if (!inside || eq <= 0 || l.substring(0, eq).trim().toLowerCase() !== 'plan') return;
      var p = l.substring(eq + 1).split('|');
      if (p.length >= 4) plans.push({ ar: p[0].trim(), en: p[1].trim(), days: parseInt(p[2], 10) || 0, price: String(parseInt(p[3], 10) || 0) });
    });
    return plans;
  }

  // ---------- التواريخ (مطابقة لـ KeyGen) ----------
  function ymd(y, m, d) {
    var t = new Date(Date.UTC(y, m, d));
    return t.toISOString().substring(0, 10);
  }
  function today() { var n = new Date(); return ymd(n.getFullYear(), n.getMonth(), n.getDate()); }
  function addDays(text, days) {
    var p = text.split('-').map(Number);
    return ymd(p[0], p[1] - 1, p[2] + days);
  }
  // التاريخ بعزل اتجاه عشان ما يتقلبش وسط النص العربي
  function iso(text) { return '\u2066' + text + '\u2069'; }
  function pretty(expiry) { return expiry === 'never' ? 'مدى الحياة' : iso(expiry); }

  // ---------- الاستيراد ----------
  function showImport() {
    document.getElementById('btnLock').hidden = true;
    app.textContent = '';
    var c = el('div', 'card');
    c.appendChild(el('h2', '', 'استيراد المفاتيح'));
    c.appendChild(el('p', '', 'تُنشئ الملف والكود من KeyGen: الإعدادات ← التصدير إلى الموبايل.'));
    c.appendChild(el('label', '', 'ملف المفاتيح'));
    var file = input('file', 'file');
    c.appendChild(file);
    c.appendChild(el('label', '', 'كود النقل'));
    var code = input('text', 'code', 'center ltr', { autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
    c.appendChild(code);
    c.appendChild(el('label', '', 'رقم سري جديد (6 أرقام أو أكثر)'));
    var pin = input('password', 'pin', 'pin ltr', { inputmode: 'numeric', autocomplete: 'new-password' });
    c.appendChild(pin);
    c.appendChild(el('label', '', 'تأكيد الرقم السري'));
    var pin2 = input('password', 'pin2', 'pin ltr', { inputmode: 'numeric', autocomplete: 'new-password' });
    c.appendChild(pin2);
    var go = el('button', 'gold wide', 'استيراد');
    c.appendChild(go);
    app.appendChild(c);

    go.onclick = async function () {
      msg('');
      if (!file.files[0]) return msg('اختر ملف المفاتيح.', 'bad');
      var cleaned = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cleaned.length !== 20) return msg('اكتب كود النقل كاملًا.', 'bad');
      if (!/^\d{6,}$/.test(pin.value)) return msg('الرقم السري 6 أرقام على الأقل.', 'bad');
      if (pin.value !== pin2.value) return msg('الرقم السري غير متطابق.', 'bad');

      go.disabled = true;
      go.textContent = 'جارٍ الاستيراد...';
      try {
        var items = await C.openFile(await file.files[0].text(), cleaned);
        if (!items) throw new Error('كود النقل غير صحيح أو الملف تالف.');

        var loaded = {};
        for (var name of Object.keys(items)) {
          if (name.indexOf('key:') !== 0) continue;
          var program = name.substring(4);
          var pair = await C.importKeys(items[name]);
          await C.buildLicense(program, 'SAM-0000-0000-0000', 'never', 'test', pair);   // اختبار كل مفتاح
          loaded[program] = pair;
        }
        if (!Object.keys(loaded).length) throw new Error('الملف لا يحتوي على مفاتيح.');
        if (!items.phone || !items.url) throw new Error('الملف ناقص.');

        var cfg = { phone: items.phone, url: items.url, repo: items.repo, branch: items.branch || 'main' };
        await dbPut('keys', loaded);
        await dbPut('config', await C.sealConfig(cfg, pin.value));
        await dbPut('tries', 0);
        if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
        config = cfg; keys = loaded;
        await showOrders('تم الاستيراد ✓ عدد المفاتيح: ' + Object.keys(loaded).length + '. احذف الملف من الموبايل.', 'good');
      } catch (x) {
        go.disabled = false;
        go.textContent = 'استيراد';
        msg(x.message === 'bad-file' ? 'هذا ليس ملف مفاتيح صحيحًا.' : x.message === 'bad-key' ? 'مفتاح تالف في الملف.' : x.message, 'bad');
      }
    };
  }

  // ---------- القفل ----------
  function lock() {
    config = null; keys = {};
    clearTimeout(idleTimer);
    document.getElementById('dialog').hidden = true;
    showPin();
  }
  function touch() {
    clearTimeout(idleTimer);
    if (config) idleTimer = setTimeout(lock, IDLE_MS);
  }

  function showPin() {
    document.getElementById('btnLock').hidden = true;
    app.textContent = '';
    var c = el('div', 'card');
    c.appendChild(el('h2', '', 'أدخل الرقم السري'));
    var pin = input('password', 'unlock', 'pin ltr', { inputmode: 'numeric', autocomplete: 'off' });
    c.appendChild(pin);
    var go = el('button', 'gold wide', 'فتح');
    c.appendChild(go);
    app.appendChild(c);
    pin.focus();

    async function open() {
      go.disabled = true;
      var cfg = await C.openConfig(await dbGet('config'), pin.value);
      if (!cfg) {
        var tries = ((await dbGet('tries')) || 0) + 1;
        if (tries >= MAX_TRIES) {
          await dbClear();
          showImport();
          msg('تم مسح المفاتيح بعد ' + MAX_TRIES + ' محاولات خاطئة. أعد الاستيراد من KeyGen.', 'bad');
          return;
        }
        await dbPut('tries', tries);
        go.disabled = false;
        pin.value = '';
        msg('رقم غير صحيح. المتبقي ' + (MAX_TRIES - tries) + ' محاولات.', 'bad');
        return;
      }
      await dbPut('tries', 0);
      config = cfg;
      keys = await dbGet('keys');
      await showOrders();
    }
    go.onclick = open;
    pin.onkeydown = function (e) { if (e.key === 'Enter') open(); };
  }

  // ---------- الطلبات ----------
  async function showOrders(notice, kind) {
    document.getElementById('btnLock').hidden = false;
    touch();
    app.textContent = '';
    var refresh = el('button', 'wide', 'تحديث الطلبات');
    refresh.onclick = function () { showOrders(); };
    var list = el('div', '');
    app.appendChild(list);
    app.appendChild(refresh);
    list.appendChild(el('div', 'empty', 'جارٍ تحميل الطلبات...'));
    if (notice) msg(notice, kind);

    var requests;
    try { requests = (await api('list')).requests || []; }
    catch (x) {
      list.textContent = '';
      msg(x.message, 'bad');
      return;
    }
    if (!config) return;
    list.textContent = '';
    if (!requests.length) list.appendChild(el('div', 'card empty', 'لا توجد طلبات جديدة'));
    requests.forEach(function (r) { list.appendChild(orderCard(r)); });
  }

  function orderCard(r) {
    var c = el('div', 'card');
    c.appendChild(el('h2', '', r.program));
    line(c, 'الخطة', r.plan || '—');
    line(c, 'المبلغ', r.price ? r.price + ' جنيه' : '—');
    line(c, 'الاسم', r.name || '—');
    line(c, 'الموبايل', r.phone || '—', true);
    line(c, 'التاريخ', r.date || '—', true);
    var row = el('div', 'row');
    var yes = el('button', 'gold', 'تفعيل');
    var no = el('button', 'salmon', 'رفض');
    row.appendChild(yes); row.appendChild(no);
    c.appendChild(row);
    yes.onclick = function () { activate(r, yes, no); };
    no.onclick = function () { reject(r, yes, no); };
    return c;
  }

  function busy(a, b, on) { a.disabled = b.disabled = on; }

  async function activate(r, yes, no) {
    touch();
    msg('');
    var program = r.program, machine = String(r.machine || '').toUpperCase();
    var pair = keys[program];
    if (!pair) return msg('لا يوجد مفتاح لبرنامج ' + program + ' على هذا الموبايل. أعد التصدير من KeyGen.', 'bad');
    if (!/^SAM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(machine)) return msg('كود الجهاز في الطلب غير صحيح.', 'bad');

    busy(yes, no, true);
    try {
      var plans = await loadPlans(program);
      var wanted = parseInt(r.days, 10);
      if (isNaN(wanted)) wanted = -1;
      var plan = plans.filter(function (p) { return p.days === wanted; })[0] ||
                 plans.filter(function (p) { return p.ar === r.plan || p.en === r.plan; })[0];
      var days = wanted >= 0 ? wanted : plan ? plan.days : -1;
      if (days < 0) throw new Error('تعذّر تحديد مدة الخطة. فعّل هذا الطلب من KeyGen.');

      var old = await api('license', { program: program, machine: machine });
      var lifetime = days === 0, oldLifetime = old.exists && old.expiry.toLowerCase() === 'never';
      var now = today(), expiry = lifetime ? 'never' : addDays(now, days);
      if (old.exists && !lifetime && !oldLifetime && /^\d{4}-\d{2}-\d{2}$/.test(old.expiry) && old.expiry > now)
        expiry = addDays(old.expiry, days);

      var warnings = [];
      if (plan && r.price && String(r.price) !== plan.price)
        warnings.push('تنبيه: المبلغ في الطلب ' + r.price + ' جنيه، وسعر الخطة الحالي ' + plan.price + ' جنيه.');
      if (oldLifetime) warnings.push('هذا الجهاز مفعّل مدى الحياة بالفعل، وسيُستبدل ترخيصه.');
      else if (old.exists) warnings.push('يوجد ترخيص حتى ' + iso(old.expiry) + '.');

      var sure = await ask('تأكيد التفعيل', function (b) {
        line(b, 'البرنامج', program);
        line(b, 'الاسم', r.name || '—');
        line(b, 'الموبايل', r.phone || '—', true);
        line(b, 'المبلغ', r.price ? r.price + ' جنيه' : '—');
        line(b, 'حتى', pretty(expiry));
        b.appendChild(el('p', '', 'تأكد من وصول المبلغ قبل التفعيل.'));
        warnings.forEach(function (w) { b.appendChild(el('div', 'warn', w)); });
      }, 'تفعيل الآن');
      if (!sure) { busy(yes, no, false); return; }

      yes.textContent = 'جارٍ التفعيل...';
      var text = await C.buildLicense(program, machine, expiry, plan ? plan.ar : r.plan, pair);
      var res = await api('publish', { program: program, machine: machine, row: r.row, expiry: expiry, text: text });
      if (res.sheet) await showOrders('تم التفعيل ✓ ' + program + ' حتى ' + pretty(expiry) + '، وتم تسجيل done.', 'good');
      else await showOrders('رُفع الترخيص ✓ حتى ' + pretty(expiry) + '، لكن الشيت لم يتحدّث: ' + (res.sheetError || ''), 'bad');
    } catch (x) {
      busy(yes, no, false);
      yes.textContent = 'تفعيل';
      msg(x.message === 'self-check' ? 'فشلت مراجعة التوقيع، ولم يُرفع شيء.' : x.message, 'bad');
    }
  }

  async function reject(r, yes, no) {
    touch();
    msg('');
    var sure = await ask('رفض الطلب', function (b) {
      line(b, 'البرنامج', r.program);
      line(b, 'الاسم', r.name || '—');
      line(b, 'الموبايل', r.phone || '—', true);
    }, 'رفض الطلب');
    if (!sure) return;
    busy(yes, no, true);
    try {
      await api('reject', { program: r.program, machine: String(r.machine || '').toUpperCase(), row: r.row });
      await showOrders('تم رفض الطلب.', 'good');
    } catch (x) {
      busy(yes, no, false);
      msg(x.message, 'bad');
    }
  }

  // ---------- البداية ----------
  document.getElementById('btnLock').onclick = lock;
  ['pointerdown', 'keydown'].forEach(function (n) { document.addEventListener(n, touch); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) hiddenAt = Date.now();
    else if (config && hiddenAt && Date.now() - hiddenAt > 60000) lock();
  });

  (async function () {
    try {
      if (await dbGet('config')) showPin(); else showImport();
    } catch (x) { msg('المتصفح لا يسمح بالتخزين هنا.', 'bad'); }
  })();
})();
