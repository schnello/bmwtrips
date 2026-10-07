# Seraph · BMW iX1

Ein helles Dashboard für Fahrten und Ladevorgänge eines weißen BMW iX1. Der Aufbau entspricht der Tesla-Seite „Lilith“: Streckenauswahl, vier Statistiken, Tagesverbrauch, Fahrten und Ladungen nach Datum, Akkubalken, Routenkarte, Ladekurve und CSV-Export.

„Seraph“ verwendet weiße Flächen, blaue Akzente und ein goldenes Engelszeichen. Das Hintergrundbild zeigt den weißen iX1 direkt von vorne in einer hellen Wolkenlandschaft. Es wurde mit integrierter Bildgenerierung erstellt und ist kein Foto des konkreten Fahrzeugs.

## Dateien

```text
README.md
index.html                 Dashboard
trips.css                  Helles Erscheinungsbild
trips.js                   Datenabfragen, Ansichten und CSV-Export
assets/
  ix1-himmel.png            Hintergrund mit Frontansicht
  seraph.svg                Engelszeichen und Favicon
  leaflet/                  Kartenbibliothek einschließlich Lizenz
```

Die Seite ist statisches HTML, CSS und JavaScript. Es ist kein Build und keine npm-Installation erforderlich. Daten kommen aus dem vorhandenen BMW-Node-RED-Flow; der Browser erhält keine InfluxDB-Zugangsdaten. Dieses Repository enthält keine Fahrzeuglogs oder Beispieldaten.

## Installation

Kopiere `index.html`, `trips.css`, `trips.js` und den vollständigen Ordner `assets/` nach **`/var/www/bmwshare/`**. Die HTML-Datei muss direkt in diesem Verzeichnis liegen. README und Git-Verzeichnis werden für die Webseite nicht benötigt.

Im bestehenden HTTPS-VirtualHost für **`bmw.service-uplink.de`** werden die statischen Dateien aus diesem Verzeichnis ausgeliefert. Die BMW-Endpunkte werden an Node-RED weitergeleitet:

```apache
DocumentRoot /var/www/bmwshare
DirectoryIndex index.html

<Directory /var/www/bmwshare>
    Options -Indexes +FollowSymLinks
    AllowOverride None
    Require all granted
</Directory>

ProxyPreserveHost On
ProxyRequests Off

# Spezifische Routen stehen vor den kürzeren Listenrouten.
ProxyPass /api/bmw/trips/route http://192.168.1.101:1880/api/bmw/trips/route connectiontimeout=5 timeout=20
ProxyPassReverse /api/bmw/trips/route http://192.168.1.101:1880/api/bmw/trips/route
ProxyPass /api/bmw/trips http://192.168.1.101:1880/api/bmw/trips connectiontimeout=5 timeout=20
ProxyPassReverse /api/bmw/trips http://192.168.1.101:1880/api/bmw/trips
ProxyPass /api/bmw/charging/curve http://192.168.1.101:1880/api/bmw/charging/curve connectiontimeout=5 timeout=20
ProxyPassReverse /api/bmw/charging/curve http://192.168.1.101:1880/api/bmw/charging/curve
ProxyPass /api/bmw/charging http://192.168.1.101:1880/api/bmw/charging connectiontimeout=5 timeout=20
ProxyPassReverse /api/bmw/charging http://192.168.1.101:1880/api/bmw/charging
ProxyPass /api/bmw/status http://192.168.1.101:1880/api/bmw/status connectiontimeout=5 timeout=20
ProxyPassReverse /api/bmw/status http://192.168.1.101:1880/api/bmw/status
```

Diese Zeilen gehören in den bereits vorhandenen BMW-VirtualHost mit dessen SSL-Zertifikat. Falls dieser eine abschließende Sperrregel für unbekannte Pfade enthält, müssen vorher `index.html`, `trips.css`, `trips.js`, die verwendeten Dateien unter `assets/` und die fünf BMW-API-Pfade freigegeben sein. Der optionale Pfad `/trips` lässt sich im VirtualHost mit `RewriteRule ^/trips/?$ /index.html [END]` auf dieselbe Seite abbilden.

Module aktivieren und Konfiguration prüfen:

```bash
sudo a2enmod proxy proxy_http ssl
sudo apache2ctl configtest
```

Nach `Syntax OK`:

```bash
sudo systemctl reload apache2
```

Bei Verwendung der optionalen Rewrite-Regel zusätzlich `sudo a2enmod rewrite` ausführen. Das obige Beispiel übernimmt den öffentlich zugänglichen Betrieb der bisherigen BMW-Konfiguration; ein bestehender Zugriffsschutz muss sowohl Webseite als auch API umfassen.

Danach die Seite unter [bmw.service-uplink.de](https://bmw.service-uplink.de/) öffnen. Nach Dateiaustausch einmal mit `Strg + F5` neu laden.

## Benötigte BMW-API

Die APIs liegen auf derselben Domain wie die Seite. Sie müssen JSON liefern. Fahrten und Ladungen werden aus dem eigenen InfluxDB-Bucket **`bmw`** über den BMW-Flow bereitgestellt.

| Endpunkt | Antwort |
| --- | --- |
| `/api/bmw/trips?days=all` | `{ "trips": [...] }` |
| `/api/bmw/trips/route?trip_id=…` | `{ "points": [...] }` |
| `/api/bmw/charging?days=all` | `{ "charging_sessions": [...] }` |
| `/api/bmw/charging/curve?session_id=…` | `{ "points": [...] }` |
| `/api/bmw/status` | Letzter BMW-Zustand; zur Prüfung des Flows |

Die Historienseite verwendet die ersten vier Endpunkte. Status ist ein zusätzlicher Diagnose-Endpunkt des vorhandenen Flows.

Die Streckenauswahl nimmt vollständige Fahrten auf, bis die gewählte Strecke erreicht oder überschritten ist. „Aktualisieren“ fragt die Historie erneut ab. Die Seite aktualisiert sich nicht automatisch, damit geöffnete Karten und Ladekurven bestehen bleiben. CSV exportiert die ausgewählten Fahrten.

## Datenqualität

- Energie und Verbrauch sind aus Akkustandsänderung und gemeldeter Kapazität **geschätzt**. Fahrten ohne ausreichend aufgelösten Verbrauch zählen zur Strecke, aber nicht zum Verbrauchsmittel. Der Hinweis am Mittelwert zeigt die berücksichtigte Distanz.
- Unbekannte Werte erscheinen als **–** und bleiben im CSV leer. Fehlende Fahrtdauer wird nicht aus möglicherweise veralteten Zeitstempeln rekonstruiert.
- Bei Ladungen werden aktive Ladezeit und angeschlossene Zeit getrennt angezeigt. Mehrere Ladephasen gehören zur selben Anschlusskarte. Energie bezeichnet den geschätzten Zuwachs im Akku; Netzbezug wird nicht gemessen.
- Die Ladekurve verbindet nur Messpunkte derselben Phase mit höchstens 15 Minuten Abstand. Größere Lücken bleiben offen.
- Karten zeigen GPS-Punkte mit gestrichelter Verbindung, keine rekonstruierte Straßenroute. Kartenkacheln werden beim Öffnen einer Karte von OpenStreetMap geladen.

## Adressen: noch zu ergänzen

Der aktuelle BMW-Flow liefert Start- und Zielkoordinaten, aber noch keine aufgelösten Adressen. Deshalb zeigt die Seite zunächst GPS-Koordinaten. Die HTML-Ansicht unterstützt bereits dieselben Adressfelder wie Tesla:

```text
start_location_name, start_street, start_house_number, start_city, start_country
end_location_name, end_street, end_house_number, end_city, end_country
```

Für dieselbe Adressanzeige muss der BMW-Flow die Start- und Zielpositionen auflösen und diese Felder mit der Fahrt speichern. Diese Erweiterung ist in diesem Stand noch nicht enthalten.

## Prüfung

Die Webseite wurde lokal mit den separat vorhandenen BMW-Replay-Daten geprüft: acht Fahrten mit 94 km, ein Ladeanschluss mit zwei Phasen und 20 Leistungspunkten. Geprüft wurden Streckenauswahl, Karten, Ladekurve, CSV, fehlende Werte, leere Historie, API-Ausfall und Desktop- sowie Handyansicht.

Der Apache-Konfigurationstest und die echte Verbindung zum produktiven Node-RED- und InfluxDB-System müssen auf dem Server geprüft werden. Die Webseite importiert keine historischen Logdateien in die Datenbank.

## Kartenbibliothek

Leaflet 1.9.4 liegt lokal unter `assets/leaflet/`. Die zugehörige BSD-2-Clause-Lizenz befindet sich in [`assets/leaflet/LICENSE`](assets/leaflet/LICENSE).

Technische Referenzen: [Apache Reverse Proxy](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html), [Leaflet](https://leafletjs.com/reference.html).
