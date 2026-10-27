# Wetter – private Wetterseite

Persönliche, möglichst simple Wetterseite für Niklas (Hombruch, Dortmund). Wird über GitHub Pages ausgeliefert
(`https://zapzarapap.github.io/wetter/`), meist am Handy genutzt. Kommunikation und Texte auf der Seite: Deutsch.

## Stack und Regeln
- Reines HTML, CSS und JavaScript. **Kein Framework, kein npm, kein Build-Schritt.** GitHub Pages liefert direkt aus `main` (`/ (root)`).
- Alle Pfade **relativ** (`style.css`, nicht `/style.css`), weil die Seite unter `/wetter/` liegt.
- Kein API-Key im Code (Repo ist öffentlich). Open-Meteo braucht keinen.
- Dateien: `index.html`, `style.css`, `app.js`, `radarmap.js` (Radar-Karte), `sw.js` (Service Worker), `manifest.webmanifest`, `icons/`, `vendor/leaflet/` (Leaflet 1.9.4, BSD-2, unverändert hineinkopiert, kein npm im Projekt).

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
  Regenleiste (2 h in 15-Minuten-Blöcken), Tage (7, umschaltbar auf 14; ab Tag 8 als "Trend" markiert), Radar-Karte (ganz unten, nur Deutschland und Umgebung).
- Wind wird überall als **Durchschnitt–Böen** in km/h angezeigt (z. B. 24–35). Tageswerte: Durchschnitt aller Stunden des Tages, Böen = Tagesmaximum.
- Aktuell-Karte: bewusst **kompakt** (erste Überarbeitung mit 2-Spalten-Raster war Niklas "viel zu groß", "keine Excel-Tabelle"): links große Temperatur + Status ("Bedeckt · Gefühlt 9°"),
  rechts das Icon, darunter eine einzige Zeile mit vier zentrierten Werten, jeweils Icon über dem Wert (ohne Text): Wind (Ø–Böen), UV, Sonnenaufgang, Sonnenuntergang. Hoch/Tief nicht gewünscht. Luftfeuchte und "Regen heute" sind
  vorerst raus (`rainTodayHtml()` bleibt im Code, ungenutzt).
- Jeder Tag in der Vorhersage ist per Tippen aufklappbar: **drei Blöcke à 8 Stunden, nur mit Uhrzeit, ohne Namen** (Niklas' Wunsch): 22–6, 6–14, 14–22 Uhr
  (eine Reihe, 3 Kacheln). Der Nachtblock 22–6 ist die Nacht, die in diesen Morgen hineinläuft (Vortag 22 Uhr bis 6 Uhr). Zuvor probiert und verworfen:
  Blöcke mit Namen (4/6/8 Stück, ungleich lange und 3-/4-Stunden-Raster). Zeiten stehen in der Konstante `SEGS` in `app.js`. Pro Kachel: Icon, Ø-Temperatur,
  Regenwahrscheinlichkeit (Max), Regenmenge (Summe), Wind. Farbbalken oben nach Regenmenge (Summe über 8 h: <0,1 trocken, <2 hell, <6 mittel, sonst dunkel, Gewitter lila).
- Sonnenstunden pro Tag (gelb, unter dem Wetter-Icon in der Tageszeile, auf 0,5 h gerundet) bedeuten für Niklas **"Sonne ohne Wolken davor"**: Sonne über oder hinter
  Wolken oder Dunst zählt nicht. Erste Version mit Open-Meteo `daily=sunshine_duration` allein (Strahlung > 120 W/m², WMO) zeigte an einem grauen Tag 8 h – zu hoch,
  weil auch dünne Wolken noch genug direkte Strahlung durchlassen. Jetzt pro Stunde `min(sunshine_duration/3600, wolkenfreier Anteil)`, Anteil aus `cloud_cover`
  (<= 15 % = 1, >= 85 % = 0, dazwischen linear), summiert über den Tag (`daySunHours()`, Schwellen `SUN_CLOUD_MIN/MAX`). Beide stündlichen Variablen sind optional
  (bei HTTP 400 wird ohne sie neu abgefragt, dann fehlt die Anzeige). Modellwert, ab Tag 8 nur Trend; ist das Bewölkungsmodell selbst falsch (z. B. Hochnebel), hilft das nicht.
- Unwetterwarnungen (DWD über Bright Sky `https://api.brightsky.dev/alerts?lat=&lon=`, Niklas wollte sie "clean, nur wenn eine da ist"): schmale Streifen unter dem Ortsnamen, nur ab
  Stufe `moderate` (markantes Wetter; `minor`/gelb bleibt weg), nur aktive oder in den nächsten 24 h beginnende, max. 3, gleiche Ereignisse zusammengefasst, Tippen klappt die Beschreibung auf.
  Optional und nicht blockierend (`loadAlerts()`), bei Fehler oder ohne Warnung ist nichts zu sehen. Nur Deutschland. **Nicht gegen die echte API geprüft** (Feldnamen `severity`, `event_de`,
  `onset`, `expires`, `description_de`, `instruction_de` und CORS aus eigenem Wissen).
- Regenwahrscheinlichkeit (Stündlich, Tage, 8-h-Kacheln) wird erst ab 20 % angezeigt (`PP_MIN`, `ppHtml()`), darunter steht nichts (= trocken), darüber auf 10 % gerundet.
  Hintergrund: Open-Meteo-Wert = Chance auf >= 0,1 mm in der Stunde, Tageswert = Maximum über die Stunden, also keine "Chance, dass es heute regnet". Werte wie 2 % oder 10 % verwirren nur.
- **Radar (27.10., Niklas: "so genau wie möglich", nur kostenlos):**
  - *Regenleiste* (`loadRadar()`, `radarMm()` in `app.js`): in Deutschland und Umgebung (`inRadarArea`) kommen die 15-Minuten-Blöcke aus Bright Sky `/radar` (DWD RV, 1 km, 5 min, bis +2 h;
    `lat`, `lon`, `distance=3000`, `format=plain`, `date`/`last_date` explizit gesetzt; Wert 0,01 mm pro 5 min). Pro Bild Wert genau am Punkt (gewichtete Mischung der vier Nachbar-Pixel nach `latlon_position`, 1 km ist die Grenze der Daten; vorher 3 x 3 km, Niklas: zu grob), pro Block Summe aus drei 5-Minuten-Bildern.
    Klassen wie gehabt (<0,1 trocken, ...), neu: Radar-Summe 0,02 bis 0,1 mm = "Tropfen" (`RADAR_DROPS_MM`); Gewitter (lila) weiter nur über den Modell-Wettercode. Überschrift der Karte zeigt
    "Radar", "Modell" oder "Radar + Modell". Radar wird alle 5 min neu geholt; bei Fehler, zu wenigen oder veralteten Bildern (> 20 min) gilt automatisch wieder Open-Meteo.
  - *Karte* (`radarmap.js`): Leaflet, Kartenbild Esri "Gray Canvas" Light (tags) / Dark (nachts), Ortsnamen als Esri-"Reference"-Schicht in eigener Pane ÜBER dem Radar (Orientierung bei kleinem Ausschnitt).
    **CARTO (vorher) scheidet aus: verlangt seit 2025/26 einen API-Key** ("API KEY REQUIRED"-Wasserzeichen); Esri-Tiles laufen ohne Key (geprüft von Dritten 10/2026, Esri-Legacy-Dienst, Terms sichern keyless-Nutzung formal nicht zu).
    Start-Zoom 10,5 (Niklas 27.10. abends: erst 8 war zu weit, 12,5 zu nah, "2 Stufen weiter raus"), minZoom 7, maxZoom 15, kein Hinweistext (Niklas: kann weg). Radar als WMS-Schicht `dwd:Niederschlagsradar` von `https://maps.dwd.de/geoserver/dwd/wms` (WMS 1.1.1, `exceptions=se_blank`, Parameter `time`).
    Zeitbereich aus GetCapabilities (virtueller Dienst `.../dwd/Niederschlagsradar/wms`, `Extent`/`Dimension` `time`), sonst selbst geschätzt. 16 Zeitbilder im 10-Minuten-Takt (30 min zurück bis 2 h voraus; **Zeiten müssen genau auf dem Raster des DWD liegen, sonst leeres Bild** – Quelle: Fremdprojekt, das den Dienst live getestet hat; Raster wird aus der Periode der Capabilities abgeleitet, im Ersatzfall auf volle Zehnerminuten abgerundet),
    pro Bild eine eigene Schicht mit 512-px-Kacheln (`tileSize: 512, zoomOffset: -1`, ca. 4x weniger Anfragen), zuerst nur das sichtbare Bild, die übrigen danach je 2 gleichzeitig nacheinander (`fill()`, erst kommende, dann vergangene; nach Verschieben/Zoomen wieder nur das sichtbare Bild, `onMoved()`). Abspielen schaltet nur die Sichtbarkeit um und überspringt noch nicht geladene Bilder; Label zeigt "lädt …" bzw. "nicht verfügbar" (Diagnose: Tile-Fehler pro Bild). Vorher (19 Schichten à 256 px, alle auf einmal) lud es am Handy 10-15 s. Karte wird erst gebaut, wenn sie nahe am Bildschirm ist (`IntersectionObserver`). Am Handy bewegen/zoomen zwei Finger
    (ein Finger scrollt die Seite), am Desktop Mausrad erst nach Klick. Panes: Karte (200) < Radar (250) < Ortsnamen (350). Kartenrand: `clip-path` + Maske (iOS ignoriert `border-radius` bei transformierten Kindern sonst). **Weiche Radarflächen** (Niklas wollte "Ecken abrunden, mehr wie Regenwolken", gemeint sind die kantigen 1-km-Pixel): CSS-`blur` auf der Radar-Pane, Stärke ca. 0,3 Pixel-Größe von 1 km, begrenzt 0,6 bis 7 px, wird bei jedem Zoom neu gesetzt (`softenRadar()`), läuft auf der GPU; zusätzlich WMS-Zusatzparameter `interpolations=Bilinear` (GeoServer, unbekannt ob der DWD ihn auswertet, schadet nicht). **Farben**: Die Radarfarben sind der feste DWD-Stil (15 Klassen von 0,1 bis 150+ mm/h, eigene SLD-Styles lehnt der Dienst laut Fremdprojekt ab); Umfärben ginge nur per Pixelverarbeitung im Browser (braucht CORS, ungeklärt, kostet Rechenzeit) oder CSS-Filter (nur grobe Farbverschiebung, keine feste Palette) – bewusst nicht gemacht. Stattdessen aufklappbare Legende mit dem GetLegendGraphic-Bild des DWD (lädt erst beim Aufklappen, bei Fehler ausgeblendet), angefragt transparent, mit weißer Schrift und waagerecht (`legend_options`), gerahmt wie die übrigen Elemente; ungeprüft, wie der DWD-Server es tatsächlich liefert. Attribution: Esri, OSM und "Radar: Deutscher Wetterdienst" in Karte und Footer. WetterOnline-Karte bewusst NICHT nachgebaut/gescrapt (fremdes Produkt, Repo ist öffentlich).
  - Regensatz über der Leiste nennt Tropfen nach dem Regen mit ("..., danach trocken, vielleicht noch ein paar Tropfen"), damit Satz und gepunktete Blöcke zusammenpassen. `RADAR_DROPS_MM` (0,02 mm pro 15 min) ist ungeprüft; wirken die Tropfen zu oft, Wert erhöhen.
  - **Nicht gegen die echten Dienste geprüft** (Entwicklungsumgebung erreicht sie nicht): Bright-Sky-Antwortformat/CORS, Zeitformat und Verfügbarkeit des WMS, ob die Ebene `EPSG:3857` und `time` so akzeptiert.
    Bei Auffälligkeiten zuerst die Konsole des Browsers lesen (Meldungen beginnen mit "Radar").
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
- Hintergrund der Radar-Wahl (Recherche 27.10., nur aus Dokus und Projekten Dritter):
  - Aktuell nutzt die Regenleiste Open-Meteo `minutely_15`; für Mitteleuropa laut Open-Meteo nativ aus DWD ICON-D2 (2 km, kein reines Interpolat).
  - **DWD-WMS** `https://maps.dwd.de/geoserver/dwd/wms`, Layer `dwd:Niederschlagsradar` (= RV-Produkt, 1 km, 5 min, -2 h bis +2 h, 49 Bilder, Vorhersage im selben Layer über Zeitparameter),
    ohne Key, Lizenz GeoNutzV / CC BY 4.0, Quellenangabe "Quelle: Deutscher Wetterdienst". Kartenbilder (Leaflet-WMS-Overlay) brauchen kein CORS. Offen: genaues Zeitformat (GetCapabilities),
    ob `GetFeatureInfo` (Wert am Punkt) per Browser-`fetch` erlaubt ist (CORS).
  - **Bright Sky `/radar`**: gleiche DWD-RV-Daten als Zahlenwerte für einen Punkt (`lat`, `lon`, `distance`, `format=plain`, 0,01 mm pro 5 min, bis +120 min). CORS ungeprüft. Die Zahlen eignen sich für die Regenleiste.
  - **RainViewer** ungeeignet: seit 1.1.2026 keine Vorhersage mehr, nur 2 h Rückblick in 10-Minuten-Schritten, max. Zoom 7, 100 Anfragen/min je IP.
  - Dienste mit Key (OpenWeatherMap, Pirate Weather, Tomorrow.io u. a.) scheiden aus, weil das Repo öffentlich ist.
- Schwellenwerte der Regenfarben nach Gefühl nachjustieren.
