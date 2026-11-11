/**
 * @file js/config/santurban-route.js
 * @description Puntos geográficos de referencia en el complejo del Páramo de Santurbán
 * para pruebas académicas mediante el botón "Avanzar ruta".
 * Todos los puntos generados por esta ruta se marcan obligatoriamente con source = 'simulated'.
 */

import { ENV } from './env.js';

export const SANTURBAN_SIMULATED_ROUTE = Object.freeze([
    {
        step: 1,
        sectorName: 'Laguna Brava (Sector Arboledas - Santurbán)',
        latitude: 7.25641,
        longitude: -72.88214,
        altitude: 3385,
        location_accuracy: 4.5,
        location_source: ENV.LOCATION_SOURCES.SIMULATED
    },
    {
        step: 2,
        sectorName: 'Valle de los Frailejones (Berlín - Tona)',
        latitude: 7.21389,
        longitude: -72.94102,
        altitude: 3420,
        location_accuracy: 3.8,
        location_source: ENV.LOCATION_SOURCES.SIMULATED
    },
    {
        step: 3,
        sectorName: 'Complejo de Lagunas Verdes (Vetas)',
        latitude: 7.31245,
        longitude: -72.87456,
        altitude: 3650,
        location_accuracy: 5.0,
        location_source: ENV.LOCATION_SOURCES.SIMULATED
    },
    {
        step: 4,
        sectorName: 'Laguna Grande de Santurbán (Cuchilla del Picacho)',
        latitude: 7.33812,
        longitude: -72.86190,
        altitude: 3740,
        location_accuracy: 4.2,
        location_source: ENV.LOCATION_SOURCES.SIMULATED
    },
    {
        step: 5,
        sectorName: 'Páramo Rico (Sector California - Vetas)',
        latitude: 7.35108,
        longitude: -72.91234,
        altitude: 3580,
        location_accuracy: 6.1,
        location_source: ENV.LOCATION_SOURCES.SIMULATED
    },
    {
        step: 6,
        sectorName: 'Alto del Almorzadero - Borde Sur Santurbán',
        latitude: 7.18940,
        longitude: -72.96810,
        altitude: 3310,
        location_accuracy: 4.0,
        location_source: ENV.LOCATION_SOURCES.SIMULATED
    }
]);