/* Optional tile map (Leaflet vendored under /vendor/leaflet). Only loaded when a tile provider is configured. */
(function () {
  'use strict';
  var el = document.getElementById('leaflet');
  if (!el || typeof L === 'undefined') return;
  var assets = JSON.parse(el.getAttribute('data-assets') || '[]');
  var map = L.map(el, { zoomControl: true }).setView([-1.29, 36.85], 11);
  var errors = 0;
  var layer = L.tileLayer(el.getAttribute('data-tile'), { attribution: el.getAttribute('data-attribution') || '', maxZoom: 19 });
  layer.on('tileerror', function () {
    errors++;
    if (errors === 5) { var n = document.createElement('p'); n.className = 'hint'; n.textContent = 'Map tiles are unavailable. Use the schematic view.'; el.parentNode.appendChild(n); }
  });
  layer.addTo(map);
  var css = window.getComputedStyle(document.documentElement);
  var tone = { 'Operational': '--ok', 'Degraded': '--warn', 'Out of service': '--bad', 'Contamination alert': '--contam', 'Status unknown': '--unk' };
  var pts = [];
  assets.forEach(function (a) {
    var m = L.circleMarker([a.lat, a.lng], { radius: 10, weight: 3, fillOpacity: 0.85, color: css.getPropertyValue('--surface').trim() || '#fff', fillColor: css.getPropertyValue(tone[a.status] || '--unk').trim() || '#44565C' }).addTo(map);
    m.bindTooltip(a.name + ' (' + a.status + ')');
    m.bindPopup('<b></b><br><span></span><br><a></a>');
    var c = m.getPopup().getContent(); void c;
    m.on('popupopen', function (e) { var n = e.popup.getElement(); n.querySelector('b').textContent = a.name; n.querySelector('span').textContent = a.status; var l = n.querySelector('a'); l.textContent = 'Open'; l.href = '/console/map?asset=' + encodeURIComponent(a.id); });
    pts.push([a.lat, a.lng]);
  });
  if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
})();
