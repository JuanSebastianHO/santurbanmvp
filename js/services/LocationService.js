/**
 * @file js/services/LocationService.js
 * @description Servicio de geolocalización bajo demanda (Geolocation API) y
 * máquina de estados para la simulación académica de ruta en el Páramo de Santurbán.
 * Nunca mantiene tracking continuo en segundo plano ni inventa altitudes faltantes.
 */

import { ENV } from '../config/env.js';
import { SANTURBAN_SIMULATED_ROUTE } from '../config/santurban-route.js';

export class LocationService {
    constructor() {
        this._simulationIndex = -1;
        /** @type {Object|null} */
        this._lastPosition = null;
    }

    /**
     * Retorna la última ubicación capturada (real o simulada).
     * @returns {Object|null}
     */
    get currentLocation() {
        return this._lastPosition ? Object.freeze({ ...this._lastPosition }) : null;
    }

    /**
     * Solicita la ubicación actual al hardware GPS del dispositivo bajo demanda.
     * Utiliza navigator.geolocation.getCurrentPosition() sin watchPosition continuo.
     *
     * @param {Object} [options]
     * @param {number} [options.timeout=15000]
     * @param {number} [options.maximumAge=0]
     * @returns {Promise<{
     *   latitude: number,
     *   longitude: number,
     *   altitude: number|null,
     *   location_accuracy: number|null,
     *   location_source: 'gps',
     *   captured_at: string,
     *   sectorName: string|null
     * }>}
     */
    async getCurrentPosition(options = {}) {
        if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
            throw new Error('La API de Geolocalización no está disponible en este navegador o dispositivo.');
        }

        const geoOptions = {
            enableHighAccuracy: true,
            timeout: options.timeout ?? 15000,
            maximumAge: options.maximumAge ?? 0
        };

        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const coords = pos.coords;

                    // No inventar altitud ni precisión si el sensor entrega null o NaN
                    const rawAltitude =
                        typeof coords.altitude === 'number' && Number.isFinite(coords.altitude)
                            ? Number(coords.altitude.toFixed(2))
                            : null;

                    const rawAccuracy =
                        typeof coords.accuracy === 'number' && Number.isFinite(coords.accuracy)
                            ? Number(coords.accuracy.toFixed(2))
                            : null;

                    const result = {
                        latitude: Number(coords.latitude.toFixed(6)),
                        longitude: Number(coords.longitude.toFixed(6)),
                        altitude: rawAltitude,
                        location_accuracy: rawAccuracy,
                        location_source: ENV.LOCATION_SOURCES.GPS,
                        captured_at: new Date(pos.timestamp || Date.now()).toISOString(),
                        sectorName: null
                    };

                    this._lastPosition = result;
                    resolve(Object.freeze({ ...result }));
                },
                (err) => {
                    let message = 'No fue posible obtener la ubicación GPS.';
                    if (err) {
                        switch (err.code) {
                            case 1: // PERMISSION_DENIED
                                message =
                                    'Permiso de ubicación denegado. Habilite el acceso al GPS en su navegador o utilice el modo de ruta simulada para pruebas.';
                                break;
                            case 2: // POSITION_UNAVAILABLE
                                message =
                                    'Señal GPS no disponible en este momento. Asegúrese de tener visión al cielo o active la ubicación del dispositivo.';
                                break;
                            case 3: // TIMEOUT
                                message =
                                    'Tiempo de espera agotado al adquirir satélites GPS. Intente nuevamente.';
                                break;
                            default:
                                message = err.message || message;
                        }
                    }
                    reject(new Error(message));
                },
                geoOptions
            );
        });
    }

    /**
     * Avanza al siguiente punto de la ruta simulada del Páramo de Santurbán.
     * Identifica explícitamente la fuente como 'simulated' para no mezclarla con GPS real.
     *
     * @returns {{
     *   step: number,
     *   totalSteps: number,
     *   sectorName: string,
     *   latitude: number,
     *   longitude: number,
     *   altitude: number,
     *   location_accuracy: number,
     *   location_source: 'simulated',
     *   captured_at: string
     * }}
     */
    advanceSimulatedRoute() {
        this._simulationIndex = (this._simulationIndex + 1) % SANTURBAN_SIMULATED_ROUTE.length;
        const waypoint = SANTURBAN_SIMULATED_ROUTE[this._simulationIndex];

        const simulatedPosition = {
            step: waypoint.step,
            totalSteps: SANTURBAN_SIMULATED_ROUTE.length,
            sectorName: waypoint.sectorName,
            latitude: waypoint.latitude,
            longitude: waypoint.longitude,
            altitude: waypoint.altitude,
            location_accuracy: waypoint.location_accuracy,
            location_source: ENV.LOCATION_SOURCES.SIMULATED,
            captured_at: new Date().toISOString()
        };

        this._lastPosition = simulatedPosition;
        return Object.freeze({ ...simulatedPosition });
    }

    /**
     * Reinicia el estado de ubicación almacenado.
     */
    clearCurrentLocation() {
        this._lastPosition = null;
    }
}

export const locationService = new LocationService();