/* WaterWatch community report: offline queue (IndexedDB), idempotent sync, GPS, photo downscale. No CDN, no inline handlers. */
(function () {
  'use strict';
  var app = document.getElementById('report-app');
  if (!app) return;
  var $ = function (id) { return document.getElementById(id); };
  var form = $('report-form'), tpl = $('i18n').dataset;
  var started = 0, photoBlob = null, busy = false;

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () { /* offline shell unavailable */ });

  function newUid() {
    var u = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '') : (Date.now().toString(36) + Math.random().toString(36).slice(2, 14));
    return u.slice(0, 40);
  }
  function resetForm() {
    form.reset(); photoBlob = null; started = 0;
    $('client_uid').value = newUid(); $('photo-prev').hidden = true; $('gps-status').textContent = '';
    ['lat', 'lng', 'accuracy_m'].forEach(function (k) { $(k).value = ''; });
    $('safety-panel').hidden = true; document.querySelectorAll('.cat').forEach(function (l) { l.classList.remove('sel'); });
  }
  function touch() { if (!started) started = Date.now(); }
  $('client_uid').value = newUid();

  // ---- network indicator
  function net() { var on = navigator.onLine; var b = $('net-bar'); b.textContent = on ? tpl.online : tpl.offline; b.className = 'offbar ' + (on ? 'on' : 'off'); $('flush-btn').disabled = !on; }
  window.addEventListener('online', function () { net(); flush(); });
  window.addEventListener('offline', net);

  // ---- category + safety panel
  form.addEventListener('change', function (e) {
    touch();
    if (e.target.name === 'category') {
      document.querySelectorAll('.cat').forEach(function (l) { l.classList.toggle('sel', l.contains(e.target) && e.target.checked); });
      $('safety-panel').hidden = e.target.value !== 'contamination';
      $('err-cat').hidden = true;
    }
  });
  form.addEventListener('input', touch);

  // ---- GPS
  $('gps-btn').addEventListener('click', function () {
    touch();
    if (!navigator.geolocation) { $('gps-status').textContent = tpl.locFail; return; }
    navigator.geolocation.getCurrentPosition(function (p) {
      $('lat').value = p.coords.latitude.toFixed(6); $('lng').value = p.coords.longitude.toFixed(6); $('accuracy_m').value = Math.round(p.coords.accuracy);
      $('gps-status').textContent = tpl.locOk + ' (±' + Math.round(p.coords.accuracy) + ' m)'; $('err-loc').hidden = true;
    }, function () { $('gps-status').textContent = tpl.locFail; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });

  // ---- photo: downscale on device (also strips metadata); server re-validates and re-encodes
  $('photo').addEventListener('change', function () {
    touch();
    var f = $('photo').files[0]; if (!f) { photoBlob = null; $('photo-prev').hidden = true; return; }
    var done = function (blob) { photoBlob = blob; var img = $('photo-prev'); img.src = URL.createObjectURL(blob); img.hidden = false; };
    if (window.createImageBitmap) {
      createImageBitmap(f).then(function (bmp) {
        var max = 1280, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
        var c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        c.toBlob(function (b) { done(b || f); }, 'image/jpeg', 0.8);
      }).catch(function () { done(f); });
    } else done(f);
  });

  // ---- IndexedDB queue
  function db() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('ww-reports', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('queue', { keyPath: 'uid' }); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode, fn) {
    return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('queue', mode), st = t.objectStore('queue'), out = fn(st); t.oncomplete = function () { res(out && out.result); }; t.onerror = function () { rej(t.error); }; }); });
  }
  var put = function (item) { return tx('readwrite', function (s) { return s.put(item); }); };
  var del = function (uid) { return tx('readwrite', function (s) { return s.delete(uid); }); };
  var all = function () { return tx('readonly', function (s) { return s.getAll(); }); };

  function renderQueue() {
    all().then(function (items) {
      items = items || [];
      $('queue').hidden = items.length === 0; $('queue-count').textContent = String(items.length);
      var ul = $('queue-list'); ul.textContent = '';
      items.forEach(function (it) {
        var li = document.createElement('li'); li.className = 'row';
        var span = document.createElement('span'); span.className = 'grow';
        span.textContent = it.fields.category.replace('_', ' ') + ' · ' + new Date(it.observedAt).toLocaleTimeString() + (it.error ? ' · ' + tpl.failed + ': ' + it.error : '');
        li.appendChild(span);
        if (it.error) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = tpl.remove; b.addEventListener('click', function () { del(it.uid).then(renderQueue); }); li.appendChild(b); }
        ul.appendChild(li);
      });
    }).catch(function () { /* IndexedDB unavailable */ });
  }

  function csrfToken() { return fetch('/api/v1/csrf', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { if (!r.ok) { var e = new Error('auth'); e.status = r.status; throw e; } return r.json(); }).then(function (j) { return j.csrf; }); }
  function send(item) {
    return csrfToken().then(function (token) {
      var fd = new FormData();
      Object.keys(item.fields).forEach(function (k) { if (item.fields[k] !== '' && item.fields[k] != null) fd.append(k, item.fields[k]); });
      fd.append('client_uid', item.uid); fd.append('observed_at', String(item.observedAt));
      if (item.photo) fd.append('photo', item.photo, 'photo.jpg');
      return fetch('/api/v1/reports', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-CSRF-Token': token } });
    });
  }
  // Sequential flush. 2xx removes (server is idempotent on client uid); 4xx validation keeps with error; network/5xx retries later.
  var flushing = false;
  function flush() {
    if (flushing || !navigator.onLine) return Promise.resolve();
    flushing = true;
    return all().then(function (items) {
      return (items || []).filter(function (i) { return !i.error; }).reduce(function (p, it) {
        return p.then(function () {
          return send(it).then(function (r) {
            if (r.ok) return del(it.uid);
            if (r.status === 400 || r.status === 422) return r.json().then(function (j) { it.error = (j && j.message) || String(r.status); return put(it); });
            if (r.status === 401 || r.status === 403) { $('net-bar').textContent = tpl.signin; throw new Error('stop'); }
            throw new Error('retry');
          });
        });
      }, Promise.resolve());
    }).catch(function () { /* will retry on next online event */ }).then(function () { flushing = false; renderQueue(); });
  }
  $('flush-btn').addEventListener('click', flush);

  function showDone(title, ref, secs, contamination) {
    form.hidden = true; $('done').hidden = false;
    $('done-title').textContent = title; $('done-ref').textContent = ref ? 'Ref ' + ref : '';
    $('done-time').textContent = secs ? secs + ' ' + tpl.secs : '';
    var box = $('done-safety'); box.textContent = '';
    if (contamination) box.appendChild($('safety-tpl').content.cloneNode(true));
    $('done').scrollIntoView();
  }
  $('again-btn').addEventListener('click', function () { $('done').hidden = true; form.hidden = false; resetForm(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var cat = form.querySelector('input[name=category]:checked');
    $('err-cat').hidden = !!cat; var hasLoc = !!($('asset_id').value || $('lat').value); $('err-loc').hidden = hasLoc;
    if (!cat || !hasLoc) { (cat ? $('err-loc') : $('err-cat')).scrollIntoView(); return; }
    busy = true; $('send-btn').disabled = true;
    var secs = started ? Math.round((Date.now() - started) / 1000) : 0;
    $('submit_ms').value = secs ? String(secs * 1000) : '';
    var fields = {}; ['category', 'text', 'lang', 'asset_id', 'lat', 'lng', 'accuracy_m', 'submit_ms'].forEach(function (k) { var el = form.elements[k]; fields[k] = el && el.value ? el.value : ''; });
    var item = { uid: $('client_uid').value, fields: fields, photo: photoBlob, observedAt: Date.now() };
    var contamination = cat.value === 'contamination';
    var queueIt = function () { return put(item).then(function () { showDone(tpl.saved, '', secs, contamination); renderQueue(); }); };
    var finish = function () { busy = false; $('send-btn').disabled = false; };
    if (!navigator.onLine) { queueIt().then(finish, finish); return; }
    send(item).then(function (r) {
      if (r.ok) return r.json().then(function (j) { showDone(tpl.thanks, j.ref, secs, contamination); });
      if (r.status === 400 || r.status === 422 || r.status === 429) return r.json().then(function (j) { $('err-loc').textContent = j.message; $('err-loc').hidden = false; });
      return queueIt();
    }).catch(function () { return queueIt(); }).then(finish, finish);
  });

  net(); renderQueue(); flush();
})();
