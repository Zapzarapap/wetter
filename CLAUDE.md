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
  (siehe unten), Stündlich (48 h, horizontal scrollbar),
  Regenleiste (2 h in 15-Minuten-Blöcken), Tage (7, umschaltbar auf 14; ab Tag 8 als "Trend" markiert).
- Wind wird überall als **Durchschnitt–Böen** in km/h angezeigt (z. B. 24–35). Tageswerte: Durchschnitt aller Stunden des Tages, Böen = Tagesmaximum.
- Aktuell-Karte: große, kräftige Temperatur mit "Gefühlt" daneben (Hoch/Tief ausdrücklich nicht gewünscht); Kacheln Wind (Ø–Böen),
  Luftfeuchte, UV, Regen heute, Sonnenauf-/-untergang. "Regen heute" zeigt Uhrzeiten (z. B. "14–16 Uhr", "bis 15 Uhr", "Trocken bis 24 Uhr"),
  nicht Wahrscheinlichkeit + Menge (war für Niklas aussagelos).
- Jeder Tag in der Vorhersage ist per Tippen aufklappbar: acht **gleich lange 3-Stunden-Blöcke** (4 x 2 Kacheln): Morgens 5–8, Vormittags 8–11,
  Mittags 11–14, Nachmittags 14–17, Abends 17–20, Spätabends 20–23, Nachts 23–2, Nachts 2–5 (die Nacht reicht in den Folgetag).
  Niklas steht ab ca. 5 Uhr auf, sein Mittag ist wirklich um 12, seine Nacht beginnt spätestens um 23 Uhr; Blöcke ungleicher Länge (z. B. 5–9, 9–12, 12–15 …)
  und 4-Stunden-Blöcke fand er unpassend. Zeiten stehen in der Konstante `SEGS` in `app.js`. Pro Kachel: Icon, Ø-Temperatur, Regenwahrscheinlichkeit (Max),
  Regenmenge (Summe), Wind. Farbbalken oben nach Regenmenge (Summe: <0,1 trocken, <1 hell, <3 mittel, sonst dunkel, Gewitter lila).
- Regenleiste komplett trocken: ruhige, halbtransparente Leiste (weder grell hell noch dunkel) mit Haken und "Kein Regen". Niederschlag in mm (1 mm = 1 Liter pro m²), Hinweis steht in der Legende.
- Stündlich hat eine **eigene** Scrollleiste (`#hbar`, per JavaScript, zieh- und antippbar, runde Pille); die native ist ausgeblendet,
  weil sich systemeigene Scrollleisten je nach Browser nicht abrunden lassen.
- Regenleiste: trocken (< 0,1 mm/15 min) = leer/transparent, leicht 0,1–0,5 = hellblau, mäßig 0,5–1,5 = mittelblau,
  stark > 1,5 = dunkelblau, Gewitter (Wettercode ≥ 95) = lila. Dazu ein Satz ("Trocken bis 09:30, dann Regen").
  Das "Wann kann ich raus?"-Fenster beurteilt Niklas selbst an der Leiste. 15-Minuten-Raster ist Modelldaten, kein echtes Radar.
  Die Datenfunktion `rainBlocks()` ist bewusst getrennt, falls später eine 5-Minuten-Quelle genutzt werden soll.
- Stufe "Tropfen" (Niklas: "vielleicht ein paar Tropfen in der Luft"): 15-Minuten-Block < 0,1 mm, aber Regenwahrscheinlichkeit der Stunde >= 50 %, Stunde mit >= 0,1 mm
  oder Niesel-/Leichtregen-Code. Blass-blau gepunktet; sind alle Blöcke trocken oder Tropfen, zeigt die ruhige Leiste "Kein Regen" bzw. "Höchstens ein paar Tropfen".
  Hintergrund: Open-Meteo speichert Niederschlag nur mit 0,1 mm Genauigkeit (nach eigenem Wissen, nicht an echten Daten geprüft), Werte < 0,1 kommen also nie an.
  Schwelle `DROPS_PP` und `DROPS_CODES` in `app.js`; erst nach echten Regentagen nachjustieren.
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
