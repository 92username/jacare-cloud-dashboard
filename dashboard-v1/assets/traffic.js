/* Jacaré Cloud — tráfego ADS-B de SBJR. */
(function () {
  'use strict';

  var API = '/api/traffic';
  var REFRESH_MS = 20000;
  var map = null;
  var markers = {};
  var aircraftByHex = {};
  var eventCache = [];
  var dialog = document.getElementById('aircraft-dialog');
  var dialogContent = document.getElementById('aircraft-dialog-content');
  var statusChip = document.getElementById('traffic-status');
  var locale = function () { return window.JacareCloudI18n && window.JacareCloudI18n.language === 'en' ? 'en-GB' : 'pt-BR'; };
  var BOUNDS = [[-43.475, -23.065], [-43.260, -22.939]];

  function text(pt, en) { return locale() === 'en-GB' ? en : pt; }
  function safe(value, fallback) { return value === null || value === undefined || value === '' ? (fallback || '—') : value; }
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char];
    });
  }
  function formatNumber(value) { return typeof value === 'number' ? new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(value) : '—'; }
  function formatTime(iso) {
    var date = new Date(iso);
    return isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale(), { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  function trend(plane) {
    if (plane.vertical_rate_fpm > 150) { return 'climbing'; }
    if (plane.vertical_rate_fpm < -150) { return 'descending'; }
    return 'level';
  }
  function label(plane) { return safe(plane.registration, safe(plane.flight, plane.hex.toUpperCase())); }

  function initializeMap() {
    if (!window.maplibregl || !document.getElementById('traffic-map')) {
      setStatus(text('mapa indisponível', 'map unavailable'), 'fail');
      return;
    }
    map = new maplibregl.Map({
      container: 'traffic-map',
      style: 'https://tiles.openfreemap.org/styles/fiord',
      bounds: BOUNDS,
      fitBoundsOptions: { padding: 8 },
      maxBounds: BOUNDS,
      interactive: false,
      attributionControl: true,
      renderWorldCopies: false
    });
    map.on('load', function () {
      map.addSource('sbjr-runway', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-43.3812, -22.9891], [-43.3592, -22.9851]] } }] }
      });
      map.addLayer({ id: 'sbjr-runway-line', type: 'line', source: 'sbjr-runway', paint: { 'line-color': '#2ad4e6', 'line-width': 3, 'line-opacity': 0.9, 'line-dasharray': [3, 2] } });
    });
  }

  function setStatus(message, state) {
    if (!statusChip) { return; }
    statusChip.textContent = message;
    statusChip.className = 'chip ' + (state === 'ok' ? 'chip-ok' : state === 'fail' ? 'chip-fail' : 'chip-wait');
  }

  function markerElement(plane) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'aircraft-marker ' + trend(plane);
    el.setAttribute('aria-label', text('Detalhes de ', 'Details for ') + label(plane));
    el.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><g transform="rotate(' + safe(plane.track_deg, 0) + ' 16 16)"><path d="M16 2.5 19 13l9.5 4v2.7L19 18l-1 7 3 2v2l-5-1.2L11 29v-2l3-2-1-7-9.5 1.7V17l9.5-4z" fill="currentColor" stroke="#061019" stroke-width=".8"/></g></svg><span class="aircraft-marker-label">' + escapeHtml(label(plane)) + '<br>' + formatNumber(plane.altitude_ft) + ' ft</span>';
    el.addEventListener('click', function () { openAircraft(plane); });
    return el;
  }

  function renderAircraft(aircraft) {
    aircraftByHex = {};
    var present = {};
    aircraft.forEach(function (plane) {
      aircraftByHex[plane.hex] = plane;
      present[plane.hex] = true;
      if (!map) { return; }
      if (markers[plane.hex]) { markers[plane.hex].remove(); }
      markers[plane.hex] = new maplibregl.Marker({ element: markerElement(plane), anchor: 'center' }).setLngLat([plane.lon, plane.lat]).addTo(map);
    });
    Object.keys(markers).forEach(function (hex) {
      if (!present[hex]) { markers[hex].remove(); delete markers[hex]; }
    });
    document.getElementById('traffic-count').textContent = aircraft.length;
  }

  function renderLive(payload) {
    renderAircraft(payload.aircraft || []);
    var generated = new Date(payload.generated_at);
    document.getElementById('traffic-updated').textContent = text('atualizado às ', 'updated at ') + (isNaN(generated.getTime()) ? '—' : formatTime(payload.generated_at)) + ' BRT';
    var demo = document.getElementById('traffic-demo');
    if (demo) { demo.hidden = !payload.demo; }
    if (payload.demo) { setStatus(text('demonstração', 'demo'), 'wait'); }
    else if (!payload.schedule_active) { setStatus(text('fora da janela', 'outside schedule'), 'wait'); }
    else { setStatus(text('feed ativo', 'live feed'), 'ok'); }
  }

  function renderEvents(payload) {
    eventCache = (payload.arrivals || []).concat(payload.departures || []);
    renderEventList('traffic-arrivals', payload.arrivals || []);
    renderEventList('traffic-departures', payload.departures || []);
  }

  function renderEventList(id, list) {
    var node = document.getElementById(id);
    if (!node) { return; }
    if (!list.length) { node.innerHTML = '<li class="movement-empty">' + text('nenhum movimento registrado', 'no recorded movement') + '</li>'; return; }
    node.innerHTML = list.slice(0, 5).map(function (event) {
      var name = safe(event.registration, safe(event.flight, event.hex.toUpperCase()));
      return '<li><button class="movement-button" type="button" data-event-hex="' + escapeHtml(event.hex) + '">' +
        '<span class="movement-time">' + formatTime(event.occurred_at) + '</span>' +
        '<strong class="movement-name">' + escapeHtml(name) + '</strong>' +
        '<span class="movement-type">' + escapeHtml(safe(event.aircraft_type)) + '</span>' +
        '<span class="movement-confidence ' + (event.confidence === 'provável' ? 'probable' : '') + '">' + escapeHtml(event.confidence) + '</span>' +
        '</button></li>';
    }).join('');
    node.querySelectorAll('[data-event-hex]').forEach(function (button) {
      button.addEventListener('click', function () {
        var event = list.find(function (item) { return item.hex === button.getAttribute('data-event-hex'); });
        openAircraft(Object.assign({ lat: null, lon: null, ground_speed_kt: null, track_deg: null, vertical_rate_fpm: null }, event));
      });
    });
  }

  function renderStats(payload) {
    document.getElementById('stat-movements').textContent = safe(payload.movements, 0);
    document.getElementById('stat-arrivals').textContent = safe(payload.arrivals, 0);
    document.getElementById('stat-departures').textContent = safe(payload.departures, 0);
    document.getElementById('stat-aircraft').textContent = safe(payload.distinct_aircraft, 0);
  }

  function fetchJson(url) { return fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (response) { if (!response.ok) { throw new Error('HTTP ' + response.status); } return response.json(); }); }
  function refresh() {
    Promise.all([fetchJson(API + '/live'), fetchJson(API + '/events?limit=5'), fetchJson(API + '/stats')])
      .then(function (responses) { renderLive(responses[0]); renderEvents(responses[1]); renderStats(responses[2]); })
      .catch(function () { setStatus(text('feed indisponível', 'feed unavailable'), 'fail'); });
  }

  function openAircraft(plane) {
    if (!dialog || !dialogContent) { return; }
    var title = label(plane);
    dialogContent.innerHTML = '<article class="aircraft-detail"><p class="aircraft-detail-kicker">' + escapeHtml(safe(plane.aircraft_type, text('aeronave', 'aircraft'))) + ' · HEX ' + escapeHtml(String(plane.hex).toUpperCase()) + '</p>' +
      '<h3>' + escapeHtml(title) + '</h3><div class="aircraft-detail-grid">' +
      detail(text('Callsign', 'Callsign'), safe(plane.flight)) + detail(text('Altitude', 'Altitude'), formatNumber(plane.altitude_ft) + ' ft') +
      detail(text('Velocidade', 'Speed'), typeof plane.ground_speed_kt === 'number' ? formatNumber(plane.ground_speed_kt) + ' kt' : '—') +
      detail(text('Rumo', 'Track'), typeof plane.track_deg === 'number' ? formatNumber(plane.track_deg) + '°' : '—') +
      detail(text('Razão vertical', 'Vertical rate'), typeof plane.vertical_rate_fpm === 'number' ? formatNumber(plane.vertical_rate_fpm) + ' ft/min' : '—') +
      detail(text('Matrícula', 'Registration'), safe(plane.registration)) + '</div>' +
      '<p class="photo-loading" id="photo-loading">' + text('Buscando fotografia sob demanda…', 'Loading photo on demand…') + '</p><div id="aircraft-photo"></div></article>';
    dialog.showModal();
    fetchPhoto(plane.hex);
  }
  function detail(name, value) { return '<div><span>' + escapeHtml(name) + '</span><strong>' + escapeHtml(value) + '</strong></div>'; }
  function fetchPhoto(hex) {
    fetchJson(API + '/photo/' + encodeURIComponent(hex)).then(function (payload) {
      var loading = document.getElementById('photo-loading');
      var target = document.getElementById('aircraft-photo');
      if (loading) { loading.remove(); }
      if (!target) { return; }
      var photo = payload.photos && payload.photos[0];
      if (!photo) { target.innerHTML = '<p class="photo-loading">' + text('Fotografia não encontrada para esta aeronave.', 'No photo found for this aircraft.') + '</p>'; return; }
      var image = photo.thumbnail_large || photo.thumbnail;
      var source = image && image.src;
      var link = photo.link || 'https://www.planespotters.net/';
      var credit = photo.photographer || text('fotógrafo informado na fonte', 'photographer credited at source');
      if (!source) { return; }
      target.innerHTML = '<figure class="aircraft-photo"><a href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer"><img src="' + escapeHtml(source) + '" alt="' + text('Fotografia da aeronave', 'Aircraft photo') + '"></a><figcaption>© ' + escapeHtml(credit) + ' · Planespotters.net</figcaption></figure>';
    }).catch(function () {
      var loading = document.getElementById('photo-loading');
      if (loading) { loading.textContent = text('Fotografia indisponível no momento.', 'Photo currently unavailable.'); }
    });
  }

  function matchAircraft(item, query) {
    return [item.hex, item.registration, item.flight].some(function (value) { return value && String(value).toLowerCase().indexOf(query) !== -1; });
  }
  function search() {
    var query = document.getElementById('traffic-search').value.trim().toLowerCase();
    if (!query) { return; }
    var plane = Object.keys(aircraftByHex).map(function (key) { return aircraftByHex[key]; }).find(function (item) { return matchAircraft(item, query); });
    if (plane) { openAircraft(plane); }
    else {
      fetchJson(API + '/events?limit=100').then(function (payload) {
        var found = (payload.arrivals || []).concat(payload.departures || []).find(function (item) { return matchAircraft(item, query); });
        if (found) { openAircraft(Object.assign({ ground_speed_kt: null, track_deg: null, vertical_rate_fpm: null }, found)); return; }
        dialogContent.innerHTML = '<article class="aircraft-detail"><p class="aircraft-detail-kicker">' + text('Pesquisa', 'Search') + '</p><h3>' + escapeHtml(query.toUpperCase()) + '</h3><p class="photo-loading">' + text('Aeronave não encontrada no tráfego atual nem no histórico recente.', 'Aircraft not found in current traffic or recent history.') + '</p></article>';
        dialog.showModal();
      });
    }
  }

  document.getElementById('traffic-fullscreen').addEventListener('click', function () {
    var shell = document.getElementById('traffic-shell');
    if (!document.fullscreenElement) { shell.requestFullscreen().then(function () { if (map) { map.resize(); } }); }
    else { document.exitFullscreen(); }
  });
  document.addEventListener('fullscreenchange', function () { window.setTimeout(function () { if (map) { map.resize(); } }, 80); });
  document.getElementById('traffic-search-button').addEventListener('click', search);
  document.getElementById('traffic-search').addEventListener('keydown', function (event) { if (event.key === 'Enter') { search(); } });
  document.getElementById('traffic-history').addEventListener('click', function () {
    dialogContent.innerHTML = '<article class="aircraft-detail"><p class="aircraft-detail-kicker">' + text('Histórico', 'History') + '</p><h3>' + text('Movimentos registrados', 'Recorded movements') + '</h3><p class="photo-loading">' + text('Carregando…', 'Loading…') + '</p></article>';
    dialog.showModal();
    fetchJson(API + '/events?limit=50').then(function (payload) {
      var all = (payload.arrivals || []).concat(payload.departures || []).sort(function (a, b) { return new Date(b.occurred_at) - new Date(a.occurred_at); });
      var rows = all.map(function (event) { return '<li><span class="movement-time">' + formatTime(event.occurred_at) + '</span><strong class="movement-name">' + escapeHtml(safe(event.registration, event.hex.toUpperCase())) + '</strong><span class="movement-type">' + (event.kind === 'arrival' ? 'ARR' : 'DEP') + '</span><span class="movement-confidence ' + (event.confidence === 'provável' ? 'probable' : '') + '">' + escapeHtml(event.confidence) + '</span></li>'; }).join('');
      dialogContent.innerHTML = '<article class="aircraft-detail"><p class="aircraft-detail-kicker">' + text('Histórico', 'History') + '</p><h3>' + text('Movimentos registrados', 'Recorded movements') + '</h3><ol class="movement-list history-list">' + (rows || '<li class="movement-empty">' + text('Nenhum movimento registrado.', 'No recorded movements.') + '</li>') + '</ol></article>';
    });
  });
  document.getElementById('aircraft-dialog-close').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (event) { if (event.target === dialog) { dialog.close(); } });

  initializeMap();
  refresh();
  window.setInterval(refresh, REFRESH_MS);
}());
