# Wetter – private Wetterseite

Persönliche, möglichst simple Wetterseite für Niklas (Hombruch, Dortmund). Wird über GitHub Pages ausgeliefert
(`https://zapzarapap.github.io/wetter/`), meist am Handy genutzt. Kommunikation und Texte auf der Seite: Deutsch.

## Stack und Regeln
- Reines HTML, CSS und JavaScript. **Kein Framework, kein npm, kein Build-Schritt.** GitHub Pages liefert direkt aus `main` (`/ (root)`).
- Alle Pfade **relativ** (`style.css`, nicht `/style.css`), weil die Seite unter `/wetter/` liegt.
- Kein API-Key im Code (Repo ist öffentlich). Open-Meteo braucht keinen.
- Dateien: `index.html`, `style.css`, `app.js`, `sw.js` (Service Worker), `manifest.webmanifest`, `icons/`.

## Datenquellen
- Vorhersage: Open-Meteo `https://api.open-meteo.com/v1/forecast`, `timezone=auto`, km/h, mm.
  - `current`: Temperatur, gefühlte Temperatur, Luftfeuchte, Wettercode, Wind (`wind_speed_10m`), Böen, `is_day`
  - `hourly` (14 Tage ab 00:00 heute, nötig für die Tageszeiten-Ansicht; angezeigt werden 48 h ab jetzt): Temperatur, Regenwahrscheinlichkeit, Niederschlag, Wettercode, Wind, Böen, `is_day`, `uv_index`
  - `minutely_15` (`forecast_minutely_15=9`): Niederschlag, Wettercode
  - `daily` (`forecast_days=14`): Wettercode, min/max, Niederschlagssumme und -wahrscheinlichkeit, Böen, Sonnenauf-/-untergang, UV-Max, `wind_speed_10m_max` (nur Ersatz)
- Ortssuche: Open-Meteo Geocoding. Ortsname mit Stadtteil beim Standort: Nominatim (OpenStreetMap), Attribution steht im Footer.
- Zeiten der API sind lokale Zeiten des Ortes ohne Offset. `app.js` rechnet intern in "Ortszeit als UTC-Millisekunden" (`tMs`, `localNowMs`).

## Entscheidungen (mit Niklas abgestimmt)
- Inhalte von oben nach unten: Suchleiste (mit Fadenkreuz-Button für "Standort neu laden"), Ortsname + Stand, Aktuell
  (Temperatur, gefühlt, Böen, Luftfeuchte, UV, Sonnenauf-/-untergang), Stündlich (48 h, horizontal scrollbar),
  Regenleiste (2 h in 15-Minuten-Blöcken), Tage (7, umschaltbar auf 14; ab Tag 8 als "Trend" markiert).
- Wind wird überall als **Durchschnitt–Böen** in km/h angezeigt (z. B. 24–35). Tageswerte: Durchschnitt aller Stunden des Tages, Böen = Tagesmaximum.
- Aktuell-Karte: große, kräftige Temperatur; darunter Beschreibung sowie Gefühlt, Hoch, Tief; Kacheln Wind, Luftfeuchte, UV, Regen heute, Sonnenauf-/-untergang.
- Jeder Tag in der Vorhersage ist per Tippen aufklappbar (Nachts 0–6, Morgens 6–12, Mittags 12–18, Abends 18–24 Uhr): Icon, Ø-Temperatur,
  Regenwahrscheinlichkeit (Max), Regenmenge (Summe), Wind. Farbbalken oben pro Tageszeit nach Regenmenge (6-h-Summe: <0,1 trocken, <1 hell, <4 mittel, sonst dunkel, Gewitter lila).
- Regenleiste komplett trocken: helle, ruhige Leiste mit Haken und "Kein Regen" statt dunklem Kasten. Niederschlag in mm (1 mm = 1 Liter pro m²), Hinweis steht in der Legende.
- Scrollleiste der Stündlich-Ansicht ist abgerundet (`@supports selector(::-webkit-scrollbar)`, sonst Firefox-Variante; nicht mischen).
- Regenleiste: trocken (< 0,1 mm/15 min) = leer/transparent, leicht 0,1–0,5 = hellblau, mäßig 0,5–1,5 = mittelblau,
  stark > 1,5 = dunkelblau, Gewitter (Wettercode ≥ 95) = lila. Dazu ein Satz ("Trocken bis 09:30, dann Regen").
  Das "Wann kann ich raus?"-Fenster beurteilt Niklas selbst an der Leiste. 15-Minuten-Raster ist Modelldaten, kein echtes Radar.
  Die Datenfunktion `rainBlocks()` ist bewusst getrennt, falls später eine 5-Minuten-Quelle genutzt werden soll.
- Standort: beim Öffnen Geolocation; schlägt sie fehl, der zuletzt genutzte Ort (localStorage); gibt es keinen, **Hombruch (Dortmund)**.
- Hintergrund passt sich an Wettercode und Tageszeit an (kein separater Dark Mode, nachts dunkel). Farben in `THEMES` in `app.js`.
- Aktualisierung beim Öffnen und alle 15 Minuten, solange die Seite offen ist. PWA: installierbar, letzte Daten werden sofort
  mit "Stand HH:MM" gezeigt (localStorage), Service Worker cached nur die App-Dateien (Netzwerk zuerst, nach 2,5 s Cache).
- Mobile-first, getestet bis 320 px Breite. Keine festen Pixelbreiten für Inhalte, `min-width: 0` in Grid/Flex, Spalte auf 560 px begrenzt.
- Alte Wetterseite von Niklas bleibt online, bis diese hier besser ist.

## Testen
- Die Entwicklungsumgebung von Claude erreicht Open-Meteo nicht. Getestet wurde mit headless Chromium (Playwright) und
  simulierten API-Antworten (320 px, 390 px, Desktop; Themes; Fehlerfälle; Offline).
- **Noch nicht gegen die echte API geprüft:** ob `minutely_15` den `weather_code` liefert (sonst greift der stündliche Code als Ersatz)
  und ob `forecast_minutely_15` wie erwartet ab dem aktuellen Viertelstunden-Slot beginnt. Bei Auffälligkeiten zuerst dort schauen.

## Ideen für später (nicht beauftragt)
- Regenleiste mit 5-Minuten-Quelle (z. B. DWD-Radar über Bright Sky), falls 15 Minuten nicht reichen.
- Schwellenwerte der Regenfarben nach Gefühl nachjustieren.
