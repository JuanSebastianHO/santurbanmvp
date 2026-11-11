/**
 * @file tests/integration.test.js
 * @description Pruebas de integración para IndexedDB, Trabajo Offline,
 * Recuperación de Conexión, Sincronización Idempotente (sin duplicados),
 * Autorización por Roles y Mapa Leaflet + Heatmap.
 */

import { ENV } from '../js/config/env.js';
import { EventBus } from '../js/core/EventBus.js';
import { ReporteAmbientalFactory, SYNC_STATUS } from '../js/models/ReporteAmbiental.js';
import { LocalReportRepository } from '../js/repositories/LocalReportRepository.js';
import { IndexedDBService } from '../js/services/IndexedDBService.js';
import { SyncService } from '../js/services/SyncService.js';
import { generateUUID } from '../js/utils/uuid.js';
import { AuthViewModel } from '../js/viewmodels/AuthViewModel.js';
import { MapView } from '../js/views/MapView.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Falló aserción en prueba de integración.');
    }
}

export async function runIntegrationTests() {
    const idb = new IndexedDBService();
    await idb.init();

    const tests = [
        {
            name: 'Autenticación y Autorización por Roles desde tabla `profiles` (Guardabosque vs Admin)',
            fn: async () => {
                const rangerId = generateUUID();
                const adminId = generateUUID();

                const mockSupabaseRanger = {
                    getSession: async () => ({
                        user: { id: rangerId, email: 'ranger@santurban.org' }
                    }),
                    getUserProfile: async (uid) => ({
                        id: uid,
                        full_name: 'Guardabosque Prueba',
                        role: ENV.ROLES.RANGER,
                        created_at: new Date().toISOString()
                    })
                };

                const authVmRanger = new AuthViewModel({
                    supabase: mockSupabaseRanger,
                    idb,
                    network: { isOnline: true },
                    eventBus: new EventBus()
                });

                await authVmRanger.initializeSession();
                assert(authVmRanger.isAuthenticated, 'El guardabosque debe estar autenticado.');
                assert(
                    authVmRanger.isRanger && !authVmRanger.isAdmin,
                    'Un usuario con rol guardabosque no debe tener permisos de administrador.'
                );

                // Verificar que el objeto profile devuelto sea inmutable (Object.freeze)
                let mutated = false;
                try {
                    authVmRanger.profile.role = 'admin';
                    mutated = authVmRanger.isAdmin;
                } catch {
                    mutated = false;
                }
                assert(!mutated, 'No se debe permitir que el usuario eleve su propio rol en cliente.');

                return 'Roles resueltos desde perfil y protegidos contra mutación en frontend.';
            }
        },
        {
            name: 'Persistencia en IndexedDB, Trabajo Offline, Recuperación de Conexión e Idempotencia sin duplicados',
            fn: async () => {
                const localRepo = new LocalReportRepository(idb);
                const testUserId = generateUUID();
                const findingId = generateUUID();

                // Base de datos remota simulada en memoria con comportamiento idempotente (Map por UUID)
                const remoteFindingsDb = new Map();
                const remotePhotosDb = new Map();

                const mockRemoteRepo = {
                    upsertExpedition: async (exp) => exp,
                    upsertFinding: async (f) => {
                        remoteFindingsDb.set(f.id, f);
                        return f;
                    },
                    uploadAndUpsertPhotograph: async (p) => {
                        remotePhotosDb.set(p.id, p);
                        return p;
                    },
                    upsertMetadataCorrectionAudit: async (a) => a
                };

                let onlineState = false; // 1. Simulamos Modo Offline en el páramo
                const testBus = new EventBus();
                const mockNetwork = {
                    get isOnline() {
                        return onlineState;
                    },
                    checkConnectivity: async () => onlineState,
                    subscribe: (cb) => testBus.on('net:change', cb)
                };

                const syncEngine = new SyncService({
                    localRepo,
                    remoteRepo: mockRemoteRepo,
                    network: mockNetwork,
                    eventBus: testBus
                });

                // 2. Crear hallazgo con foto estando Offline
                const photoBlob = new Blob(['jpeg-binary-test'], { type: 'image/jpeg' });
                const reporte = ReporteAmbientalFactory.create({
                    id: findingId,
                    created_by: testUserId,
                    category: 'fauna',
                    species_name: 'Tremarctos ornatus',
                    description: 'Avistamiento de oso andino en sector Laguna Grande',
                    latitude: 7.33812,
                    longitude: -72.8619,
                    altitude: 3740,
                    location_accuracy: 4.2,
                    location_source: 'gps',
                    capturedPhotos: [
                        {
                            id: generateUUID(),
                            blob: photoBlob,
                            file_name: 'oso_andino.jpg',
                            mime_type: 'image/jpeg',
                            file_size: photoBlob.size
                        }
                    ]
                });

                await localRepo.saveReporteBundle(reporte);

                // Intentar sincronizar estando Offline -> Debe omitirse y conservar datos locales
                const offlineAttempt = await syncEngine.syncPendingQueue();
                assert(offlineAttempt.skipped === true, 'No debe sincronizar mientras está Offline.');

                const storedBeforeSync = await localRepo.getFindingBundleById(findingId);
                assert(
                    storedBeforeSync.finding.sync_status === SYNC_STATUS.PENDING,
                    'El hallazgo debe permanecer en estado pending mientras no hay red.'
                );

                // 3. Recuperar conexión y ejecutar sincronización dos veces seguidas para probar Idempotencia
                onlineState = true;
                const firstSync = await syncEngine.syncPendingQueue();
                const secondSync = await syncEngine.syncPendingQueue();

                assert(firstSync.syncedCount >= 1, 'La primera sincronización debió subir el hallazgo.');
                assert(
                    secondSync.syncedCount === 0,
                    'La segunda sincronización no debe volver a subir registros ya sincronizados.'
                );
                assert(
                    remoteFindingsDb.size === 1 && remoteFindingsDb.has(findingId),
                    'No deben crearse registros duplicados en el repositorio remoto.'
                );

                const storedAfterSync = await localRepo.getFindingBundleById(findingId);
                assert(
                    storedAfterSync.finding.sync_status === SYNC_STATUS.SYNCED,
                    'El hallazgo local debe marcarse como synced tras confirmar subida.'
                );

                // Limpieza del registro de prueba en IndexedDB
                await idb.delete(ENV.IDB_STORES.FINDINGS, findingId);
                for (const p of storedAfterSync.photographs) {
                    await idb.delete(ENV.IDB_STORES.PHOTOGRAPHS, p.id);
                }

                return 'Ciclo Offline -> IndexedDB -> Reconexión -> Sync Idempotente verificado sin duplicados.';
            }
        },
        {
            name: 'Funcionamiento del Mapa Interactivo Leaflet y Capa de Calor (Leaflet.heat)',
            fn: async () => {
                const mapView = new MapView('test-map-sandbox', {
                    resolvePhotoUrlCallback: async () => null
                });

                mapView.initMap();
                mapView.updateData(
                    [
                        {
                            id: generateUUID(),
                            category: 'foco_degradacion',
                            species_name: null,
                            description: 'Punto de prueba mapa',
                            latitude: 7.2685,
                            longitude: -72.9052,
                            altitude: 3450,
                            location_source: 'gps',
                            captured_at: new Date().toISOString(),
                            photographs: []
                        }
                    ],
                    { fitBounds: true }
                );

                mapView.setHeatmapVisibility(false);
                mapView.setHeatmapVisibility(true);
                mapView.destroy();

                return 'Mapa Leaflet y capa Leaflet.heat inicializados, actualizados y desmontados sin errores.';
            }
        }
    ];

    const results = [];
    for (const t of tests) {
        const start = performance.now();
        try {
            const details = await t.fn();
            results.push({
                suite: 'INTEGRATION',
                name: t.name,
                passed: true,
                details,
                durationMs: Math.round(performance.now() - start)
            });
        } catch (err) {
            results.push({
                suite: 'INTEGRATION',
                name: t.name,
                passed: false,
                details: err.message,
                durationMs: Math.round(performance.now() - start)
            });
        }
    }
    return results;
}