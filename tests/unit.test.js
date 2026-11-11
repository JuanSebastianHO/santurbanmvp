/**
 * @file tests/unit.test.js
 * @description Pruebas unitarias de Dominio, Validación, Ruta Simulada,
 * Compresión de Imágenes, Corrección Auditada de Metadatos y Exportación SIG.
 */

import { ENV } from '../js/config/env.js';
import { Validator } from '../js/core/Validator.js';
import { ReporteAmbientalFactory } from '../js/models/ReporteAmbiental.js';
import { CameraService } from '../js/services/CameraService.js';
import { ExportService } from '../js/services/ExportService.js';
import { ImageCompressionService } from '../js/services/ImageCompressionService.js';
import { LocationService } from '../js/services/LocationService.js';
import { generateUUID, isValidUUID } from '../js/utils/uuid.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Falló aserción en prueba unitaria.');
    }
}

/**
 * Crea un Blob de imagen sintético de prueba usando un Canvas en memoria.
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Blob>}
 */
async function createSyntheticImageBlob(width = 2000, height = 1500) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2d6a4f';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#f4a261';
    ctx.fillRect(100, 100, 400, 400);

    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
}

export async function runUnitTests() {
    const tests = [
        {
            name: 'Generación de UUID v4 válido y verificación de configuración Supabase',
            fn: async () => {
                const id = generateUUID();
                assert(isValidUUID(id), 'El UUID generado no cumple el estándar v4.');
                assert(
                    ENV.SUPABASE_URL === 'https://nkvkzyugbwcdaoxhcttp.supabase.co',
                    'La URL base de Supabase no coincide.'
                );
                assert(
                    ENV.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_'),
                    'La Publishable Key no está configurada.'
                );
                return `UUID generado: ${id}`;
            }
        },
        {
            name: 'Creación de Hallazgo válido y rechazo de coordenadas fuera de rango o especie nativa vacía',
            fn: async () => {
                const userId = generateUUID();

                // 1. Debe rechazar especie_nativa sin species_name
                let failedAsExpected = false;
                try {
                    ReporteAmbientalFactory.create({
                        created_by: userId,
                        category: 'especie_nativa',
                        species_name: '',
                        latitude: 7.2564,
                        longitude: -72.8821,
                        location_source: 'gps'
                    });
                } catch {
                    failedAsExpected = true;
                }
                assert(failedAsExpected, 'Debió rechazar especie_nativa sin nombre de especie.');

                // 2. Debe rechazar latitud inválida (> 90) y no inventar altitud cuando es null
                const validReport = ReporteAmbientalFactory.create({
                    created_by: userId,
                    category: 'especie_nativa',
                    species_name: 'Espeletia grandiflora',
                    description: 'Individuo adulto saludable',
                    latitude: 7.25641,
                    longitude: -72.88214,
                    altitude: null,
                    location_accuracy: 4.2,
                    location_source: 'gps'
                });

                assert(validReport.finding.altitude === null, 'No debe inventar altitud cuando es null.');
                assert(
                    !Validator.isValidLatitude(115),
                    'Validator debe rechazar latitudes mayores a 90.'
                );
                return 'Factory valida rangos geográficos y preserva null en altitud no disponible.';
            }
        },
        {
            name: 'Simulación de Ruta del Páramo de Santurbán ("Avanzar ruta") marca fuente simulated',
            fn: async () => {
                const locService = new LocationService();
                const step1 = locService.advanceSimulatedRoute();
                const step2 = locService.advanceSimulatedRoute();

                assert(
                    step1.location_source === 'simulated' && step2.location_source === 'simulated',
                    'Los puntos simulados deben tener location_source = "simulated".'
                );
                assert(
                    step1.latitude !== step2.latitude || step1.longitude !== step2.longitude,
                    'Avanzar ruta debe actualizar las coordenadas.'
                );
                assert(
                    typeof step1.altitude === 'number' && step1.altitude > 3000,
                    'La ruta simulada debe incluir altitud de páramo.'
                );
                return `Paso 1: ${step1.sectorName} (${step1.altitude}m) -> Paso 2: ${step2.sectorName} (${step2.altitude}m)`;
            }
        },
        {
            name: 'Captura y compresión de fotografías en dispositivo preservando metadatos geográficos',
            fn: async () => {
                const compressionService = new ImageCompressionService();
                const camera = new CameraService(compressionService);

                const rawBlob = await createSyntheticImageBlob(2200, 1650);
                const simulatedGeo = {
                    latitude: 7.31245,
                    longitude: -72.87456,
                    altitude: 3650,
                    location_accuracy: 5.0,
                    location_source: 'simulated',
                    captured_at: new Date().toISOString()
                };

                const processed = await camera.processCapturedFile(rawBlob, simulatedGeo);
                camera.revokeAllPreviews();

                assert(
                    processed.width <= ENV.IMAGE_COMPRESSION.MAX_WIDTH,
                    'La imagen comprimida excede el ancho máximo configurado.'
                );
                assert(
                    processed.mime_type === 'image/jpeg',
                    'El formato de salida debe ser image/jpeg.'
                );
                assert(
                    processed.latitude === 7.31245 && processed.location_source === 'simulated',
                    'Los metadatos geográficos automáticos no se asociaron a la fotografía.'
                );
                return `Redimensionada de 2200x1650 a ${processed.width}x${processed.height}px (${Math.round(
                    processed.file_size / 1024
                )} KB).`;
            }
        },
        {
            name: 'Integridad de Metadatos y Corrección Auditada (conservando valor original)',
            fn: async () => {
                const recordId = generateUUID();
                const userId = generateUUID();

                const audit = ReporteAmbientalFactory.createMetadataAudit({
                    target_table: 'findings',
                    record_id: recordId,
                    field_name: 'altitude',
                    original_value: 3380,
                    corrected_value: 3412,
                    reason: 'Ajuste con altímetro barométrico calibrado en estación Laguna Brava',
                    corrected_by: userId
                });

                assert(audit.original_value === '3380', 'Debe conservar el valor original intacto.');
                assert(audit.corrected_value === '3412', 'Debe registrar el valor corregido.');
                assert(audit.corrected_by === userId, 'Debe registrar el usuario responsable.');
                return `Auditoría creada: ${audit.field_name} (${audit.original_value} -> ${audit.corrected_value}).`;
            }
        },
        {
            name: 'Exportación SIG a CSV y GeoJSON (RFC 7946) compatible con QGIS',
            fn: async () => {
                const exporter = new ExportService();
                const sampleFinding = {
                    id: generateUUID(),
                    category: 'foco_degradacion',
                    species_name: null,
                    description: 'Erosión severa en borde de laguna, presencia de residuos',
                    latitude: 7.25641,
                    longitude: -72.88214,
                    altitude: 3385,
                    captured_at: '2025-05-10T14:30:00.000Z',
                    location_source: 'gps',
                    location_accuracy: 4.5,
                    photographs: []
                };

                const csv = exporter.generateCSV([sampleFinding]);
                const geojson = exporter.generateGeoJSON([sampleFinding]);

                assert(
                    csv.includes(sampleFinding.id) && csv.includes('foco_degradacion'),
                    'El CSV generado no incluye los campos obligatorios.'
                );
                assert(
                    geojson.type === 'FeatureCollection' && geojson.features.length === 1,
                    'El GeoJSON debe ser un FeatureCollection válido.'
                );
                const coords = geojson.features[0].geometry.coordinates;
                assert(
                    coords[0] === -72.88214 && coords[1] === 7.25641 && coords[2] === 3385,
                    'El orden de coordenadas GeoJSON para QGIS debe ser [longitude, latitude, altitude].'
                );
                return 'CSV y GeoJSON generados con geometría Point [lng, lat, alt] válida para QGIS.';
            }
        }
    ];

    const results = [];
    for (const t of tests) {
        const start = performance.now();
        try {
            const details = await t.fn();
            results.push({
                suite: 'UNIT',
                name: t.name,
                passed: true,
                details,
                durationMs: Math.round(performance.now() - start)
            });
        } catch (err) {
            results.push({
                suite: 'UNIT',
                name: t.name,
                passed: false,
                details: err.message,
                durationMs: Math.round(performance.now() - start)
            });
        }
    }
    return results;
}