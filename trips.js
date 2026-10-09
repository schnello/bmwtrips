// Lucifer: BMW-Adaption der Tesla trips.html vom 07.10.2026.
// Keine Beispieldaten, kein Browser-Zugriff auf InfluxDB.
function isNumber(value) { return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function locationFor(trip,point) {
    const label=formatLocationName(trip[point+'_location_name'],trip[point+'_street'],trip[point+'_house_number'],trip[point+'_city'],trip[point+'_country']);
    if (label !== 'Unbekannt') return label;
    const coordinate=getTripCoordinates(trip,point);
    return coordinate ? 'GPS · '+formatNumber(coordinate.latitude,5)+' / '+formatNumber(coordinate.longitude,5) : 'Position nicht aufgezeichnet';
}
async function bmwFetch(url,options={}) {
    const response=await fetch(url,{...options,cache:'no-store',signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error('HTTP '+response.status);
    if (!(response.headers.get('content-type')||'').includes('application/json')) throw new Error('Antwort ist kein JSON');
    return response;
}


/*
 * ============================================================
 * DATENQUELLE
 * ============================================================
 */

const API_URL =
    "/api/bmw/trips";

const TRIP_ROUTE_API_URL =
    "/api/bmw/trips/route";

const CHARGING_API_URL =
    "/api/bmw/charging";

const CHARGING_CURVE_API_URL =
    "/api/bmw/charging/curve";


/*
 * ============================================================
 * STRECKE
 * ============================================================
 */

let selectedDistanceKm = 300;
let allHistoryPromise = null;
let selectedTripsForExport = [];


function getExportLocation(trip, point) {
    return locationFor(trip,point);
}


function formatCsvValue(value) {
    let normalized = value === null || value === undefined
        ? ""
        : String(value);

    if (/^[=+@\-\t\r]/.test(normalized)) normalized="'"+normalized;
    return `"${normalized.replace(/"/g, '""')}"`;
}


function updateTripExport(trips) {
    selectedTripsForExport = Array.isArray(trips) ? trips : [];
    document.getElementById("exportTripsButton").disabled =
        selectedTripsForExport.length === 0;
}


function exportSelectedTrips() {
    if (selectedTripsForExport.length === 0) {
        return;
    }

    const headers = [
        "Startzeit",
        "Endzeit",
        "Dauer (Minuten)",
        "Distanz (km)",
        "Verbrauchte Energie (kWh)",
        "Verbrauch (kWh/100 km)",
        "Durchschnittsgeschwindigkeit (km/h)",
        "Batterie Start (%)",
        "Batterie Ende (%)",
        "Start",
        "Ziel",
        "Energie geschätzt",
        "Dauer geschätzt"
    ];

    const rows = selectedTripsForExport
        .slice()
        .sort((a, b) => getHistoryTimestamp(b) - getHistoryTimestamp(a))
        .map(trip => [
            trip.start_time,
            trip.end_time,
            isNumber(trip.duration_seconds) ? Number(trip.duration_seconds) / 60 : null,
            trip.distance_km,
            trip.consumed_kwh,
            trip.avg_kwh_100km,
            trip.avg_speed_kmh,
            trip.start_battery_pct,
            trip.end_battery_pct,
            getExportLocation(trip, "start"),
            getExportLocation(trip, "end"),
            true, true
        ].map(formatCsvValue).join(";"));

    const csv = [headers.map(formatCsvValue).join(";"), ...rows].join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `bmw-fahrten-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}


/*
 * ============================================================
 * ORTSNAMEN AUFBEREITEN
 * ============================================================
 *
 * Die Datenbank bleibt unverändert.
 *
 * Beispiel:
 *
 * Kopernikus-Straße, Oberhaus, Vöcklabruck,
 * Bezirk Vöcklabruck, Oberösterreich, 4840, Österreich
 *
 * wird angezeigt als:
 *
 * Kopernikus-Straße, Vöcklabruck, Österreich
 *
 */

function formatLocationName(name, street, houseNumber, city, country) {

    // ============================================================
    // 1. Bevorzugt: vollständige strukturierte Daten
    // ============================================================

    if (street && city) {

        const streetLine = [
            street,
            houseNumber
        ]
            .filter(Boolean)
            .join(" ");

        return [
            streetLine,
            city,
            country
        ]
            .filter(Boolean)
            .join(", ");
    }


    // ============================================================
    // 2. Fallback: vollständigen Nominatim-Namen auswerten
    //
    // Beispiel:
    // 20, Tiefenbach, Frankenburg am Hausruck,
    // Bezirk Vöcklabruck, Oberösterreich, 4871, Österreich
    //
    // wird zu:
    // Tiefenbach 20, Frankenburg am Hausruck, Österreich
    // ============================================================

    if (name) {

        const parts = String(name)
            .split(",")
            .map(part => part.trim())
            .filter(Boolean);

        if (parts.length >= 3) {

            let detectedHouseNumber = null;
            let detectedStreet = null;
            let detectedCity = null;
            let detectedCountry = null;


            // ----------------------------------------------------
            // Hausnummer
            // ----------------------------------------------------

            if (/^\d+[a-zA-Z]?$/.test(parts[0])) {
                detectedHouseNumber = parts[0];
            }


            // ----------------------------------------------------
            // Straße / Ortsteil
            // ----------------------------------------------------

            if (detectedHouseNumber && parts[1]) {
                detectedStreet = parts[1];
            }


            // ----------------------------------------------------
            // Ort
            // ----------------------------------------------------

            if (detectedHouseNumber && parts[2]) {
                detectedCity = parts[2];
            }


            // ----------------------------------------------------
            // Land = letzter Bestandteil
            // ----------------------------------------------------

            detectedCountry =
                parts[parts.length - 1];


            // ----------------------------------------------------
            // Ausgabe
            // ----------------------------------------------------

            if (detectedStreet && detectedCity) {

                const streetLine = [
                    detectedStreet,
                    detectedHouseNumber
                ]
                    .filter(Boolean)
                    .join(" ");

                return [
                    streetLine,
                    detectedCity,
                    detectedCountry
                ]
                    .filter(Boolean)
                    .join(", ");
            }
        }


        // Wenn der Nominatim-String nicht erkannt wird:
        // Original unverändert anzeigen
        return name;
    }


    // ============================================================
    // 3. Letzter Fallback
    // ============================================================

    const fallbackStreet = [
        street,
        houseNumber
    ]
        .filter(Boolean)
        .join(" ");

    const fallback = [
        fallbackStreet,
        city,
        country
    ]
        .filter(Boolean)
        .join(", ");

    return fallback || "Unbekannt";
}
/*
 * ============================================================
 * DATUM / ZEIT
 * ============================================================
 */

function formatDate(dateString) {

    const date =
        new Date(dateString);


    return date.toLocaleDateString(
        "de-AT",
        {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric"
        }
    );
}


function formatTime(dateString) {

    const date =
        new Date(dateString);


    return date.toLocaleTimeString(
        "de-AT",
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}


/*
 * ============================================================
 * DAUER
 * ============================================================
 */

function formatDuration(seconds) {
    if (!isNumber(seconds)) return "–";

    const minutes =
        Math.round(
            Number(seconds || 0) / 60
        );


    const hours =
        Math.floor(
            minutes / 60
        );


    const mins =
        minutes % 60;


    if (hours > 0) {

        return `${hours}h ${String(mins).padStart(2, "0")}min`;
    }


    return `${mins} min`;
}


/*
 * ============================================================
 * ZAHLEN
 * ============================================================
 */

function formatNumber(
    value,
    decimals = 1
) {
    if (!isNumber(value)) return "–";

    const number =
        Number(value);


    if (!Number.isFinite(number)) {

        return "–";
    }


    return number.toLocaleString(
        "de-AT",
        {
            minimumFractionDigits:
                decimals,

            maximumFractionDigits:
                decimals
        }
    );
}


function getTripCoordinates(trip, prefix) {
    const rawLatitude =
        trip[`${prefix}_latitude`] ??
        trip[`${prefix}_lat`] ??
        trip[`${prefix}_location_latitude`] ??
        trip[`${prefix}_location_lat`];

    const rawLongitude =
        trip[`${prefix}_longitude`] ??
        trip[`${prefix}_lon`] ??
        trip[`${prefix}_lng`] ??
        trip[`${prefix}_location_longitude`] ??
        trip[`${prefix}_location_lon`];

    if (rawLatitude === null || rawLatitude === undefined || rawLatitude === "" ||
        rawLongitude === null || rawLongitude === undefined || rawLongitude === "") {
        return null;
    }

    const latitude = Number(rawLatitude);
    const longitude = Number(rawLongitude);

    return Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 &&
        Math.abs(longitude) <= 180
            ? { latitude, longitude }
            : null;
}


function renderConsumptionTrend(trips) {
    const container = document.getElementById("consumptionTrend");
    const daily = new Map();

    trips.forEach(trip => {
        const date = new Date(trip.end_time || trip.start_time || 0);
        const distance = Number(trip.distance_km || 0);
        const energy = isNumber(trip.consumed_kwh) ? Number(trip.consumed_kwh) : NaN;

        if (!Number.isFinite(date.getTime()) || distance <= 0 || !Number.isFinite(energy) || energy < 0 || !isNumber(trip.avg_kwh_100km)) {
            return;
        }

        const key = date.toLocaleDateString("sv-SE");
        const current = daily.get(key) || { date, distance: 0, energy: 0 };
        current.distance += distance;
        current.energy += energy;
        daily.set(key, current);
    });

    const points = Array.from(daily.values())
        .sort((a, b) => a.date - b.date)
        .slice(-14)
        .map(point => ({
            ...point,
            consumption: (point.energy / point.distance) * 100
        }));

    if (points.length === 0) {
        container.innerHTML = `
            <div class="consumption-trend-header"><span>Verbrauch pro Tag · geschätzt</span><span>–</span></div>
            <div class="message">Keine Verbrauchsdaten vorhanden.</div>
        `;
        return;
    }

    const width = 760;
    const height = 130;
    const padding = { top: 12, right: 18, bottom: 24, left: 38 };
    const values = points.map(point => point.consumption);
    const minValue = Math.max(0, Math.floor(Math.min(...values) - 2));
    const maxValue = Math.ceil(Math.max(...values) + 2);
    const valueRange = Math.max(1, maxValue - minValue);
    const x = index => padding.left +
        (points.length === 1
            ? (width - padding.left - padding.right) / 2
            : index * (width - padding.left - padding.right) / (points.length - 1));
    const y = value => padding.top +
        (maxValue - value) * (height - padding.top - padding.bottom) / valueRange;
    const path = points.map((point, index) =>
        `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(point.consumption).toFixed(2)}`
    ).join(" ");
    const firstDate = points[0].date.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
    const lastDate = points[points.length - 1].date.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });

    container.innerHTML = `
        <div class="consumption-trend-header">
            <span>Verbrauch pro Tag · geschätzt</span>
            <span>${formatNumber(values[values.length - 1])} kWh / 100 km</span>
        </div>
        <svg class="consumption-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Verbrauchskurve der letzten Tage">
            <line class="consumption-chart-grid" x1="${padding.left}" y1="${y(maxValue)}" x2="${width - padding.right}" y2="${y(maxValue)}"></line>
            <line class="consumption-chart-grid" x1="${padding.left}" y1="${y(minValue)}" x2="${width - padding.right}" y2="${y(minValue)}"></line>
            <text class="consumption-chart-label" x="0" y="${y(maxValue) + 4}">${formatNumber(maxValue, 0)}</text>
            <text class="consumption-chart-label" x="0" y="${y(minValue) + 4}">${formatNumber(minValue, 0)}</text>
            <path class="consumption-chart-line" d="${path}"></path>
            ${points.map((point, index) => `
                <circle class="consumption-chart-dot" cx="${x(index)}" cy="${y(point.consumption)}" r="4">
                    <title>${point.date.toLocaleDateString("de-AT")}: ${formatNumber(point.consumption)} kWh / 100 km</title>
                </circle>
            `).join("")}
            <text class="consumption-chart-label" x="${padding.left}" y="${height - 3}">${firstDate}</text>
            <text class="consumption-chart-label" x="${width - padding.right}" y="${height - 3}" text-anchor="end">${lastDate}</text>
        </svg>
    `;
}


/*
 * ============================================================
 * TRIPS RENDERN
 * ============================================================
 */

function renderHistory(trips, chargingSessions, allTrips, allChargingSessions) {

    const container =
        document.getElementById(
            "tripContainer"
        );


    const safeTrips =
        Array.isArray(trips)
            ? trips
            : [];

    const safeChargingSessions =
        Array.isArray(chargingSessions)
            ? chargingSessions
            : [];


    // ========================================================
    // STATISTIK - weiterhin reine Fahrstatistik
    // ========================================================

    const totalDistance =
        safeTrips.reduce(
            (sum, trip) =>
                sum + Number(trip.distance_km || 0),
            0
        );

    const estimatedTrips = safeTrips.filter(trip => isNumber(trip.avg_kwh_100km) && isNumber(trip.consumed_kwh) && Number(trip.distance_km) > 0);
    const estimatedDistance = estimatedTrips.reduce((sum,t) => sum + Number(t.distance_km),0);
    const totalEnergy = estimatedTrips.reduce((sum,t) => sum + Number(t.consumed_kwh),0);
    const averageConsumption = estimatedDistance > 0 ? totalEnergy / estimatedDistance * 100 : null;
    document.getElementById('averageConsumption').title = estimatedDistance > 0
        ? 'Schätzung für ' + formatNumber(estimatedDistance) + ' von ' + formatNumber(totalDistance) + ' km; Fahrten ohne belastbaren Verbrauch fehlen im Mittel.'
        : 'Noch keine ausreichend aufgelösten Verbrauchswerte vorhanden.';

    const completeTrips = Array.isArray(allTrips) ? allTrips : safeTrips;
    const completeChargingSessions = Array.isArray(allChargingSessions)
        ? allChargingSessions
        : safeChargingSessions;

    const latestChargingTime =
        completeChargingSessions.reduce(
            (latest, session) => {
                const timestamp = new Date(
                    session.end_time ||
                    session.start_time ||
                    0
                ).getTime();

                return Number.isFinite(timestamp)
                    ? Math.max(latest, timestamp)
                    : latest;
            },
            0
        );

    const distanceSinceLastCharge =
        latestChargingTime > 0
            ? completeTrips.reduce(
                (sum, trip) => {
                    const tripTime = new Date(
                        trip.end_time ||
                        trip.start_time ||
                        0
                    ).getTime();

                    return Number.isFinite(tripTime) &&
                        tripTime > latestChargingTime
                            ? sum + Number(trip.distance_km || 0)
                            : sum;
                },
                0
            )
            : null;


    document.getElementById(
        "totalTrips"
    ).textContent =
        safeTrips.length;

    document.getElementById(
        "totalDistance"
    ).textContent =
        formatNumber(totalDistance);

    document.getElementById(
        "averageConsumption"
    ).textContent =
        formatNumber(averageConsumption);

    document.getElementById(
        "distanceSinceLastCharge"
    ).textContent =
        distanceSinceLastCharge === null
            ? "–"
            : formatNumber(distanceSinceLastCharge);

    renderConsumptionTrend(safeTrips);


    // ========================================================
    // TRIPS + LADEVORGÄNGE ZUSAMMENFÜHREN
    // ========================================================

    const history = [
        ...safeTrips.map(trip => ({
            history_type: "trip",
            sort_time:
                trip.end_time ||
                trip.start_time,
            data: trip
        })),

        ...safeChargingSessions.map(session => ({
            history_type: "charging",
            sort_time:
                session.end_time ||
                session.start_time,
            data: session
        }))
    ];


    history.sort(
        (a, b) =>
            new Date(b.sort_time || 0) -
            new Date(a.sort_time || 0)
    );


    if (history.length === 0) {

        container.innerHTML = `
            <div class="message">
                Keine Fahrten oder Ladevorgänge im gewählten Zeitraum vorhanden.
            </div>
        `;

        return;
    }


    // ========================================================
    // NACH TAGEN GRUPPIEREN
    // ========================================================

    const groups = {};

    history.forEach(item => {

        if (!item.sort_time) {
            return;
        }

        const key =
            new Date(item.sort_time)
                .toLocaleDateString("de-AT");

        if (!groups[key]) {
            groups[key] = [];
        }

        groups[key].push(item);
    });


    container.innerHTML = "";


    Object.values(groups).forEach(dayItems => {

        const section =
            document.createElement("section");

        section.className =
            "day";


        const title =
            document.createElement("div");

        title.className =
            "day-title";

        title.textContent =
            formatDate(
                dayItems[0].sort_time
            );

        section.appendChild(title);


        dayItems.forEach(item => {

            if (item.history_type === "charging") {

                section.appendChild(
                    createChargingCard(item.data)
                );

            } else {

                section.appendChild(
                    createTripCard(item.data)
                );
            }
        });


        container.appendChild(section);
    });
}


/*
 * ============================================================
 * TRIP CARD
 * ============================================================
 */

function createTripCard(trip) {

    const card =
        document.createElement(
            "article"
        );


    card.className =
        "trip";


    /*
     * Start-/Endzeit
     */

    const startDate =

        trip.start_time

            ? new Date(
                trip.start_time
            )

            : null;


    const endDate =

        trip.end_time

            ? new Date(
                trip.end_time
            )

            : null;


    /*
     * Dauer:
     *
     * Wenn duration_seconds aus der DB vorhanden ist,
     * verwenden wir diesen Wert.
     *
     * Dadurch funktioniert die Anzeige auch,
     * wenn alte Datensätze kein start_time besitzen.
     */

    const durationSeconds = isNumber(trip.duration_seconds) ? Number(trip.duration_seconds) : null;
    const batteryUsed = isNumber(trip.used_battery_pct) ? Number(trip.used_battery_pct)
        : isNumber(trip.start_battery_pct) && isNumber(trip.end_battery_pct)
            ? Number(trip.start_battery_pct) - Number(trip.end_battery_pct) : null;

const batteryStart =
    Math.max(
        0,
        Math.min(
            100,
            Number(trip.start_battery_pct || 0)
        )
    );

const batteryEnd =
    Math.max(
        0,
        Math.min(
            100,
            Number(trip.end_battery_pct || 0)
        )
    );

const batteryLeft =
    Math.min(
        batteryStart,
        batteryEnd
    );

const batteryWidth =
    Math.abs(
        batteryStart -
        batteryEnd
    );

const batteryDirection =
    batteryEnd >= batteryStart
        ? "charging"
        : "discharging";
    /*
     * Ortsnamen nur für Anzeige aufbereiten.
     *
     * Die Originalwerte aus der DB bleiben unangetastet.
     */

    const startLocation = escapeHtml(locationFor(trip, "start"));

    const endLocation = escapeHtml(locationFor(trip, "end"));

    /*
     * Zeit anzeigen
     */

    const startTime =

        trip.start_time

            ? formatTime(
                trip.start_time
            )

            : "–";


    const endTime =

        trip.end_time

            ? formatTime(
                trip.end_time
            )

            : "–";

    const startCoordinates = getTripCoordinates(trip, "start");
    const endCoordinates = getTripCoordinates(trip, "end");
    const tripId = trip.trip_id ?? trip.start_time_ms ?? null;
    const hasMap = startCoordinates || endCoordinates || Number(trip.route_points_count) > 0;
    const mapMarkup = hasMap
        ? `
            <div class="trip-map">
                <div class="trip-map-header">
                    <span class="trip-map-title">Start und Ziel</span>
                    <button type="button" class="trip-map-toggle" aria-expanded="false">Karte anzeigen</button>
                </div>
                <div class="trip-map-canvas" role="img" aria-label="Karte mit Start- und Zielposition" hidden></div>
            </div>
        `
        : "";


    card.innerHTML = `

        <div class="trip-main">

            <div class="route">

                <!-- ZIEL OBEN -->

                <div class="location">

                    <span class="dot"></span>

                    <span class="location-name">
                        ${endLocation}
                    </span>

                </div>


                <div class="location-time">
                    ${endTime}
                </div>


                <div class="route-line"></div>


                <!-- START UNTEN -->

                <div class="location">

                    <span class="dot"></span>

                    <span class="location-name">
                        ${startLocation}
                    </span>

                </div>


                <div class="location-time">
                    ${startTime}
                </div>

            </div>


            <div class="distance">

                <div class="distance-value">

                    ${formatNumber(
                        trip.distance_km
                    )}

                </div>


                <div class="distance-unit">
                    KM
                </div>

            </div>

        </div>


        <div class="metrics">

            <div class="metric">

                <div class="metric-value">

                    ${formatDuration(
                        durationSeconds
                    )}

                </div>


                <div class="metric-label">
                    Dauer · ca.
                </div>

            </div>


            <div class="metric">

                <div class="metric-value">

                    ${formatNumber(
                        trip.avg_kwh_100km
                    )}

                </div>


                <div class="metric-label">
                    kWh / 100 km · ca.
                </div>

            </div>


            <div class="metric">

                <div class="metric-value">

                    ${formatNumber(
                        trip.avg_speed_kmh,
                        0
                    )}

                </div>


                <div class="metric-label">
                    Ø km/h · ca.
                </div>

            </div>


            <div class="metric">

                <div class="metric-value">

                    ${formatNumber(
                        trip.consumed_kwh
                    )}

                </div>


                <div class="metric-label">
                    kWh · ca.
                </div>

            </div>

        </div>


        <div class="battery">

            <div class="battery-header">

                <span>
                    BATTERIE
                </span>


                <span>

                    ${formatNumber(
                        trip.start_battery_pct,
                        0
                    )}
                    %

                    →

                    ${formatNumber(
                        trip.end_battery_pct,
                        0
                    )}
                    %

                    &nbsp;

                    (${formatNumber(
                        batteryUsed,
                        1
                    )} %)

                </span>

            </div>


<div class="battery-bar">
    <div
        class="battery-range ${batteryDirection}"
        style="left:${batteryLeft}%; width:${batteryWidth}%;"
    ></div>
</div>
        </div>

        ${mapMarkup}

    `;

    if (!isNumber(trip.start_battery_pct) || !isNumber(trip.end_battery_pct)) card.querySelector(".battery-bar").hidden=true;
    const mapToggle = card.querySelector(".trip-map-toggle");
    if (mapToggle) {
        mapToggle.addEventListener("click", async () => {
            const mapCanvas = card.querySelector(".trip-map-canvas");
            const mapTitle = card.querySelector(".trip-map-title");
            const willOpen = mapCanvas.hidden;
            mapCanvas.hidden = !willOpen;
            mapToggle.setAttribute("aria-expanded", String(willOpen));
            mapToggle.textContent = willOpen ? "Karte schließen" : "Karte anzeigen";

            if (willOpen && !mapCanvas._leafletMap) {
                if (typeof L === "undefined") {
                    mapCanvas.textContent = "Kartenbibliothek konnte nicht geladen werden.";
                    return;
                }

                const startPoint = startCoordinates ? [startCoordinates.latitude, startCoordinates.longitude] : null;
                const endPoint = endCoordinates ? [endCoordinates.latitude, endCoordinates.longitude] : null;
                const map = L.map(mapCanvas, { scrollWheelZoom: false });

                L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
                    maxZoom: 19,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                }).addTo(map);

                const startIcon = L.divIcon({
                    className: "",
                    html: '<span class="trip-map-marker trip-map-marker--start" aria-hidden="true">S</span>',
                    iconSize: [24, 24],
                    iconAnchor: [12, 12],
                    tooltipAnchor: [0, -14]
                });
                const endIcon = L.divIcon({
                    className: "",
                    html: '<span class="trip-map-marker trip-map-marker--end" aria-hidden="true">Z</span>',
                    iconSize: [24, 24],
                    iconAnchor: [12, 12],
                    tooltipAnchor: [0, -14]
                });

                if (startPoint) L.marker(startPoint, { icon: startIcon, title: "Start" })
                    .addTo(map)
                    .bindTooltip("Start");
                if (endPoint) L.marker(endPoint, { icon: endIcon, title: "Ziel" })
                    .addTo(map)
                    .bindTooltip("Ziel");
                const endpoints = [startPoint,endPoint].filter(Boolean);
                if (endpoints.length) map.fitBounds(endpoints, {
                    padding: [35, 35],
                    maxZoom: 16
                });

                if (!endpoints.length) map.setView([47.8,13.0],6);
                mapCanvas._leafletMap = map;
            }

            if (!willOpen) {
                return;
            }

            const map = mapCanvas._leafletMap;
            setTimeout(() => map.invalidateSize(), 0);

            if (!tripId || mapCanvas._routeLoaded || mapCanvas._routeLoading) {
                return;
            }

            mapCanvas._routeLoading = true;
            mapTitle.textContent = "Route wird geladen ...";

            try {
                const response = await bmwFetch(
                    `${TRIP_ROUTE_API_URL}?trip_id=${encodeURIComponent(tripId)}`,
                    { cache: "no-store" }
                );

                if (!response.ok) {
                    throw new Error(`Route API HTTP ${response.status}`);
                }

                const routeData = await response.json();
                const routePoints = (Array.isArray(routeData.points) ? routeData.points : [])
                    .filter(point =>
                        isNumber(point.latitude) && Math.abs(Number(point.latitude)) <= 90 &&
                        isNumber(point.longitude) && Math.abs(Number(point.longitude)) <= 180
                    )
                    .sort((a, b) =>
                        Number(a.point_index || 0) - Number(b.point_index || 0)
                    )
                    .map(point => [
                        Number(point.latitude),
                        Number(point.longitude)
                    ]);

                if (routePoints.length >= 2) {
                    const routeLine = L.polyline(routePoints, {
                        color: "#3388ff",
                        weight: 5,
                        opacity: 0.9,
                        dashArray: "6 6",
                        lineJoin: "round"
                    }).addTo(map);

                    map.fitBounds(routeLine.getBounds(), {
                        padding: [35, 35],
                        maxZoom: 16
                    });

                    mapTitle.textContent = `GPS-Aufzeichnung · ${routePoints.length} Punkte · grobe Verbindung`;
                } else {
                    mapTitle.textContent = "Start und Ziel · keine Route vorhanden";
                }

                mapCanvas._routeLoaded = true;

            } catch (error) {
                console.error("Trip Route API Fehler:", error);
                mapTitle.textContent = "Start und Ziel · Route nicht verfügbar";

            } finally {
                mapCanvas._routeLoading = false;
            }
        });
    }


    return card;
}



/*
 * ============================================================
 * CHARGING CARD
 * ============================================================
 */

function createChargingCard(session) {

    const card =
        document.createElement("article");

    const chargeType = ["AC","DC"].includes(String(session.charge_type).toUpperCase()) ? String(session.charge_type).toUpperCase() : "Unbekannt";

    const typeClass = chargeType === "DC" ? "charge-dc" : chargeType === "AC" ? "charge-ac" : "charge-unknown";

    const batteryColor =
        chargeType === "DC"
            ? "#b99954"
            : "#4b9877";

    const batteryGlow =
        chargeType === "DC"
            ? "rgba(255, 212, 59, 0.6)"
            : "rgba(56, 193, 114, 0.6)";

    card.className =
        `trip charging-card ${typeClass}`;


    const batteryStart =
        Math.max(
            0,
            Math.min(
                100,
                Number(session.start_battery_pct || 0)
            )
        );

    const batteryEnd =
        Math.max(
            0,
            Math.min(
                100,
                Number(session.end_battery_pct || 0)
            )
        );

    const batteryLeft =
        Math.min(
            batteryStart,
            batteryEnd
        );

    const batteryWidth =
        Math.abs(
            batteryEnd - batteryStart
        );


    const startTime =
        session.start_time
            ? formatTime(session.start_time)
            : "–";

    const endTime =
        session.end_time
            ? formatTime(session.end_time)
            : "–";


    const chargedBatteryPct =
        isNumber(session.charged_battery_pct) ? Number(session.charged_battery_pct) : null;


    card.innerHTML = `

        <div class="charge-main">

            <div>
                <div class="charge-heading">
                    <span class="charge-dot"></span>
                    <span>${chargeType} LADEN${session.completed === false ? " · " + (session.status === "charging" ? "läuft" : "angeschlossen") : ""}${session.partial === true ? " · Teilaufzeichnung" : ""}</span>
                </div>

                <div class="charge-time">
                    ${startTime} → ${endTime}
                </div>
            </div>

            <div class="charge-type">
                ${chargeType}
            </div>

        </div>


        <div class="metrics">

            <div class="metric">
                <div class="metric-value">
                    ${formatDuration(session.duration_seconds)}
                </div>
                <div class="metric-label">
                    Aktiv geladen
                </div>
            </div>

            <div class="metric">
                <div class="metric-value">
                    ${formatNumber(session.charged_energy_kwh, 2)}
                </div>
                <div class="metric-label">
                    kWh im Akku · ca.
                </div>
            </div>

            <div class="metric">
                <div class="metric-value">
                    ${formatNumber(session.max_power_kw, 1)}
                </div>
                <div class="metric-label">
                    Max kW · gemeldet
                </div>
            </div>

            <div class="metric">
                <div class="metric-value">
                    ${formatDuration(session.connected_seconds)}
                </div>
                <div class="metric-label">
                    Angeschlossen
                </div>
            </div>

        </div>


        <div class="battery">

            <div class="battery-header">

                <span>
                    BATTERIE
                </span>

                <span>
                    ${formatNumber(session.start_battery_pct, 0)} %
                    →
                    ${formatNumber(session.end_battery_pct, 0)} %
                    &nbsp;
                    (+${formatNumber(chargedBatteryPct, 1)} %)
                </span>

            </div>

            <div class="battery-bar">
                <div
                    class="battery-range ${typeClass}"
                    style="left:${batteryLeft}%; width:${batteryWidth}%; background:${batteryColor}; box-shadow:0 0 5px ${batteryGlow};"
                ></div>
            </div>

        </div>
    `;


    if (!isNumber(session.start_battery_pct) || !isNumber(session.end_battery_pct)) card.querySelector(".battery-bar").hidden=true;
    const phases = Array.isArray(session.phases) ? session.phases : [];
    const phaseDetails = document.createElement("div");
    phaseDetails.className = "phase-info";
    phaseDetails.textContent = `${phases.length || session.phase_count || 1} Ladephase(n) · Ziel ${formatNumber(session.start_target_pct,0)} % → ${formatNumber(session.end_target_pct,0)} % · Netzbezug nicht gemessen`;
    card.appendChild(phaseDetails);

    if (session.session_id) {
        const curveSection = document.createElement("div");
        curveSection.className = "charge-curve-section";
        curveSection.innerHTML = `
            <button type="button" class="charge-curve-toggle" aria-expanded="false">
                <span>Ladekurve anzeigen</span>
                <span class="charge-curve-chevron">⌄</span>
            </button>
            <div class="charge-curve-content" hidden>
                <div class="charge-curve-message">Ladekurve wird geladen ...</div>
            </div>
        `;
        card.appendChild(curveSection);

        const toggle = curveSection.querySelector(".charge-curve-toggle");
        const content = curveSection.querySelector(".charge-curve-content");

        toggle.addEventListener("click", async () => {
            const open = toggle.getAttribute("aria-expanded") === "true";
            if (open) {
                toggle.setAttribute("aria-expanded", "false");
                toggle.querySelector("span").textContent = "Ladekurve anzeigen";
                content.hidden = true;
                return;
            }

            toggle.setAttribute("aria-expanded", "true");
            toggle.querySelector("span").textContent = "Ladekurve ausblenden";
            content.hidden = false;
            if (content.dataset.loaded === "true") return;

            try {
                const response = await bmwFetch(
                    `${CHARGING_CURVE_API_URL}?session_id=${encodeURIComponent(session.session_id)}`,
                    { cache: "no-store" }
                );
                if (!response.ok) throw new Error(`Curve API HTTP ${response.status}`);
                const data = await response.json();
                renderChargeCurve(content, Array.isArray(data.points) ? data.points : [], chargeType);
                content.dataset.loaded = "true";
            } catch (error) {
                console.error("Charging Curve API Fehler:", error);
                content.innerHTML = `<div class="charge-curve-message">Ladekurve konnte nicht geladen werden.</div>`;
            }
        });
    }


    return card;
}


/*
 * ============================================================
 * LADEKURVE
 * ============================================================
 */

function renderChargeCurve(container, rawPoints, chargeType) {
    const points = rawPoints
        .map(p => ({ kw:isNumber(p.power_kw) ? Number(p.power_kw) : NaN, elapsed:isNumber(p.elapsed_seconds) ? Number(p.elapsed_seconds) : NaN, phase:p.phase_index }))
        .filter(p => Number.isFinite(p.elapsed) && p.elapsed >= 0 && Number.isFinite(p.kw))
        .sort((a,b) => a.elapsed-b.elapsed);

    if (points.length < 1) {
        container.innerHTML = `<div class="charge-curve-message">Noch nicht genügend Daten für eine Ladekurve.</div>`;
        return;
    }

    const W=900, H=300, P={l:58,r:22,t:22,b:42};
    const pw=W-P.l-P.r, ph=H-P.t-P.b;

    const durationMinutes=Math.max(points[points.length-1].elapsed/60,1);
    const roughStep=durationMinutes/6;
    const magnitude=10**Math.floor(Math.log10(roughStep));
    const xStep=[1,2,5,10].map(n=>n*magnitude).find(n=>n>=roughStep);
    const maxMinutes=Math.ceil(durationMinutes/xStep)*xStep;
    const measuredMax=Math.max(...points.map(p=>p.kw),1);
    const yStep=measuredMax<=25?5:measuredMax<=100?20:50;
    const maxKw=Math.ceil(measuredMax/yStep)*yStep;

    const x=minutes=>P.l+(minutes/maxMinutes)*pw;
    const y=k=>P.t+ph-(Math.max(0,k)/maxKw)*ph;
    const color=chargeType==="DC"?"#b99954":"#4b9877";
    const path=points.map((p,i)=>`${i && p.phase === points[i-1].phase && p.elapsed-points[i-1].elapsed <= 900 ? "L" : "M"} ${x(p.elapsed/60).toFixed(2)} ${y(p.kw).toFixed(2)}`).join(" ");

    let grid="";
    for(let v=0;v<=maxKw;v+=yStep){
        const yy=y(v);
        grid+=`<line x1="${P.l}" y1="${yy}" x2="${W-P.r}" y2="${yy}" class="curve-grid-line"/>
        <text x="${P.l-10}" y="${yy+4}" text-anchor="end" class="curve-axis-text">${v}</text>`;
    }


    for(let i=0;i<=Math.round(maxMinutes/xStep);i++){
        const v=i*xStep;
        const xx=x(v);
        grid+=`<line x1="${xx}" y1="${P.t}" x2="${xx}" y2="${H-P.b}" class="curve-grid-line curve-grid-line-vertical"/>
        <text x="${xx}" y="${H-15}" text-anchor="middle" class="curve-axis-text">${formatNumber(v, xStep<1?1:0)}</text>`;
    }

    const peak=points.reduce((a,p)=>p.kw>a.kw?p:a,points[0]);

    container.innerHTML=`
        <div class="charge-curve-summary">
            <span>${points.length} Messpunkte</span>
            <span>Peak ${formatNumber(peak.kw,1)} kW nach ${formatNumber(peak.elapsed/60,1)} min</span>
        </div>
        <div class="charge-curve-chart">
            <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ladekurve: Leistung in kW über Minuten seit Sessionbeginn">
                ${grid}
                <line x1="${P.l}" y1="${P.t}" x2="${P.l}" y2="${H-P.b}" class="curve-axis-line"/>
                <line x1="${P.l}" y1="${H-P.b}" x2="${W-P.r}" y2="${H-P.b}" class="curve-axis-line"/>
                <text x="16" y="${P.t+ph/2}" transform="rotate(-90 16 ${P.t+ph/2})" text-anchor="middle" class="curve-axis-label">kW</text>
                <text x="${P.l+pw/2}" y="${H-2}" text-anchor="middle" class="curve-axis-label">Zeit seit Anschlussbeginn (min)</text>
                <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
                ${points.map(p=>`<circle cx="${x(p.elapsed/60)}" cy="${y(p.kw)}" r="3" fill="${color}"><title>${formatNumber(p.elapsed/60,1)} min · ${formatNumber(p.kw,2)} kW</title></circle>`).join("")}
            </svg>
        </div><p class="curve-note">Linien verbinden nur Messpunkte derselben Phase mit höchstens 15 Minuten Abstand. Lücken bleiben offen.</p>`;
}


/*
 * ============================================================
 * DATEN LADEN
 * ============================================================
 */

function getHistoryTimestamp(item) {
    const timestamp = new Date(
        item.end_time || item.start_time || 0
    ).getTime();

    return Number.isFinite(timestamp) ? timestamp : 0;
}


function selectHistoryByDistance(trips, chargingSessions, maxDistanceKm) {
    if (maxDistanceKm === "all") {
        return {
            trips: [...trips],
            chargingSessions: [...chargingSessions]
        };
    }

    const sortedTrips = [...trips].sort(
        (a, b) => getHistoryTimestamp(b) - getHistoryTimestamp(a)
    );
    const selectedTrips = [];
    let selectedDistance = 0;

    for (const trip of sortedTrips) {
        if (selectedTrips.length > 0 && selectedDistance >= maxDistanceKm) {
            break;
        }

        selectedTrips.push(trip);
        selectedDistance += Math.max(0, Number(trip.distance_km || 0));
    }

    if (selectedTrips.length === 0) {
        return { trips: [], chargingSessions: [...chargingSessions] };
    }

    const cutoffTime = Math.min(
        ...selectedTrips.map(getHistoryTimestamp).filter(Boolean)
    );
    const selectedChargingSessions = Number.isFinite(cutoffTime)
        ? chargingSessions.filter(
            session => getHistoryTimestamp(session) >= cutoffTime
        )
        : [];

    return {
        trips: selectedTrips,
        chargingSessions: selectedChargingSessions
    };
}

let loadGeneration = 0;
let historyError = null;
async function loadHistory(force = false) {
    const generation = ++loadGeneration;
    document.querySelectorAll(".trip-map-canvas").forEach(canvas => { if (canvas._leafletMap) canvas._leafletMap.remove(); });
    updateTripExport([]);
    const state = document.getElementById('connectionState');
    state.textContent = 'Daten werden geladen …';
    document.getElementById('tripContainer').innerHTML = '<div class="message">Lade Fahrten und Ladevorgänge …</div>';
    try {
        if (force || !allHistoryPromise) {
            allHistoryPromise = Promise.all([
                bmwFetch(API_URL+'?days=all').then(r=>r.json()),
                bmwFetch(CHARGING_API_URL+'?days=all').then(r=>r.json())
            ]).then(([a,b])=>{
                if (!Array.isArray(a.trips) || !Array.isArray(b.charging_sessions)) throw new Error('Unerwartete Antwort der BMW-API');
                return {trips:a.trips, chargingSessions:b.charging_sessions};
            }).catch(error=>{ allHistoryPromise=null; throw error; });
        }
        const complete = await allHistoryPromise;
        if (generation !== loadGeneration) return;
        const selected = selectHistoryByDistance(complete.trips,complete.chargingSessions,selectedDistanceKm);
        updateTripExport(selected.trips);
        renderHistory(selected.trips,selected.chargingSessions,complete.trips,complete.chargingSessions);
        state.textContent = 'Abgerufen um '+formatTime(new Date().toISOString())+' · BMW iX1';
        historyError = null;
    } catch(error) {
        if (generation !== loadGeneration) return;
        historyError = error;
        ['totalTrips','totalDistance','averageConsumption','distanceSinceLastCharge'].forEach(id=>document.getElementById(id).textContent='–');
        document.getElementById('consumptionTrend').innerHTML='<div class="message">Verbrauchskurve noch nicht verfügbar.</div>';
        document.getElementById('tripContainer').innerHTML='<div class="message">BMW-Daten sind derzeit nicht erreichbar. Bitte später über „Aktualisieren“ erneut laden.</div>';
        state.textContent = error.name==='TimeoutError' || error.name==='AbortError' ? 'Zeitüberschreitung beim Laden der BMW-Daten.' : 'BMW-API: '+error.message;
    }
}
document.getElementById('refreshButton').addEventListener('click',()=>loadHistory(true));



/*
 * ============================================================
 * STRECKE ÄNDERN
 * ============================================================
 */

const rangeSelect =
    document.getElementById(
        "rangeSelect"
    );


document.getElementById("exportTripsButton").addEventListener(
    "click",
    exportSelectedTrips
);


rangeSelect.addEventListener(
    "change",
    function () {

        selectedDistanceKm = rangeSelect.value === "all"
            ? "all"
            : Number(rangeSelect.value);


        loadHistory();
    }
);


/*
 * ============================================================
 * START
 * ============================================================
 */

loadHistory();
