/* Regenradar-Karte: Leaflet (liegt unter vendor/leaflet), Kartenbild von OpenStreetMap,
 * Radar vom DWD-Kartendienst (WMS, Layer dwd:Niederschlagsradar = RV-Produkt: 1 km, alle 5 Minuten,
 * 2 Stunden zurück und 2 Stunden voraus). Kein API-Key. Quelle: Deutscher Wetterdienst.
 *
 * Aufbau: Für jedes Zeitbild (alle 10 Minuten) gibt es eine eigene WMS-Schicht, die unsichtbar vorgeladen wird;
 * Abspielen und Schieberegler schalten nur die Sichtbarkeit um (kein Flackern).
 * Die Karte wird erst gebaut, wenn die Karte auf dem Bildschirm in die Nähe kommt (spart Daten).
 * Öffentliche Schnittstelle: RadarMap.update(place) mit place = {lat, lon}.
 */
(function () {
  'use strict';

  const WMS = 'https://maps.dwd.de/geoserver/dwd/wms';
  const CAPS = 'https://maps.dwd.de/geoserver/dwd/Niederschlagsradar/wms?service=WMS&version=1.1.1&request=GetCapabilities';
  const LAYER = 'dwd:Niederschlagsradar';
  const FRAME_STEP = 10 * 60000;   // Abstand der Zeitbilder (der DWD verlangt Zeiten genau auf seinem Raster, sonst kommt ein leeres Bild)
  const FRAMES_BACK = 3;           // 30 Minuten zurück vor dem letzten Messbild
  const FRAMES_FWD = 12;           // 2 Stunden voraus
  const PARALLEL = 2;              // so viele Zeitbilder gleichzeitig vorladen (Handy: wenige Verbindungen pro Server)
  const REBUILD_MS = 10 * 60000;   // Zeitbilder höchstens so alt
  const OPACITY = 0.78;
  const AREA = { latMin: 46, latMax: 56, lonMin: 3.5, lonMax: 17.5 }; // grob das Radargebiet

  const $ = (id) => document.getElementById(id);
  const state = { fillId: 0, loaded: [], okTiles: [], errTiles: [], night: false, base: null, labels: null, place: null, map: null, marker: null, layers: [], frames: [], idx: 0, builtAt: 0, visible: false, playing: false, timer: null, building: false };
  const START_ZOOM = 10.5;         // ca. 20-30 km Ausschnitt am Handy

  const inArea = (p) => p && p.lat > AREA.latMin && p.lat < AREA.latMax && p.lon > AREA.lonMin && p.lon < AREA.lonMax;

  /* ---------- Zeiten ---------- */
  // Zeitbereich der Ebene aus GetCapabilities, z. B. "2026-10-27T10:50:00.000Z/2026-10-27T13:00:00.000Z/PT5M"
  function parseExtent(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const layers = [...doc.getElementsByTagName('Layer')].filter((l) => {
      const n = [...l.children].find((c) => c.tagName === 'Name');
      return n && /(^|:)Niederschlagsradar$/.test(n.textContent.trim());
    });
    for (const l of layers) {
      const dims = [...l.children].filter((c) => c.tagName === 'Dimension' || c.tagName === 'Extent');
      // WMS 1.1.1: Dimension nur als Deklaration, die Werte stehen im Extent; WMS 1.3.0: Werte im Dimension
      const dim = dims.find((c) => (c.getAttribute('name') || '').toLowerCase() === 'time' && c.textContent.trim());
      if (!dim) continue;
      const parts = dim.textContent.trim().split(',').map((s) => s.trim()).filter(Boolean);
      if (!parts.length) continue;
      const last = parts[parts.length - 1];
      let start, end, period = 0;
      if (last.includes('/')) {
        const p = last.split('/'); start = Date.parse(p[0]); end = Date.parse(p[1]);
        const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?)$/.exec(p[2] || '');
        if (m) period = ((Number(m[1]) || 0) * 60 + (Number(m[2]) || 0)) * 60000;
      } else {
        start = Date.parse(parts[0]); end = Date.parse(last);
        if (parts.length > 1) period = end - Date.parse(parts[parts.length - 2]);
      }
      if (isFinite(start) && isFinite(end) && end > start) return { start, end, period };
    }
    return null;
  }

  async function getExtent() {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(CAPS, { signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ext = parseExtent(await r.text());
      if (ext) return ext;
      throw new Error('Zeitbereich nicht gefunden');
    } catch (e) {
      console.warn('Radar-Zeitbereich nicht abrufbar, rechne selbst:', e && e.message);
      // Ersatz: letztes Messbild ca. 10 Minuten alt, Vorhersage 2 Stunden danach
      // Auf das 10-Minuten-Raster (volle Zehnerminuten) abgerundet, weil der DWD nur Zeiten auf seinem Raster annimmt
      const latest = Math.floor((Date.now() - 10 * 60000) / FRAME_STEP) * FRAME_STEP;
      return { start: latest - 120 * 60000, end: latest + 120 * 60000, period: 300000, guessed: true };
    }
  }

  // Zeitbilder vom Ende rückwärts im 10-Minuten-Raster (Vielfaches der Periode des Dienstes), damit jede Zeit auf dessen Raster liegt
  function buildFrames(ext) {
    const per = ext.period > 0 ? ext.period : 300000;
    const step = per * Math.max(1, Math.round(FRAME_STEP / per));
    const latestObs = ext.end - 120 * 60000;         // Ende der Vorhersage minus 2 Stunden = letztes Messbild
    const lower = Math.max(ext.start, latestObs - FRAMES_BACK * step);
    const out = [];
    for (let t = ext.end; t >= lower - 1 && out.length < FRAMES_BACK + FRAMES_FWD + 1; t -= step) out.unshift(t);
    return out.length < 3 ? [] : out;
  }

  const nowIndex = (frames) => {
    const now = Date.now();
    let best = 0;
    frames.forEach((t, i) => { if (Math.abs(t - now) < Math.abs(frames[best] - now)) best = i; });
    return best;
  };

  const clock = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  function labelFor(ms) {
    const diff = Math.round((ms - Date.now()) / 60000);
    if (Math.abs(diff) < 8) return { rel: 'jetzt', fc: false };
    const m = Math.abs(diff);
    const txt = m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
    return diff > 0 ? { rel: `in ${txt} · Vorhersage`, fc: true } : { rel: `vor ${txt}`, fc: false };
  }

  /* ---------- Anzeige ---------- */
  function show(i) {
    if (!state.frames.length) return;
    i = Math.max(0, Math.min(state.frames.length - 1, i));
    state.idx = i;
    if (!state.layers[i] && state.map) { // Zeitbild noch nicht geladen (Schieberegler vorgezogen): sofort anfordern
      state.layers[i] = mkLayer(state.frames[i], i, OPACITY);
      state.layers[i].addTo(state.map);
    }
    state.layers.forEach((l, k) => { if (l) l.setOpacity(k === i ? OPACITY : 0); });
    const s = $('radarSlider');
    if (s && Number(s.value) !== i) s.value = String(i);
    drawLabel();
  }

  function drawLabel() {
    const i = state.idx, t = state.frames[i];
    if (t == null) return;
    const lb = labelFor(t);
    let st = '';
    if (!state.loaded[i]) st = state.errTiles[i] > 0 && !(state.okTiles[i] > 0) ? ' · nicht verfügbar' : ' · lädt …';
    const out = $('radarTime');
    if (out) out.innerHTML = `<b>${clock(t)}</b> <small>${lb.rel}${st}</small>`;
  }

  function setPlaying(on) {
    state.playing = on;
    clearInterval(state.timer);
    const b = $('radarPlay');
    if (b) { b.classList.toggle('on', on); b.setAttribute('aria-label', on ? 'Pause' : 'Abspielen'); }
    if (!on) return;
    let dwell = 0;
    state.timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const loadedIdx = state.frames.map((_, k) => k).filter((k) => state.loaded[k]);
      if (!loadedIdx.length) return;
      const nxt = loadedIdx.find((k) => k > state.idx);
      if (nxt === undefined) { if (++dwell < 3) return; dwell = 0; show(loadedIdx[0]); return; }
      show(nxt);
    }, 450);
  }

  function note(text) {
    const n = $('radarNote');
    if (!n) return;
    n.hidden = !text;
    n.textContent = text || '';
  }

  /* ---------- Karte ---------- */
  function clearLayers() {
    state.fillId++;
    state.layers.forEach((l) => { if (l && state.map) state.map.removeLayer(l); });
    state.layers = []; state.loaded = []; state.okTiles = []; state.errTiles = [];
  }

  function mkLayer(t, i, opacity) {
    state.okTiles[i] = 0; state.errTiles[i] = 0; state.loaded[i] = false;
    const l = L.tileLayer.wms(WMS, {
      layers: LAYER, format: 'image/png', transparent: true, version: '1.1.1', styles: '',
      exceptions: 'application/vnd.ogc.se_blank', time: new Date(t).toISOString(),
      pane: 'radar', opacity, attribution: '',
      tileSize: 512, zoomOffset: -1,   // große Kacheln: etwa vier Mal weniger Anfragen
      interpolations: 'Bilinear', // GeoServer-Zusatz: glattere Werte statt harter 1-km-Stufen (wird ignoriert, wenn nicht unterstützt)
      updateWhenIdle: true, keepBuffer: 1,
    });
    l.on('tileload', () => { state.okTiles[i]++; if (i === state.idx) drawLabel(); });
    l.on('tileerror', () => { state.errTiles[i]++; if (i === state.idx) drawLabel(); });
    l.on('load', () => { state.loaded[i] = true; if (i === state.idx) drawLabel(); });
    return l;
  }

  // Übrige Zeitbilder nacheinander (je PARALLEL gleichzeitig) laden, zuerst die kommenden, dann die vergangenen;
  // so konkurrieren sie nicht mit dem sichtbaren Bild um die wenigen Verbindungen.
  function fill(frames, center) {
    const id = ++state.fillId;
    const order = [];
    for (let i = center + 1; i < frames.length; i++) order.push(i);
    for (let i = center - 1; i >= 0; i--) order.push(i);
    const pump = () => {
      if (id !== state.fillId || state.frames !== frames || !state.map) return;
      const i = order.shift();
      if (i === undefined) return;
      let l = state.layers[i];
      if (!l) { l = mkLayer(frames[i], i, 0); state.layers[i] = l; l.addTo(state.map); }
      if (state.loaded[i]) return pump();
      let done = false;
      const go = () => { if (done) return; done = true; clearTimeout(tm); pump(); };
      const tm = setTimeout(go, 5000);
      l.once('load', go);
    };
    for (let k = 0; k < PARALLEL; k++) pump();
  }

  // Nach Verschieben oder Zoomen nur das sichtbare Bild neu laden, die anderen danach wieder nacheinander
  // Das Radar hat 1-km-Pixel und wirkt kantig. Leichtes Weichzeichnen (Anteil eines Pixels, wächst mit dem Zoom) macht
  // daraus weiche Flächen. Kostet fast nichts, weil die Grafikkarte es übernimmt.
  function softenRadar() {
    const map = softenRadar.map;
    if (!map || !state.place) return;
    const mPerPx = 156543.03 * Math.cos(state.place.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
    const pxPerKm = 1000 / mPerPx;
    const b = Math.max(0.6, Math.min(7, pxPerKm * 0.3));
    map.getPane('radar').style.filter = `blur(${b.toFixed(1)}px)`;
  }

  function onMoved() {
    if (!state.frames.length || !state.map) return;
    clearTimeout(state.moveTimer);
    state.moveTimer = setTimeout(() => {
      const frames = state.frames, cur = state.idx;
      state.fillId++;
      state.layers.forEach((l, k) => { if (l && k !== cur) { state.map.removeLayer(l); state.layers[k] = null; state.loaded[k] = false; } });
      setTimeout(() => { if (state.frames === frames) fill(frames, state.idx); }, 600);
    }, 350);
  }

  async function loadFrames() {
    if (state.building || !state.map) return;
    state.building = true;
    try {
      const ext = await getExtent();
      const frames = buildFrames(ext);
      if (!frames.length) throw new Error('keine Zeitbilder');
      clearLayers();
      state.frames = frames;
      state.builtAt = Date.now();
      const slider = $('radarSlider');
      slider.max = String(frames.length - 1);
      const start = nowIndex(frames);
      state.layers = new Array(frames.length).fill(null);
      state.layers[start] = mkLayer(frames[start], start, OPACITY);
      state.layers[start].addTo(state.map);
      show(start);
      // erst wenn das sichtbare Bild da ist (oder nach 6 s), die übrigen nachladen
      let started = false;
      const go = () => { if (started) return; started = true; fill(frames, start); };
      state.layers[start].once('load', go);
      setTimeout(go, 6000);
      setTimeout(() => {
        if (state.frames === frames && !state.loaded[start] && !(state.okTiles[start] > 0) && state.errTiles[start] > 0) note('Radarbilder sind gerade nicht erreichbar.');
      }, 9000);
      if (ext.guessed) console.info('Radar: Zeitbilder geschätzt');
    } catch (e) {
      console.warn('Radar konnte nicht aufgebaut werden:', e);
      note('Radar ist gerade nicht verfügbar.');
    } finally {
      state.building = false;
    }
  }

  // Ruhiges, helles bzw. nachts dunkles Kartenbild: Esri "Gray Canvas" (ohne Key nutzbar, Stand 10/2026).
  // Grundkarte ohne Beschriftung unten, Ortsnamen/Straßen als dünne Schicht ÜBER dem Radar, damit man sich orientieren kann.
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_';
  const ESRI_ATTR = 'Karte: © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · Radar: Deutscher Wetterdienst';
  function setBase(map) {
    const shade = state.night ? 'Dark_Gray' : 'Light_Gray';
    if (state.base) map.removeLayer(state.base);
    if (state.labels) map.removeLayer(state.labels);
    state.base = L.tileLayer(`${ESRI}${shade}_Base/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, maxNativeZoom: 16, attribution: ESRI_ATTR }).addTo(map);
    state.base.setZIndex(1);
    state.labels = L.tileLayer(`${ESRI}${shade}_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, maxNativeZoom: 16, pane: 'labels', attribution: '' }).addTo(map);
  }

  function build() {
    if (state.map || !state.place || typeof L === 'undefined') return;
    const el = $('radarMap');
    const touch = L.Browser.touch && L.Browser.mobile;
    const map = L.map(el, {
      center: [state.place.lat, state.place.lon], zoom: START_ZOOM, minZoom: 7, maxZoom: 15,
      dragging: !touch,            // am Handy scrollt ein Finger die Seite, zwei Finger bewegen/zoomen die Karte
      scrollWheelZoom: false, tap: false, zoomSnap: 0.5, worldCopyJump: false,
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);
    map.createPane('radar');
    map.getPane('radar').style.zIndex = 250;
    map.getPane('radar').style.pointerEvents = 'none';
    map.on('zoomend', softenRadar);
    softenRadar.map = map;
    map.createPane('labels');      // Ortsnamen über dem Radar
    map.getPane('labels').style.zIndex = 350;
    map.getPane('labels').style.pointerEvents = 'none';
    setBase(map);
    state.marker = L.circleMarker([state.place.lat, state.place.lon], {
      radius: 6, color: '#fff', weight: 2.5, fillColor: '#2a7fe3', fillOpacity: 1, interactive: false,
    }).addTo(map);
    // Mausrad erst nach Klick, damit man beim Scrollen nicht versehentlich zoomt
    map.on('click', () => map.scrollWheelZoom.enable());
    el.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
    map.on('moveend', onMoved);
    softenRadar();
    state.map = map;
    setTimeout(() => map.invalidateSize(), 200);
    loadFrames();
  }

  function onVisible() {
    state.visible = true;
    if (!state.map) build();
    else if (Date.now() - state.builtAt > REBUILD_MS) loadFrames();
  }

  /* ---------- Schnittstelle ---------- */
  function update(place, night) {
    const card = $('radarCard');
    if (!card) return;
    if (typeof L === 'undefined' || !inArea(place)) { card.hidden = true; state.place = null; setPlaying(false); return; }
    const moved = !state.place || Math.abs(state.place.lat - place.lat) > 0.003 || Math.abs(state.place.lon - place.lon) > 0.003;
    state.place = { lat: place.lat, lon: place.lon };
    card.hidden = false;
    if (typeof night === 'boolean' && night !== state.night) { state.night = night; if (state.map) setBase(state.map); }
    if (state.map) {
      if (moved) { state.map.setView([place.lat, place.lon], START_ZOOM, { animate: false }); state.marker.setLatLng([place.lat, place.lon]); }
      if (state.visible && Date.now() - state.builtAt > REBUILD_MS) loadFrames();
    } else if (state.visible) {
      build();
    }
  }

  function init() {
    const card = $('radarCard');
    if (!card) return;
    // Legende: das Farbbild kommt vom DWD selbst (passt damit immer zu den Farben); wird erst beim Aufklappen geladen
    const lg = $('radarLegend'), img = $('radarLegendImg');
    if (lg && img) {
      lg.addEventListener('toggle', () => {
        if (lg.open && !img.getAttribute('src')) img.src = `${WMS}?service=WMS&version=1.1.1&request=GetLegendGraphic&format=image/png&layer=${encodeURIComponent(LAYER)}&transparent=true&legend_options=fontColor:0xFFFFFF;fontAntiAliasing:true;forceTitles:off;columns:2;dpi:140`;
      });
      img.addEventListener('error', () => { lg.hidden = true; });
    }
    $('radarSlider').addEventListener('input', (e) => { setPlaying(false); show(Number(e.target.value)); });
    $('radarPlay').addEventListener('click', () => { if (state.playing) setPlaying(false); else { if (state.idx >= state.frames.length - 1) show(0); setPlaying(true); } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') setPlaying(false); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => {
        const vis = es.some((e) => e.isIntersecting);
        if (vis) onVisible(); else { state.visible = false; setPlaying(false); }
      }, { rootMargin: '300px 0px' }).observe(card);
    } else {
      onVisible();
    }
  }

  window.RadarMap = { update };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
