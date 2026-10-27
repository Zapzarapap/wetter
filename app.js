/* Wetter – private Wetterseite
 * Daten: Open-Meteo (Vorhersage + Ortssuche), Ortsnamen: OpenStreetMap/Nominatim.
 * Kein Build-Schritt, keine Abhängigkeiten.
 */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Konfiguration                                                       */
  /* ------------------------------------------------------------------ */
  const DEFAULT_PLACE = { name: 'Hombruch', sub: 'Dortmund', lat: 51.4615, lon: 7.4535, geo: false };
  const API_FORECAST = 'https://api.open-meteo.com/v1/forecast';
  const API_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
  const API_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
  const KEY_PLACE = 'wetter:place:v1';
  const KEY_CACHE = 'wetter:cache:v1';
  const REFRESH_MS = 15 * 60 * 1000;
  const SAME_PLACE_KM = 0.3;
  const HOURS = 48;
  // "Tropfen": 15-Minuten-Block ist trocken (< 0,1 mm), aber Regen liegt in der Luft:
  // Regenwahrscheinlichkeit der Stunde >= DROPS_PP, die Stunde hat insgesamt >= 0,1 mm, oder der Wettercode meldet Niesel/leichten Regen.
  const DROPS_PP = 50;
  // Regenwahrscheinlichkeit nur anzeigen, wenn sie aussagekräftig ist (< PP_MIN gilt als trocken, es erscheint nichts); gerundet auf 10 %.
  const PP_MIN = 20;
  // Sonnenstunden = "Sonne ohne Wolken davor": Bewölkung <= SUN_CLOUD_MIN zählt voll, >= SUN_CLOUD_MAX gar nicht, dazwischen linear.
  const SUN_CLOUD_MIN = 15;
  const SUN_CLOUD_MAX = 85;
  const DROPS_CODES = new Set([51, 53, 56, 61, 66, 71, 77, 80, 85]);
  const RAIN_BLOCKS = 8; // 8 x 15 Minuten = 2 Stunden
  const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  /* ------------------------------------------------------------------ */
  /* Helfer                                                              */
  /* ------------------------------------------------------------------ */
  const $ = (s) => document.querySelector(s);
  const el = {
    q: $('#q'), locate: $('#locate'), results: $('#results'), main: $('#main'),
    placeName: $('#placeName'), placeSub: $('#placeSub'), status: $('#status'), note: $('#note'),
    loading: $('#loading'), now: $('#nowCard'), hourly: $('#hourly'), rain: $('#rain'),
    daily: $('#daily'), toggleDays: $('#toggleDays'), hbar: $('#hbar'), hthumb: $('#hthumb'),
  };

  const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
  const num = (v) => typeof v === 'number' && isFinite(v);
  const deg = (v) => (num(v) ? nf0.format(Math.round(v) || 0) + '°' : '–');
  const int = (v) => (num(v) ? nf0.format(Math.round(v)) : '–');
  // Wind als "Durchschnitt–Böen", z. B. 24–35
  const windStr = (avg, gust) => (num(gust) ? (num(avg) ? `${int(avg)}–${int(gust)}` : int(gust)) : '–');
  const ppHtml = (pp) => (num(pp) && pp >= PP_MIN ? `${ui('drop')}${Math.round(pp / 10) * 10}%` : '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const loadJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* Speicher voll oder gesperrt */ } };

  function km(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Open-Meteo liefert mit timezone=auto lokale Zeiten ohne Offset ("2026-10-27T09:15").
  // Wir rechnen intern in "lokale Zeit des Ortes als UTC-Millisekunden".
  const tMs = (s) => Date.parse(s.length === 16 ? s + ':00Z' : s.length === 10 ? s + 'T00:00:00Z' : s + 'Z');
  const localNowMs = (d) => Date.now() + (d.utc_offset_seconds || 0) * 1000;
  const hhmm = (s) => s.slice(11, 16);
  const hhmmFromMs = (ms) => new Date(ms).toISOString().slice(11, 16);
  const todayStr = (d) => new Date(localNowMs(d)).toISOString().slice(0, 10);
  const weekday = (dateStr) => WEEKDAYS[new Date(dateStr + 'T00:00:00Z').getUTCDay()];
  const clockStr = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  /* ------------------------------------------------------------------ */
  /* Wettercodes: Text, Icon-Art, Farbwelt                               */
  /* ------------------------------------------------------------------ */
  const TEXT = {
    0: ['Sonnig', 'Klar'], 1: ['Überwiegend sonnig', 'Überwiegend klar'], 2: 'Teils bewölkt', 3: 'Bedeckt',
    45: 'Nebel', 48: 'Reifnebel',
    51: 'Leichter Nieselregen', 53: 'Nieselregen', 55: 'Starker Nieselregen',
    56: 'Gefrierender Nieselregen', 57: 'Starker gefrierender Nieselregen',
    61: 'Leichter Regen', 63: 'Regen', 65: 'Starker Regen', 66: 'Gefrierender Regen', 67: 'Starker gefrierender Regen',
    71: 'Leichter Schneefall', 73: 'Schneefall', 75: 'Starker Schneefall', 77: 'Schneegriesel',
    80: 'Leichte Regenschauer', 81: 'Regenschauer', 82: 'Heftige Regenschauer',
    85: 'Leichte Schneeschauer', 86: 'Schneeschauer',
    95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Schweres Gewitter mit Hagel',
  };

  function describe(code, isDay) {
    const t = TEXT[code];
    if (Array.isArray(t)) return isDay ? t[0] : t[1];
    return t || 'Unbekannt';
  }

  // Icon-Art
  function iconKind(code) {
    if (code === 0 || code === 1) return 'clear';
    if (code === 2) return 'partly';
    if (code === 3) return 'cloudy';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if (code === 65 || code === 67 || code === 82) return 'heavy';
    if ((code >= 61 && code <= 66) || code === 80 || code === 81) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'cloudy';
  }

  // Farbwelt für den Hintergrund
  function themeKind(code) {
    if (code === 0 || code === 1) return 'clear';
    if (code === 2) return 'partly';
    if (code === 3) return 'cloudy';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 51 && code <= 57) || code === 61 || code === 80) return 'lightrain';
    if (code >= 61 && code <= 67) return 'rain';
    if (code === 81 || code === 82) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    return 'cloudy';
  }

  const THEMES = {
    day: {
      clear: ['#2a7fe3', '#7fc6f5'], partly: ['#4a8fd4', '#93bfe3'], cloudy: ['#5f7389', '#8497ab'],
      fog: ['#71838f', '#98a7b3'], lightrain: ['#52667c', '#7a8ba0'], rain: ['#3d4e63', '#5c6f86'],
      snow: ['#6a849f', '#9bb1c6'], storm: ['#3a3452', '#5a4f78'],
    },
    night: {
      clear: ['#0a1838', '#1d3768'], partly: ['#111e3a', '#2a3e60'], cloudy: ['#19222f', '#2e3b4e'],
      fog: ['#1d2833', '#394755'], lightrain: ['#131b29', '#263447'], rain: ['#0e1420', '#1c2737'],
      snow: ['#1b293c', '#394d66'], storm: ['#130e22', '#2c2346'],
    },
  };

  function applyTheme(code, isDay) {
    const pair = THEMES[isDay ? 'day' : 'night'][themeKind(code)];
    const root = document.documentElement.style;
    root.setProperty('--bg1', pair[0]);
    root.setProperty('--bg2', pair[1]);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', pair[0]);
  }

  /* ------------------------------------------------------------------ */
  /* Icons                                                               */
  /* ------------------------------------------------------------------ */
  const CLOUD = (fill, tf) =>
    `<g${tf ? ` transform="${tf}"` : ''} fill="${fill}"><circle cx="16" cy="27" r="7"/><circle cx="24" cy="22" r="9.5"/>` +
    `<circle cx="32.5" cy="27.5" r="6.5"/><rect x="16" y="27" width="17" height="7"/></g>`;

  const SUN = (cx, cy, r) => {
    let rays = '';
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
      rays += `<line x1="${(cx + (r + 3) * c).toFixed(1)}" y1="${(cy + (r + 3) * s).toFixed(1)}" ` +
              `x2="${(cx + (r + 6) * c).toFixed(1)}" y2="${(cy + (r + 6) * s).toFixed(1)}"/>`;
    }
    return `<g stroke="#FFC83D" stroke-width="2.4" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFC83D"/>`;
  };

  const MOON = (tf) => `<path transform="${tf}" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="#EEF2FA"/>`;
  const DROPS = (xs, y1, y2) => `<g stroke="#6AB7FF" stroke-width="2.6" stroke-linecap="round">${xs.map((x) => `<line x1="${x}" y1="${y1}" x2="${x - 1.5}" y2="${y2}"/>`).join('')}</g>`;

  function iconSvg(code, isDay) {
    let body;
    switch (iconKind(code)) {
      case 'clear': body = isDay ? SUN(24, 24, 9) : MOON('translate(6 6) scale(1.6)'); break;
      case 'partly': body = (isDay ? SUN(18, 17, 7) : MOON('translate(2 0) scale(1.1)')) + CLOUD('#fff', 'translate(6 6) scale(.9)'); break;
      case 'cloudy': body = CLOUD('#B7C2D1', 'translate(10 1) scale(.8)') + CLOUD('#F4F7FB', 'translate(-1 5)'); break;
      case 'fog':
        body = CLOUD('#E3E9F0', 'translate(0 -5)') +
          '<g stroke="#E6EBF0" stroke-width="2.6" stroke-linecap="round"><line x1="10" y1="34" x2="38" y2="34"/><line x1="14" y1="39" x2="40" y2="39"/><line x1="10" y1="44" x2="34" y2="44"/></g>';
        break;
      case 'drizzle':
        body = CLOUD('#E0E7EF', 'translate(0 -3)') +
          '<g fill="#6AB7FF"><circle cx="17" cy="37" r="1.7"/><circle cx="24" cy="40" r="1.7"/><circle cx="31" cy="37" r="1.7"/><circle cx="20.5" cy="44" r="1.7"/><circle cx="27.5" cy="44" r="1.7"/></g>';
        break;
      case 'rain': body = CLOUD('#E0E7EF', 'translate(0 -3)') + DROPS([17, 24, 31], 35, 41); break;
      case 'heavy': body = CLOUD('#AEB9C9', 'translate(0 -3)') + DROPS([14, 21, 28, 35], 35, 44); break;
      case 'snow':
        body = CLOUD('#DDE5EE', 'translate(0 -3)') +
          '<g fill="#fff"><circle cx="16" cy="37" r="2.2"/><circle cx="24" cy="40" r="2.2"/><circle cx="32" cy="37" r="2.2"/><circle cx="20" cy="44" r="2.2"/><circle cx="28" cy="44" r="2.2"/></g>';
        break;
      case 'storm':
        body = CLOUD('#AEB9C9', 'translate(0 -4)') + '<polygon points="27,29 19,39.5 24.5,39.5 21,47 32,35.5 26.5,35.5" fill="#FFD84A"/>';
        break;
      default: body = CLOUD('#F4F7FB');
    }
    return `<svg class="wi" viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
  }

  const UI = {
    drop: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    humidity: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
    wind: '<path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>',
    thermo: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
    sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
    sunrise: '<path d="M17 18a5 5 0 0 0-10 0M12 2v7M4.22 10.22l1.42 1.42M1 18h2M21 18h2M18.36 11.64l1.42-1.42M23 22H1M8 6l4-4 4 4"/>',
    sunset: '<path d="M17 18a5 5 0 0 0-10 0M12 9V2M4.22 10.22l1.42 1.42M1 18h2M21 18h2M18.36 11.64l1.42-1.42M23 22H1M16 5l-4 4-4-4"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  };
  const ui = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${UI[n]}</svg>`;

  /* ------------------------------------------------------------------ */
  /* Zustand                                                             */
  /* ------------------------------------------------------------------ */
  const state = {
    place: null,      // aktuell angezeigter Ort {name, sub, lat, lon, geo}
    data: null,       // Open-Meteo-Antwort
    dataPlace: null,  // Koordinaten, zu denen data gehört
    fetchedAt: 0,
    status: 'idle',   // idle | loading | ok | error
    reqId: 0,
    inflight: null,
    days: 7,
    open: new Set(), // aufgeklappte Tage (Datum)
    note: '',
  };

  /* ------------------------------------------------------------------ */
  /* Datenzugriff                                                        */
  /* ------------------------------------------------------------------ */
  async function fetchForecast(place, full = true) {
    const params = new URLSearchParams({
      latitude: place.lat.toFixed(4),
      longitude: place.lon.toFixed(4),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,is_day',
      hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day,uv_index' + (full ? ',cloud_cover,sunshine_duration' : ''),
      minutely_15: full ? 'precipitation,weather_code' : 'precipitation',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max',
      timezone: 'auto',
      forecast_days: '14',
      forecast_minutely_15: String(RAIN_BLOCKS + 1),
      wind_speed_unit: 'kmh',
    });
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(`${API_FORECAST}?${params}`, { signal: ctl.signal });
      if (!r.ok) {
        // Falls ein optionales Feld nicht akzeptiert wird, ohne dieses Feld erneut versuchen
        if (full && r.status === 400) return fetchForecast(place, false);
        throw new Error('HTTP ' + r.status);
      }
      const j = await r.json();
      if (j.error) throw new Error(j.reason || 'API-Fehler');
      return j;
    } finally {
      clearTimeout(to);
    }
  }

  async function reverseGeocode(lat, lon) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 7000);
    try {
      const u = `${API_REVERSE}?format=jsonv2&zoom=14&addressdetails=1&accept-language=de&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
      const r = await fetch(u, { signal: ctl.signal });
      if (!r.ok) return null;
      const a = (await r.json()).address || {};
      const city = a.city || a.town || a.village || a.municipality || a.county || '';
      const district = a.suburb || a.city_district || a.borough || a.neighbourhood || a.quarter || '';
      const name = district || city;
      if (!name) return null;
      return { name, sub: district && city && district !== city ? city : '' };
    } catch (e) {
      return null;
    } finally {
      clearTimeout(to);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Daten aufbereiten                                                   */
  /* ------------------------------------------------------------------ */
  function hourlyWindow(d, n) {
    const h = d.hourly;
    if (!h || !h.time) return [];
    const cur = Math.floor(localNowMs(d) / 3600000) * 3600000;
    const i = h.time.findIndex((t) => tMs(t) >= cur);
    if (i < 0) return [];
    const out = [];
    for (let k = i; k < h.time.length && out.length < n; k++) {
      out.push({
        time: h.time[k], temp: h.temperature_2m?.[k], pp: h.precipitation_probability?.[k], mm: h.precipitation?.[k],
        code: h.weather_code?.[k], wind: h.wind_speed_10m?.[k], gust: h.wind_gusts_10m?.[k], isDay: h.is_day?.[k] ?? 1, uv: h.uv_index?.[k],
      });
    }
    return out;
  }

  function hourlyCodeAt(d, timeStr) {
    const h = d.hourly;
    const i = h && h.time ? h.time.indexOf(timeStr.slice(0, 13) + ':00') : -1;
    return i >= 0 ? h.weather_code?.[i] : undefined;
  }

  function rainClass(mm, code) {
    if (code >= 95) return 'storm';
    if (!num(mm) || mm < 0.1) return 'dry';
    if (mm < 0.5) return 'light';
    if (mm < 1.5) return 'mid';
    return 'heavy';
  }

  function rainBlocks(d) {
    const m = d.minutely_15;
    if (!m || !m.time) return [];
    const slot = Math.floor(localNowMs(d) / 900000) * 900000;
    const i = m.time.findIndex((t) => tMs(t) >= slot);
    if (i < 0) return [];
    const out = [];
    for (let k = i; k < m.time.length && out.length < RAIN_BLOCKS; k++) {
      const mm = m.precipitation?.[k];
      const code = m.weather_code ? m.weather_code[k] : hourlyCodeAt(d, m.time[k]);
      let cls = rainClass(mm, code);
      if (cls === 'dry') {
        const hi = d.hourly?.time ? d.hourly.time.indexOf(m.time[k].slice(0, 13) + ':00') : -1;
        const pp = hi >= 0 ? d.hourly.precipitation_probability?.[hi] : undefined;
        const hmm = hi >= 0 ? d.hourly.precipitation?.[hi] : undefined;
        if ((num(pp) && pp >= DROPS_PP) || (num(hmm) && hmm >= 0.1) || DROPS_CODES.has(code)) cls = 'drops';
      }
      out.push({ time: m.time[k], mm: num(mm) ? mm : 0, code, cls });
    }
    return out;
  }

  function rainSummary(blocks) {
    const n = blocks.length;
    const wet = (b) => b.cls !== 'dry' && b.cls !== 'drops';
    const word = (b) => {
      const c = b.code;
      if (c >= 95) return 'Gewitter';
      if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'Schnee';
      if (c >= 51 && c <= 57) return 'Nieselregen';
      return 'Regen';
    };
    const endTime = hhmmFromMs(tMs(blocks[n - 1].time) + 900000);
    const first = blocks.findIndex(wet);
    if (first === -1) {
      const dr = blocks.findIndex((b) => b.cls === 'drops');
      if (dr === -1) return n === RAIN_BLOCKS ? 'Trocken in den nächsten 2 Stunden.' : `Trocken bis ${endTime}.`;
      return dr === 0 ? 'Trocken, vielleicht ein paar Tropfen.' : `Trocken, ab ${hhmm(blocks[dr].time)} vielleicht ein paar Tropfen.`;
    }
    if (first > 0) return `Trocken bis ${hhmm(blocks[first].time)}, dann ${word(blocks[first])}.`;
    const end = blocks.findIndex((b, i) => i > 0 && !wet(b));
    if (end === -1) return `${word(blocks[0])} bis mindestens ${endTime}.`;
    let s = `${word(blocks[0])} bis ${hhmm(blocks[end].time)}, danach trocken.`;
    const again = blocks.findIndex((b, i) => i > end && wet(b));
    if (again !== -1) s += ` Ab ${hhmm(blocks[again].time)} wieder ${word(blocks[again])}.`;
    return s;
  }

  function dailyStart(d) {
    const t = d.daily?.time;
    if (!t) return -1;
    return t.findIndex((x) => x >= todayStr(d));
  }

  function isDayNow(d) {
    const i = dailyStart(d);
    if (i >= 0 && d.daily.time[i] === todayStr(d) && d.daily.sunrise?.[i] && d.daily.sunset?.[i]) {
      const now = localNowMs(d);
      return now >= tMs(d.daily.sunrise[i]) && now < tMs(d.daily.sunset[i]);
    }
    return d.current?.is_day !== 0;
  }

  function uvLabel(v) {
    if (!num(v)) return '';
    if (v < 3) return 'niedrig';
    if (v < 6) return 'mäßig';
    if (v < 8) return 'hoch';
    if (v < 11) return 'sehr hoch';
    return 'extrem';
  }

  /* ------------------------------------------------------------------ */
  /* Darstellung                                                         */
  /* ------------------------------------------------------------------ */
  function renderPlace() {
    const p = state.place || DEFAULT_PLACE;
    el.placeName.textContent = p.name;
    el.placeSub.textContent = p.sub || '';
    el.note.hidden = !state.note;
    el.note.textContent = state.note;
  }

  function renderStatus() {
    const ts = state.fetchedAt ? clockStr(state.fetchedAt) : '';
    let txt;
    if (state.status === 'loading') txt = ts ? `Aktualisiere… · Stand ${ts}` : 'Lade…';
    else if (state.status === 'error') txt = ts ? `Keine Verbindung · Stand ${ts} · Tippen zum Wiederholen` : 'Fehler · Tippen zum Wiederholen';
    else txt = ts ? `Stand ${ts}` : '';
    el.status.textContent = txt;
    el.status.hidden = !txt;
    if (!state.data) {
      el.loading.textContent = state.status === 'error'
        ? 'Wetterdaten konnten nicht geladen werden.'
        : 'Wetterdaten werden geladen…';
    }
  }

  // Regen für den Rest des heutigen Tages als Uhrzeiten (nur Stunden mit >= 0,1 mm)
  function rainToday(d) {
    const h = d.hourly;
    if (!h || !h.time) return null;
    const today = todayStr(d);
    const nowH = new Date(localNowMs(d)).getUTCHours();
    const wet = new Array(24).fill(false);
    h.time.forEach((t, i) => {
      if (t.slice(0, 10) === today && num(h.precipitation?.[i]) && h.precipitation[i] >= 0.1) wet[Number(t.slice(11, 13))] = true;
    });
    const runs = [];
    for (let k = nowH; k < 24; k++) {
      if (!wet[k]) continue;
      let e = k;
      while (e < 24 && wet[e]) e++;
      runs.push({ s: k, e, now: k === nowH });
      k = e;
    }
    return runs;
  }

  function rainTodayHtml(d) {
    const runs = rainToday(d);
    if (!runs) return '–';
    if (!runs.length) return 'Trocken <small>bis 24 Uhr</small>';
    const line = (r) => `<span class="rw">${r.now ? `bis ${r.e}` : `${r.s}–${r.e}`} Uhr</span>`;
    return runs.slice(0, 2).map(line).join('') + (runs.length > 2 ? '<small>und später</small>' : '');
  }

  function renderNow(d) {
    const c = d.current || {};
    const day = isDayNow(d);
    const hr = hourlyWindow(d, 1)[0];
    const i = dailyStart(d);
    const D = d.daily || {};
    const today = i >= 0 ? { rise: D.sunrise?.[i], set: D.sunset?.[i] } : {};
    const uv = hr ? hr.uv : undefined;
    const stat = (icon, label, val) => `<div class="stat"><div class="lbl">${ui(icon)}${label}</div><div class="val">${val}</div></div>`;
    // Sonnenauf-/-untergang nur als Icon (Label für Screenreader), damit es auch auf kleinen Handys passt
    const sunStat = (icon, label, val) => `<div class="stat iconly"><div class="lbl" role="img" aria-label="${label}" title="${label}">${ui(icon)}</div><div class="val">${val}</div></div>`;
    el.now.innerHTML =
      `<div class="now-top">
         <div class="now-main">
           <div class="temp">${deg(c.temperature_2m)}</div>
           <div class="desc">${esc(describe(c.weather_code, day))}<span class="feels"> · Gefühlt ${deg(c.apparent_temperature)}</span></div>
         </div>
         <div class="now-icon">${iconSvg(c.weather_code, day)}</div>
       </div>
       <div class="stats">
         ${stat('wind', 'Wind', `${windStr(c.wind_speed_10m, c.wind_gusts_10m)} <small>km/h</small>`)}
         ${stat('sun', 'UV', num(uv) ? `${nf0.format(Math.round(uv))} <small>${uvLabel(uv)}</small>` : '–')}
         ${sunStat('sunrise', 'Sonnenaufgang', today.rise ? hhmm(today.rise) : '–')}
         ${sunStat('sunset', 'Sonnenuntergang', today.set ? hhmm(today.set) : '–')}
       </div>`;
  }

  function renderHourly(d) {
    const hrs = hourlyWindow(d, HOURS);
    const keep = el.hourly.scrollLeft;
    el.hourly.innerHTML = hrs.map((o, idx) => {
      const hour = o.time.slice(11, 13);
      const newDay = hour === '00';
      const dayLbl = idx === 0 ? 'Heute' : newDay ? weekday(o.time.slice(0, 10)) : '';
      const rain = num(o.mm) && o.mm >= 0.1 ? `${nf1.format(o.mm)} mm` : '';
      return `<div class="h${idx === 0 ? ' first' : ''}${newDay && idx > 0 ? ' midnight' : ''}">
        <span class="h-day">${dayLbl}</span>
        <span class="h-time">${idx === 0 ? 'Jetzt' : hour + ' Uhr'}</span>
        <span class="h-ico">${iconSvg(o.code, o.isDay)}</span>
        <span class="h-temp">${deg(o.temp)}</span>
        <span class="h-rain">${ppHtml(o.pp)}</span>
        <span class="h-mm">${rain}</span>
        <span class="h-gust">${ui('wind')}${windStr(o.wind, o.gust)}</span>
      </div>`;
    }).join('');
    el.hourly.scrollLeft = keep;
    updateHBar();
  }

  function renderRain(d) {
    const blocks = rainBlocks(d);
    if (blocks.length < 2) {
      el.rain.innerHTML = '<p class="rainsummary">Keine aktuellen Regendaten.</p>';
      return;
    }
    const n = blocks.length;
    const cells = blocks.map((b) => {
      const txt = b.cls === 'dry' || b.cls === 'drops' ? '' : b.mm >= 0.05 ? nf1.format(b.mm) : '';
      const tip = `${hhmm(b.time)} Uhr · ${b.cls === 'dry' ? 'trocken' : b.cls === 'drops' ? 'vielleicht ein paar Tropfen' : nf1.format(b.mm) + ' mm'}`;
      return `<div class="rb ${b.cls}" title="${tip}">${txt}</div>`;
    }).join('');
    const endMs = tMs(blocks[n - 1].time) + 900000;
    const idxs = [0, 2, 4, 6, 8].filter((i) => i <= n);
    const labels = idxs.map((i) => {
      const t = i === 0 ? 'Jetzt' : hhmmFromMs(i < n ? tMs(blocks[i].time) : endMs);
      return `<span style="left:${((i / n) * 100).toFixed(2)}%">${t}</span>`;
    }).join('');
    const calm = blocks.every((b) => b.cls === 'dry' || b.cls === 'drops'); // kein richtiger Regen in Sicht
    const hasDrops = blocks.some((b) => b.cls === 'drops');
    const msg = hasDrops ? `${ui('drop')}Höchstens ein paar Tropfen` : `${ui('check')}Kein Regen`;
    const dropsKey = '<span><i class="l0"></i>vereinzelt Tropfen</span>';
    const legend = calm
      ? (hasDrops ? `<div class="legend">${dropsKey.replace('vereinzelt Tropfen', 'gepunktet = vielleicht ein paar Tropfen')}</div>` : '')
      : `<div class="legend">${hasDrops ? dropsKey : ''}<span><i class="l1"></i>leicht</span><span><i class="l2"></i>mäßig</span><span><i class="l3"></i>stark</span><span><i class="l4"></i>Gewitter</span><span>Zahlen in mm (1 mm = 1 Liter pro m²)</span></div>`;
    el.rain.innerHTML =
      `<div class="raintrack${calm ? ' alldry' : ''}" style="--n:${n}">${cells}${calm ? `<span class="rb-msg${hasDrops ? ' pill' : ''}"><b>${msg}</b></span>` : ''}</div>
       <div class="rainlabels">${labels}</div>
       <p class="rainsummary">${esc(rainSummary(blocks))}</p>
       ${legend}`;
  }

  // Drei Blöcke pro Tag, je 8 Stunden: [von, bis] in Stunden relativ zum Tag (negativ = Vortag, 22 Uhr = -2).
  // Der Nachtblock 22–6 ist die Nacht, die in diesen Morgen hineinläuft (Vortag 22 Uhr bis 6 Uhr).
  const SEGS = [[-2, 6], [6, 14], [14, 22]];
  const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : undefined);
  // Schwere eines Niederschlags-Wettercodes (nur für Codes ab 51)
  const sev = (c) => (c >= 95 ? 9 : c === 65 || c === 67 || c === 82 ? 8
    : c === 63 || c === 66 || c === 81 || (c >= 71 && c <= 77) || c === 85 || c === 86 ? 7
    : c === 61 || c === 80 ? 6 : 5);

  // Ein Icon pro Tageszeit: schlimmstes Niederschlagswetter, aber nur wenn wirklich etwas fällt
  function repCode(codes, sum) {
    const wet = codes.filter((c) => c >= 51);
    if (wet.length && (sum >= 0.1 || wet.some((c) => c >= 95))) return wet.reduce((a, b) => (sev(b) > sev(a) ? b : a));
    const dry = codes.filter((c) => c < 51);
    if (!dry.length) return 3;
    const cnt = {};
    dry.forEach((c) => { cnt[c] = (cnt[c] || 0) + 1; });
    return Number(Object.keys(cnt).reduce((a, b) => (cnt[b] > cnt[a] ? b : a)));
  }

  function segRain(sum, code) {
    if (code >= 95) return 'storm';
    if (sum < 0.1) return 'dry';
    if (sum < 2) return 'light';
    if (sum < 6) return 'mid';
    return 'heavy';
  }

  function daySegments(d, byDay, date) {
    const h = d.hourly;
    const nowMs = localNowMs(d);
    return SEGS.map(([from, to]) => {
      const label = `${(from + 24) % 24}–${to % 24} Uhr`;
      const pick = [];
      for (let hh = from; hh < to; hh++) {
        const arr = byDay.get(addDays(date, hh < 0 ? -1 : hh >= 24 ? 1 : 0));
        const idx = arr && arr.find((i) => Number(h.time[i].slice(11, 13)) === (hh + 24) % 24);
        if (idx !== undefined) pick.push(idx);
      }
      if (!pick.length) return { label, empty: true };
      const vals = (arr) => pick.map((i) => arr?.[i]).filter(num);
      const mm = vals(h.precipitation).reduce((a, b) => a + b, 0);
      const pp = vals(h.precipitation_probability);
      const g = vals(h.wind_gusts_10m);
      const code = repCode(vals(h.weather_code), mm);
      const mid = pick[Math.floor(pick.length / 2)];
      return {
        label, mm, code,
        temp: avg(vals(h.temperature_2m)), wind: avg(vals(h.wind_speed_10m)),
        pp: pp.length ? Math.max(...pp) : undefined, gust: g.length ? Math.max(...g) : undefined,
        isDay: h.is_day?.[mid] ?? 1, cls: segRain(mm, code),
        past: tMs(h.time[pick[pick.length - 1]]) + 3600000 <= nowMs,
      };
    });
  }

  function segHtml(s) {
    if (s.empty) return `<div class="seg"><span class="s-name">${s.label}</span></div>`;
    return `<div class="seg${s.past ? ' past' : ''}"><i class="sbar ${s.cls}"></i>
      <span class="s-name">${s.label}</span>
      <span class="s-ico">${iconSvg(s.code, s.isDay)}</span>
      <span class="s-temp">${deg(s.temp)}</span>
      <span class="s-rain">${ppHtml(s.pp)}</span>
      <span class="s-mm">${s.mm >= 0.1 ? nf1.format(s.mm) + ' mm' : ''}</span>
      <span class="s-wind">${ui('wind')}${windStr(s.wind, s.gust)}</span>
    </div>`;
  }

  // Sonnenstunden pro Tag, "Sonne ohne Wolken davor". Pro Stunde zählt der kleinere Wert aus
  //  a) Sonnenschein laut Strahlungsmodell (sunshine_duration, begrenzt auf Tageslicht und Sonnenstand) und
  //  b) wolkenfreiem Anteil des Himmels (aus der Gesamtbewölkung, siehe SUN_CLOUD_MIN/MAX).
  // Nur sunshine_duration (Strahlung > 120 W/m²) zählt auch dünne Wolken und Dunst als Sonne und liegt bei grauem Himmel zu hoch.
  function daySunHours(d, idxs) {
    const h = d.hourly;
    if (!h || !h.sunshine_duration || !h.cloud_cover || !idxs.length) return undefined;
    let sum = 0, any = false;
    idxs.forEach((i) => {
      const sec = h.sunshine_duration[i], cc = h.cloud_cover[i];
      if (!num(sec) || !num(cc)) return;
      any = true;
      const clear = Math.min(1, Math.max(0, (SUN_CLOUD_MAX - cc) / (SUN_CLOUD_MAX - SUN_CLOUD_MIN)));
      sum += Math.min(sec / 3600, clear);
    });
    return any ? sum : undefined;
  }

  function sunHtml(hours) {
    if (!num(hours)) return '';
    const r = Math.round(hours * 2) / 2; // auf halbe Stunden
    return `<span class="d-sun" title="Sonne ohne dichte Wolken davor: ca. ${nf1.format(hours)} Stunden">${ui('sun')}${nf1.format(r)} h</span>`;
  }

  function renderDaily(d) {
    const D = d.daily;
    const start = dailyStart(d);
    if (!D || start < 0) { el.daily.innerHTML = ''; return; }
    const byDay = new Map();
    (d.hourly?.time || []).forEach((t, i) => {
      const k = t.slice(0, 10);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(i);
    });
    const total = D.time.length - start;
    const shown = Math.min(state.days, total);
    const mins = D.temperature_2m_min.slice(start).filter(num);
    const maxs = D.temperature_2m_max.slice(start).filter(num);
    const gmin = Math.min(...mins), gmax = Math.max(...maxs);
    const span = Math.max(gmax - gmin, 1);
    let html = '';
    for (let r = 0; r < shown; r++) {
      const i = start + r;
      const date = D.time[i];
      const idxs = byDay.get(date) || [];
      const lo = D.temperature_2m_min[i], hi = D.temperature_2m_max[i];
      const left = num(lo) ? ((lo - gmin) / span) * 100 : 0;
      const width = num(lo) && num(hi) ? Math.max(((hi - lo) / span) * 100, 4) : 0;
      const pp = D.precipitation_probability_max?.[i];
      const sum = D.precipitation_sum?.[i];
      const wAvg = idxs.length ? avg(idxs.map((k) => d.hourly.wind_speed_10m?.[k]).filter(num)) : D.wind_speed_10m_max?.[i];
      const trend = r >= 7;
      const open = state.open.has(date) && idxs.length > 0;
      if (r === 7) html += '<div class="d-note">Ab hier eher Trend als genaue Vorhersage</div>';
      html += `<div class="day${open ? ' open' : ''}">
        <button class="drow${trend ? ' trend' : ''}" type="button" data-date="${date}" aria-expanded="${open}">
          <span class="d-day"><b>${r === 0 ? 'Heute' : weekday(date)}</b><small>${date.slice(8, 10)}.${date.slice(5, 7)}.</small></span>
          <span class="d-ico"><span class="d-wi">${iconSvg(D.weather_code[i], 1)}</span>${sunHtml(daySunHours(d, idxs))}</span>
          <span class="d-temp"><span class="lo">${deg(lo)}</span><span class="bar"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></i></span><span class="hi">${deg(hi)}</span></span>
          <span class="d-rain"><span>${ppHtml(pp)}</span>${num(sum) && sum >= 0.1 ? `<small>${nf1.format(sum)} mm</small>` : ''}</span>
          <span class="d-gust">${ui('wind')}${windStr(wAvg, D.wind_gusts_10m_max?.[i])}</span>
          <span class="d-chev">${ui('chevron')}</span>
        </button>
        ${open ? `<div class="dsegs">${daySegments(d, byDay, date).map(segHtml).join('')}</div>` : ''}
      </div>`;
    }
    el.daily.innerHTML = html;
    el.toggleDays.hidden = total <= 7;
    el.toggleDays.textContent = state.days > 7 ? 'Nur 7 Tage anzeigen' : '14 Tage anzeigen';
  }

  function renderAll() {
    const d = state.data;
    el.main.classList.toggle('empty', !d);
    renderPlace();
    renderStatus();
    if (!d) return;
    applyTheme(d.current?.weather_code, isDayNow(d));
    renderNow(d);
    renderHourly(d);
    renderRain(d);
    renderDaily(d);
  }

  /* ------------------------------------------------------------------ */
  /* Laden                                                               */
  /* ------------------------------------------------------------------ */
  async function load(place, { force = false } = {}) {
    state.place = place;
    const same = state.dataPlace && km(state.dataPlace, place) < SAME_PLACE_KM;
    if (!same) { state.data = null; state.dataPlace = null; state.fetchedAt = 0; }

    if (state.inflight && km(state.inflight.place, place) < SAME_PLACE_KM) { renderAll(); return; }
    if (!force && same && state.data && Date.now() - state.fetchedAt < 60000) { renderAll(); return; }

    const id = ++state.reqId;
    state.inflight = { id, place };
    state.status = 'loading';
    renderAll();
    try {
      const data = await fetchForecast(place);
      if (id !== state.reqId) return;
      state.data = data;
      state.dataPlace = { lat: place.lat, lon: place.lon };
      state.fetchedAt = Date.now();
      state.status = 'ok';
      saveJSON(KEY_CACHE, { ts: state.fetchedAt, place: state.dataPlace, data });
    } catch (e) {
      if (id !== state.reqId) return;
      console.warn('Vorhersage konnte nicht geladen werden:', e);
      state.status = 'error';
    } finally {
      if (state.inflight && state.inflight.id === id) state.inflight = null;
    }
    renderAll();
  }

  const refresh = () => load(state.place || DEFAULT_PLACE, { force: true });

  function setPlace(place, { save = true } = {}) {
    if (save) saveJSON(KEY_PLACE, place);
    state.note = '';
    return load(place, { force: true });
  }

  /* ------------------------------------------------------------------ */
  /* Standort                                                            */
  /* ------------------------------------------------------------------ */
  function geoFail(userInitiated, err) {
    el.locate.classList.remove('busy');
    const p = state.place || DEFAULT_PLACE;
    if (err && err.code === 1) state.note = `Standortfreigabe fehlt – zeige ${p.name}.`;
    else state.note = `Standort nicht verfügbar – zeige ${p.name}.`;
    renderPlace();
  }

  async function onGeo(pos) {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    el.locate.classList.remove('busy');
    const prev = state.place;
    const reuse = prev && prev.geo && km(prev, { lat, lon }) < SAME_PLACE_KM;
    const place = { name: reuse ? prev.name : 'Mein Standort', sub: reuse ? prev.sub : '', lat, lon, geo: true };
    await setPlace(place);
    if (!reuse) {
      const r = await reverseGeocode(lat, lon);
      if (r && state.place && state.place.geo && state.place.lat === lat && state.place.lon === lon) {
        state.place = { ...state.place, name: r.name, sub: r.sub };
        saveJSON(KEY_PLACE, state.place);
        renderPlace();
      }
    }
  }

  function locate(userInitiated) {
    if (!('geolocation' in navigator)) { geoFail(userInitiated, null); return; }
    el.locate.classList.add('busy');
    navigator.geolocation.getCurrentPosition(onGeo, (err) => geoFail(userInitiated, err),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  /* ------------------------------------------------------------------ */
  /* Suche                                                               */
  /* ------------------------------------------------------------------ */
  let searchTimer = 0, searchCtl = null, lastResults = [];

  const clean = (s) => (s || '').replace(/^(Stadt|Landkreis|Kreis|Regierungsbezirk|Gemeinde)\s+/i, '');
  function subOf(r) {
    const parts = [clean(r.admin3) || clean(r.admin2), r.admin1];
    if (r.country_code && r.country_code !== 'DE') parts.push(r.country);
    return [...new Set(parts.filter((p) => p && p !== r.name))].join(', ');
  }

  function hideResults() { el.results.hidden = true; el.results.innerHTML = ''; lastResults = []; }

  function showResults(list) {
    lastResults = list;
    el.results.hidden = false;
    el.results.innerHTML = list.length
      ? list.map((r, i) => `<li data-i="${i}" tabindex="0"><span class="r-name">${esc(r.name)}</span><span class="r-sub">${esc(subOf(r))}</span></li>`).join('')
      : '<li class="none">Keine Treffer</li>';
  }

  async function search(q) {
    if (searchCtl) searchCtl.abort();
    searchCtl = new AbortController();
    try {
      const u = `${API_GEOCODE}?name=${encodeURIComponent(q)}&count=6&language=de&format=json`;
      const r = await fetch(u, { signal: searchCtl.signal });
      const j = await r.json();
      showResults(j.results || []);
    } catch (e) {
      if (e.name !== 'AbortError') { lastResults = []; el.results.hidden = false; el.results.innerHTML = '<li class="none">Suche nicht erreichbar</li>'; }
    }
  }

  function pick(i) {
    const r = lastResults[i];
    if (!r) return;
    el.q.value = '';
    el.q.blur();
    hideResults();
    setPlace({ name: r.name, sub: subOf(r), lat: r.latitude, lon: r.longitude, geo: false });
  }

  el.q.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const v = el.q.value.trim();
    if (v.length < 2) { if (searchCtl) searchCtl.abort(); hideResults(); return; }
    searchTimer = setTimeout(() => search(v), 250);
  });
  el.q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (lastResults.length) pick(0); }
    if (e.key === 'Escape') { el.q.value = ''; hideResults(); }
  });
  el.results.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) pick(Number(li.dataset.i));
  });
  el.results.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const li = e.target.closest('li[data-i]'); if (li) pick(Number(li.dataset.i)); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) hideResults(); });

/* ------------------------------------------------------------------ */
  /* Eigene Scrollleiste für "Stündlich" (native Leisten lassen sich     */
  /* je nach Browser nicht abrunden)                                     */
  /* ------------------------------------------------------------------ */
  function updateHBar() {
    const w = el.hourly.clientWidth, sw = el.hourly.scrollWidth;
    if (sw <= w + 1) { el.hbar.classList.add('off'); return; }
    el.hbar.classList.remove('off');
    const bw = el.hbar.clientWidth;
    const tw = Math.max(40, (bw * w) / sw);
    const max = sw - w;
    const x = (el.hourly.scrollLeft / max) * (bw - tw);
    el.hthumb.style.width = tw + 'px';
    el.hthumb.style.transform = `translateX(${Math.max(0, x)}px)`;
  }

  let hdrag = null;
  const hMax = () => el.hourly.scrollWidth - el.hourly.clientWidth;
  el.hourly.addEventListener('scroll', updateHBar, { passive: true });
  window.addEventListener('resize', updateHBar);
  el.hthumb.addEventListener('pointerdown', (e) => {
    hdrag = { x: e.clientX, left: el.hourly.scrollLeft };
    el.hthumb.setPointerCapture(e.pointerId);
    el.hbar.classList.add('drag');
    e.preventDefault();
  });
  el.hthumb.addEventListener('pointermove', (e) => {
    if (!hdrag) return;
    const room = Math.max(1, el.hbar.clientWidth - el.hthumb.offsetWidth);
    el.hourly.scrollLeft = hdrag.left + ((e.clientX - hdrag.x) * hMax()) / room;
  });
  const hEnd = () => { hdrag = null; el.hbar.classList.remove('drag'); };
  el.hthumb.addEventListener('pointerup', hEnd);
  el.hthumb.addEventListener('pointercancel', hEnd);
  el.hbar.addEventListener('pointerdown', (e) => {
    if (e.target === el.hthumb) return;
    const r = el.hbar.getBoundingClientRect(), tw = el.hthumb.offsetWidth;
    const frac = (e.clientX - r.left - tw / 2) / Math.max(1, r.width - tw);
    el.hourly.scrollLeft = Math.min(1, Math.max(0, frac)) * hMax();
  });

  el.locate.addEventListener('click', () => locate(true));
  el.status.addEventListener('click', () => { if (state.status !== 'loading') refresh(); });
  el.daily.addEventListener('click', (e) => {
    const b = e.target.closest('.drow');
    if (!b || !state.data) return;
    const k = b.dataset.date;
    if (state.open.has(k)) state.open.delete(k); else state.open.add(k);
    renderDaily(state.data);
    const again = el.daily.querySelector(`.drow[data-date="${k}"]`);
    if (again) again.focus({ preventScroll: true });
  });
  el.toggleDays.addEventListener('click', () => {
    state.days = state.days > 7 ? 7 : 14;
    if (state.data) renderDaily(state.data);
  });

  /* ------------------------------------------------------------------ */
  /* Start und Aktualisierung                                            */
  /* ------------------------------------------------------------------ */
  function init() {
    const saved = loadJSON(KEY_PLACE);
    state.place = saved && num(saved.lat) && num(saved.lon) ? saved : DEFAULT_PLACE;

    // Zuletzt geladene Daten sofort zeigen, solange sie zum gespeicherten Ort passen
    const cache = loadJSON(KEY_CACHE);
    if (cache && cache.data && cache.place && km(cache.place, state.place) < SAME_PLACE_KM) {
      state.data = cache.data;
      state.dataPlace = cache.place;
      state.fetchedAt = cache.ts || 0;
    }
    renderAll();

    load(state.place, { force: true }); // sofort für den letzten Ort laden
    locate(false);                      // parallel den aktuellen Standort bestimmen
  }

  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - state.fetchedAt > REFRESH_MS) {
      if (state.place && state.place.geo) locate(false); else refresh();
    } else if (state.data) {
      renderAll(); // Zeitfenster (Regenleiste, stündlich) an die aktuelle Uhrzeit anpassen
    }
  });
  window.addEventListener('online', () => refresh());

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  init();
})();
