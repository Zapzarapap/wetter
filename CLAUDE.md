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
  - `hourly` (14 Tage ab 00:00 heute, nötig für die Tageszeiten-Ansicht und Sonnenstunden; angezeigt werden 48 h ab jetzt): Temperatur, Regenwahrscheinlichkeit, Niederschlag, Wettercode, Wind, Böen, `is_day`, `uv_index`, `cloud_cover`, `sunshine_duration`
  - `minutely_15` (`forecast_minutely_15=9`): Niederschlag, Wettercode
  - `daily` (`forecast_days=14`): Wettercode, min/max, Niederschlagssumme und -wahrscheinlichkeit, Böen, Sonnenauf-/-untergang, UV-Max, `wind_speed_10m_max` (nur Ersatz)
- Ortssuche: Open-Meteo Geocoding. Ortsname mit Stadtteil beim Standort: Nominatim (OpenStreetMap), Attribution steht im Footer.
- Zeiten der API sind lokale Zeiten des Ortes ohne Offset. `app.js` rechnet intern in "Ortszeit als UTC-Millisekunden" (`tMs`, `localNowMs`).

## Entscheidungen (mit Niklas abgestimmt)
- Inhalte von oben nach unten: Suchleiste (mit Fadenkreuz-Button für "Standort neu laden"), Ortsname + Stand, Aktuell
  (siehe unten), Stündlich (48 h, horizontal scrollbar),
  Regenleiste (2 h in 15-Minuten-Blöcken), Tage (7, umschaltbar auf 14; ab Tag 8 als "Trend" markiert).
- Wind wird überall als **Durchschnitt–Böen** in km/h angezeigt (z. B. 24–35). Tageswerte: Durchschnitt aller Stunden des Tages, Böen = Tagesmaximum.
- Aktuell-Karte: bewusst **kompakt** (erste Überarbeitung mit 2-Spalten-Raster war Niklas "viel zu groß", "keine Excel-Tabelle"): links große Temperatur + Status ("Bedeckt · Gefühlt 9°"),
  rechts das Icon, darunter eine einzige Zeile mit vier Werten: Wind (Ø–Böen), UV, Sonnenaufgang, Sonnenuntergang. Hoch/Tief nicht gewünscht. Luftfeuchte und "Regen heute" sind
  vorerst raus (`rainTodayHtml()` bleibt im Code, ungenutzt). Rücksetzpunkt auf die Version vor den Layout-Änderungen: Commit f336fe2.
- Jeder Tag in der Vorhersage ist per Tippen aufklappbar: **drei Blöcke à 8 Stunden, nur mit Uhrzeit, ohne Namen** (Niklas' Wunsch): 22–6, 6–14, 14–22 Uhr
  (eine Reihe, 3 Kacheln). Der Nachtblock 22–6 ist die Nacht, die in diesen Morgen hineinläuft (Vortag 22 Uhr bis 6 Uhr). Zuvor probiert und verworfen:
  Blöcke mit Namen (4/6/8 Stück, ungleich lange und 3-/4-Stunden-Raster). Zeiten stehen in der Konstante `SEGS` in `app.js`. Pro Kachel: Icon, Ø-Temperatur,
  Regenwahrscheinlichkeit (Max), Regenmenge (Summe), Wind. Farbbalken oben nach Regenmenge (Summe über 8 h: <0,1 trocken, <2 hell, <6 mittel, sonst dunkel, Gewitter lila).
- Sonnenstunden pro Tag (gelb, unter dem Wetter-Icon in der Tageszeile, auf 0,5 h gerundet) bedeuten für Niklas **"Sonne ohne Wolken davor"**: Sonne über oder hinter
  Wolken oder Dunst zählt nicht. Erste Version mit Open-Meteo `daily=sunshine_duration` allein (Strahlung > 120 W/m², WMO) zeigte an einem grauen Tag 8 h – zu hoch,
  weil auch dünne Wolken noch genug direkte Strahlung durchlassen. Jetzt pro Stunde `min(sunshine_duration/3600, wolkenfreier Anteil)`, Anteil aus `cloud_cover`
  (<= 15 % = 1, >= 85 % = 0, dazwischen linear), summiert über den Tag (`daySunHours()`, Schwellen `SUN_CLOUD_MIN/MAX`). Beide stündlichen Variablen sind optional
  (bei HTTP 400 wird ohne sie neu abgefragt, dann fehlt die Anzeige). Modellwert, ab Tag 8 nur Trend; ist das Bewölkungsmodell selbst falsch (z. B. Hochnebel), hilft das nicht.
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
