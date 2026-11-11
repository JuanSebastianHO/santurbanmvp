/**
 * @file js/views/MapView.js
 * @description Componente de visualización geográfica interactiva con Leaflet.js y Leaflet.heat.
 * Renderiza marcadores por categoría, mapa de calor ponderado y popups seguros con carga
 * de fotografías privadas mediante URLs firmadas de Supabase Storage.
 */

import { ENV } from '../config/env.js';
import { createElement, formatDateTime } from '../utils/dom.js';

export class MapView {
    /**
     * @param {string|HTMLElement} containerOrId
     * @param {Object} options
     * @param {(photo: Object) => Promise<string|null>} options.resolvePhotoUrlCallback
     */
    constructor(containerOrId, options = {}) {
        this._containerOrId = containerOrId;
        this._resolvePhotoUrl = options.resolvePhotoUrlCallback || (async () => null);

        this._map = null;
        this._markersLayerGroup = null;
        this._heatLayer = null;
        this._showMarkers = true;
        this._showHeatmap = true;
        this._currentFindings = [];
    }

    /**
     * Inicializa el mapa Leaflet con proveedor base OpenStreetMap (sin requerir API Key).
     */
    initMap() {
        const container =
            typeof this._containerOrId === 'string'
                ? document.getElementById(this._containerOrId)
                : this._containerOrId;

        if (!container || typeof L === 'undefined') return;

        if (this._map) {
            this._map.remove();
            this._map = null;
        }

        this._map = L.map(container, {
            center: [ENV.MAP_DEFAULTS.CENTER_LAT, ENV.MAP_DEFAULTS.CENTER_LNG],
            zoom: ENV.MAP_DEFAULTS.DEFAULT_ZOOM,
            minZoom: ENV.MAP_DEFAULTS.MIN_ZOOM,
            maxZoom: ENV.MAP_DEFAULTS.MAX_ZOOM
        });

        L.tileLayer(ENV.MAP_DEFAULTS.TILE_URL, {
            attribution: ENV.MAP_DEFAULTS.TILE_ATTRIBUTION,
            maxZoom: ENV.MAP_DEFAULTS.MAX_ZOOM
        }).addTo(this._map);

        this._markersLayerGroup = L.layerGroup().addTo(this._map);
    }

    /**
     * Actualiza tanto los marcadores como la capa de calor con la lista de hallazgos filtrados.
     * @param {Array<Object>} findings
     * @param {Object} [options={ fitBounds: false }]
     */
    updateData(findings = [], options = { fitBounds: false }) {
        this._currentFindings = Array.isArray(findings) ? findings : [];
        if (!this._map) return;

        this._renderMarkers();
        this._renderHeatLayer();

        if (options.fitBounds && this._currentFindings.length > 0) {
            const coords = this._currentFindings
                .filter((f) => typeof f.latitude === 'number' && typeof f.longitude === 'number')
                .map((f) => [f.latitude, f.longitude]);

            if (coords.length > 0) {
                const bounds = L.latLngBounds(coords);
                this._map.fitBounds(bounds, { padding: [35, 35], maxZoom: 15 });
            }
        }
    }

    /**
     * Activa o desactiva la visibilidad de los marcadores individuales.
     * @param {boolean} visible
     */
    setMarkersVisibility(visible) {
        this._showMarkers = Boolean(visible);
        this._renderMarkers();
    }

    /**
     * Activa o desactiva la visibilidad del mapa de calor (Leaflet.heat).
     * @param {boolean} visible
     */
    setHeatmapVisibility(visible) {
        this._showHeatmap = Boolean(visible);
        this._renderHeatLayer();
    }

    /**
     * Centra el mapa en una coordenada específica (ej. al hacer clic en una alerta).
     * @param {number} latitude
     * @param {number} longitude
     * @param {number} [zoom=16]
     */
    focusCoordinates(latitude, longitude, zoom = 16) {
        if (!this._map) return;
        this._map.setView([latitude, longitude], zoom, { animate: true });
    }

    /**
     * Renderiza los marcadores circulares codificados por color según la categoría del hallazgo.
     */
    _renderMarkers() {
        if (!this._map || !this._markersLayerGroup) return;
        this._markersLayerGroup.clearLayers();

        if (!this._showMarkers) return;

        for (const finding of this._currentFindings) {
            if (typeof finding.latitude !== 'number' || typeof finding.longitude !== 'number') {
                continue;
            }

            const catConfig = ENV.FINDING_CATEGORIES.find((c) => c.id === finding.category) || {
                label: finding.category,
                badgeColor: '#52b788',
                isAlert: false
            };

            const isSimulated = finding.location_source === ENV.LOCATION_SOURCES.SIMULATED;

            const marker = L.circleMarker([finding.latitude, finding.longitude], {
                radius: catConfig.isAlert ? 10 : 8,
                fillColor: catConfig.badgeColor,
                color: isSimulated ? '#f4a261' : '#ffffff',
                weight: isSimulated ? 2.5 : 1.8,
                opacity: 1,
                fillOpacity: 0.88
            });

            // Construir nodo DOM seguro para el popup
            marker.bindPopup(() => this._buildSafePopupElement(finding, catConfig), {
                maxWidth: 300,
                minWidth: 240
            });

            this._markersLayerGroup.addLayer(marker);
        }
    }

    /**
     * Renderiza la capa de calor con Leaflet.heat.
     * Los focos de degradación y contaminación tienen mayor intensidad térmica.
     */
    _renderHeatLayer() {
        if (!this._map) return;

        if (this._heatLayer) {
            this._map.removeLayer(this._heatLayer);
            this._heatLayer = null;
        }

        if (!this._showHeatmap || typeof L.heatLayer !== 'function') return;

        const heatPoints = this._currentFindings
            .filter((f) => typeof f.latitude === 'number' && typeof f.longitude === 'number')
            .map((f) => {
                let intensity = 0.65;
                if (f.category === 'foco_degradacion') intensity = 1.0;
                else if (f.category === 'contaminacion') intensity = 0.85;
                else if (f.category === 'especie_nativa') intensity = 0.75;

                return [f.latitude, f.longitude, intensity];
            });

        if (heatPoints.length === 0) return;

        this._heatLayer = L.heatLayer(heatPoints, {
            radius: 26,
            blur: 18,
            maxZoom: 15,
            gradient: {
                0.25: '#2d6a4f',
                0.5: '#52b788',
                0.75: '#f4a261',
                1.0: '#e63946'
            }
        }).addTo(this._map);
    }

    /**
     * Construye el contenido del Popup del marcador usando createElement y textContent
     * para impedir cualquier ejecución de scripts (XSS) y carga la fotografía asociada
     * mediante URL firmada bajo demanda al abrir el popup.
     *
     * @param {Object} finding
     * @param {Object} catConfig
     * @returns {HTMLElement}
     */
    _buildSafePopupElement(finding, catConfig) {
        const photoContainer = createElement('div', {
            style: 'margin-top: 0.55rem; text-align: center;'
        });

        const photos = Array.isArray(finding.photographs) ? finding.photographs : [];
        if (photos.length > 0) {
            const loadingText = createElement('span', {
                style: 'font-size: 0.78rem; color: #555;',
                text: 'Cargando fotografía autorizada (URL firmada)...'
            });
            photoContainer.appendChild(loadingText);

            // Resolver URL firmada de la primera fotografía asociada
            this._resolvePhotoUrl(photos[0])
                .then((signedUrl) => {
                    photoContainer.textContent = '';
                    if (signedUrl) {
                        const img = createElement('img', {
                            attrs: {
                                src: signedUrl,
                                alt: `Fotografía del hallazgo ${catConfig.label}`,
                                style: 'width:100%; max-height:150px; object-fit:cover; border-radius:6px; border:1px solid #ccc;'
                            }
                        });
                        photoContainer.appendChild(img);
                    } else {
                        photoContainer.appendChild(
                            createElement('span', {
                                style: 'font-size: 0.76rem; color: #777;',
                                text: 'Fotografía disponible tras sincronización.'
                            })
                        );
                    }
                })
                .catch(() => {
                    photoContainer.textContent = 'No se pudo cargar la vista previa.';
                });
        }

        const altitudeText =
            finding.altitude !== null && finding.altitude !== undefined
                ? `${finding.altitude} m s.n.m.`
                : 'No disponible';

        const sourceText =
            finding.location_source === ENV.LOCATION_SOURCES.SIMULATED
                ? 'Simulada (Ruta Académica)'
                : 'GPS Real';

        return createElement('div', {
            style: 'color: #1b2621; font-family: system-ui, sans-serif; font-size: 0.85rem; line-height: 1.4;',
            children: [
                createElement('div', {
                    style: `font-weight: 800; font-size: 0.95rem; color: ${catConfig.badgeColor}; margin-bottom: 0.25rem;`,
                    text: catConfig.label
                }),
                finding.species_name
                    ? createElement('div', {
                          style: 'font-weight: 700; margin-bottom: 0.2rem;',
                          text: `Especie: ${finding.species_name}`
                      })
                    : null,
                finding.description
                    ? createElement('p', {
                          style: 'margin: 0.25rem 0; color: #333;',
                          text: finding.description
                      })
                    : null,
                createElement('div', {
                    style: 'font-size: 0.78rem; color: #444; border-top: 1px solid #ddd; padding-top: 0.35rem; margin-top: 0.35rem;',
                    children: [
                        createElement('div', {
                            text: `Coordenadas: ${Number(finding.latitude).toFixed(5)}, ${Number(finding.longitude).toFixed(5)}`
                        }),
                        createElement('div', { text: `Altitud: ${altitudeText}` }),
                        createElement('div', { text: `Fuente: ${sourceText}` }),
                        createElement('div', { text: `Fecha: ${formatDateTime(finding.captured_at)}` })
                    ]
                }),
                photoContainer
            ].filter(Boolean)
        });
    }

    /**
     * Destruye la instancia de Leaflet liberando recursos de memoria.
     */
    destroy() {
        if (this._map) {
            this._map.remove();
            this._map = null;
            this._markersLayerGroup = null;
            this._heatLayer = null;
        }
    }
}