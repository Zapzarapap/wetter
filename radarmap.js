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
  const FRAME_STEP = 10 * 60000;   // Abstand der Zeitbilder
  const FRAMES_BACK = 6;           // 1 Stunde zurück vor dem letzten Messbild
  const FRAMES_FWD = 12;           // 2 Stunden voraus
  const REBUILD_MS = 10 * 60000;   // Zeitbilder höchstens so alt
  const OPACITY = 0.78;
  const AREA = { latMin: 46, latMax: 56, lonMin: 3.5, lonMax: 17.5 }; // grob das Radargebiet

  const $ = (id) => document.getElementById(id);
  const state = { place: null, map: null, marker: null, layers: [], frames: [], idx: 0, builtAt: 0, visible: false, playing: false, timer: null, building: false };

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
      let start, end;
      if (last.includes('/')) { const p = last.split('/'); start = Date.parse(p[0]); end = Date.parse(p[1]); }
      else { start = Date.parse(parts[0]); end = Date.parse(last); }
      if (isFinite(start) && isFinite(end) && end > start) return { start, end };
    }
    return null;
  }

  async function getExtent() {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 7000);
      const r = await fetch(CAPS, { signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ext = parseExtent(await r.text());
      if (ext) return ext;
      throw new Error('Zeitbereich nicht gefunden');
    } catch (e) {
      console.warn('Radar-Zeitbereich nicht abrufbar, rechne selbst:', e && e.message);
      // Ersatz: letztes Messbild ca. 10 Minuten alt, Vorhersage 2 Stunden danach
      const latest = Math.floor((Date.now() - 10 * 60000) / 300000) * 300000;
      return { start: latest - 120 * 60000, end: latest + 120 * 60000, guessed: true };
    }
  }

  function buildFrames(ext) {
    const latestObs = ext.end - 120 * 60000;         // Ende der Vorhersage minus 2 Stunden = letztes Messbild
    const first = Math.max(ext.start, latestObs - FRAMES_BACK * FRAME_STEP);
    const out = [];
    for (let t = first; t <= ext.end + 1; t += FRAME_STEP) out.push(t);
    if (out.length < 3) return [];
    return out.slice(0, FRAMES_BACK + FRAMES_FWD + 1);
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
    state.layers.forEach((l, k) => { if (l) l.setOpacity(k === i ? OPACITY : 0); });
    const s = $('radarSlider');
    if (s && Number(s.value) !== i) s.value = String(i);
    const t = state.frames[i], lb = labelFor(t);
    const out = $('radarTime');
    if (out) out.innerHTML = `<b>${clock(t)}</b> <small>${lb.rel}</small>`;
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
      if (state.idx >= state.frames.length - 1) { if (++dwell < 3) return; dwell = 0; show(0); return; }
      show(state.idx + 1);
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
    state.layers.forEach((l) => { if (l && state.map) state.map.removeLayer(l); });
    state.layers = [];
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
      let ok = false, errs = 0;
      const mk = (t, i) => {
        const l = L.tileLayer.wms(WMS, {
          layers: LAYER, format: 'image/png', transparent: true, version: '1.1.1', styles: '',
          exceptions: 'application/vnd.ogc.se_blank', time: new Date(t).toISOString(),
          pane: 'radar', opacity: i === start ? OPACITY : 0, attribution: '',
        });
        if (i === start) {
          l.on('tileload', () => { ok = true; note(''); });
          l.on('tileerror', () => { errs++; });
          setTimeout(() => { if (!ok && errs > 0) note('Radarbilder sind gerade nicht erreichbar.'); }, 8000);
        }
        return l;
      };
      state.layers = new Array(frames.length).fill(null);
      state.layers[start] = mk(frames[start], start).addTo(state.map);
      show(start);
      // übrige Zeitbilder nacheinander vorladen, damit das Abspielen flüssig läuft
      frames.forEach((t, i) => {
        if (i === start) return;
        setTimeout(() => {
          if (state.frames !== frames || !state.map) return;
          state.layers[i] = mk(t, i).addTo(state.map);
        }, 150 + Math.abs(i - start) * 140);
      });
      if (ext.guessed) console.info('Radar: Zeitbilder geschätzt');
    } catch (e) {
      console.warn('Radar konnte nicht aufgebaut werden:', e);
      note('Radar ist gerade nicht verfügbar.');
    } finally {
      state.building = false;
    }
  }

  function build() {
    if (state.map || !state.place || typeof L === 'undefined') return;
    const el = $('radarMap');
    const touch = L.Browser.touch && L.Browser.mobile;
    const map = L.map(el, {
      center: [state.place.lat, state.place.lon], zoom: 9, minZoom: 5, maxZoom: 13,
      dragging: !touch,            // am Handy scrollt ein Finger die Seite, zwei Finger bewegen/zoomen die Karte
      scrollWheelZoom: false, tap: false, zoomSnap: 0.5, worldCopyJump: false,
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);
    map.createPane('radar');
    map.getPane('radar').style.zIndex = 250;
    map.getPane('radar').style.pointerEvents = 'none';
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende · Radar: Deutscher Wetterdienst',
    }).addTo(map);
    state.marker = L.circleMarker([state.place.lat, state.place.lon], {
      radius: 6, color: '#fff', weight: 2.5, fillColor: '#2a7fe3', fillOpacity: 1, interactive: false,
    }).addTo(map);
    // Mausrad erst nach Klick, damit man beim Scrollen nicht versehentlich zoomt
    map.on('click', () => map.scrollWheelZoom.enable());
    el.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
    state.map = map;
    setTimeout(() => map.invalidateSize(), 200);
    $('radarHint').textContent = touch ? 'Mit zwei Fingern bewegen und zoomen.' : 'Mit der Maus ziehen, nach Klick mit dem Mausrad zoomen.';
    loadFrames();
  }

  function onVisible() {
    state.visible = true;
    if (!state.map) build();
    else if (Date.now() - state.builtAt > REBUILD_MS) loadFrames();
  }

  /* ---------- Schnittstelle ---------- */
  function update(place) {
    const card = $('radarCard');
    if (!card) return;
    if (typeof L === 'undefined' || !inArea(place)) { card.hidden = true; state.place = null; setPlaying(false); return; }
    const moved = !state.place || Math.abs(state.place.lat - place.lat) > 0.003 || Math.abs(state.place.lon - place.lon) > 0.003;
    state.place = { lat: place.lat, lon: place.lon };
    card.hidden = false;
    if (state.map) {
      if (moved) { state.map.setView([place.lat, place.lon], Math.max(state.map.getZoom(), 8), { animate: false }); state.marker.setLatLng([place.lat, place.lon]); }
      if (state.visible && Date.now() - state.builtAt > REBUILD_MS) loadFrames();
    } else if (state.visible) {
      build();
    }
  }

  function init() {
    const card = $('radarCard');
    if (!card) return;
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
