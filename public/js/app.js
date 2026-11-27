/* WaterWatch shared client script (no CDN, no inline handlers). Progressive enhancement only. */
(function () {
  'use strict';
  var root = document.documentElement;
  try { var t = localStorage.getItem('ww-theme'); if (t) root.setAttribute('data-theme', t); } catch (_e) { /* storage unavailable */ }
  var toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.addEventListener('click', function () {
    var cur = root.getAttribute('data-theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('ww-theme', next); } catch (_e) { /* ignore */ }
  });
  // Dialogs: <button data-dialog="tpl-id"> clones <template id="tpl-id"> into the native <dialog>.
  var dlg = document.getElementById('dlg');
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-dialog],[data-close]') : null;
    if (!el || !dlg) return;
    if (el.hasAttribute('data-close')) { if (dlg.open) dlg.close(); return; }
    var tpl = document.getElementById(el.getAttribute('data-dialog'));
    if (!tpl) return;
    dlg.innerHTML = '';
    dlg.appendChild(tpl.content.cloneNode(true));
    dlg.showModal();
    var first = dlg.querySelector('input:not([type=hidden]),select,textarea,button');
    if (first) first.focus();
  });
  // Auto-submit selects/checkbox filters: <form data-autosubmit>
  document.querySelectorAll('form[data-autosubmit]').forEach(function (f) {
    f.addEventListener('change', function () { f.submit(); });
  });
  // Confirmation prompts: <button data-confirm="message">
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-confirm]') : null;
    if (el && !window.confirm(el.getAttribute('data-confirm'))) e.preventDefault();
  });
  // Focus main after in-page navigation hash changes
  var flash = document.querySelector('.flash');
  if (flash) { var live = document.getElementById('live'); if (live) live.textContent = flash.textContent; }
})();
// Asset form: show only the attribute fields for the selected asset type.
(function () {
  var sel = document.querySelector('select[data-type-switch]');
  if (!sel) return;
  function sync() { document.querySelectorAll('[data-for-type]').forEach(function (el) { el.hidden = el.getAttribute('data-for-type') !== sel.value; }); }
  sel.addEventListener('change', sync); sync();
})();
