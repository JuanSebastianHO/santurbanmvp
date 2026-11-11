/**
 * @file js/services/SyncService.js
 * @description Motor de sincronización idempotente Offline-First.
 * Observa cambios de red en NetworkMonitor y procesa la cola local respetando
 * integridad referencial: Expediciones -> Hallazgos -> Fotografías -> Auditorías.
 */

import { appEventBus, EVENTS } from '../core/EventBus.js';
import { SYNC_STATUS } from '../models/ReporteAmbiental.js';
import { SYNC_ENTITY_TYPES } from '../models/SyncItem.js';
import { localReportRepository } from '../repositories/LocalReportRepository.js';
import { remoteReportRepository } from '../repositories/RemoteReportRepository.js';
import { networkMonitor } from './NetworkMonitor.js';

export class SyncService {
    /**
     * @param {Object} [deps]
     */
    constructor({
        localRepo = localReportRepository,
        remoteRepo = remoteReportRepository,
        network = networkMonitor,
        eventBus = appEventBus
    } = {}) {
        this._local = localRepo;
        this._remote = remoteRepo;
        this._network = network;
        this._eventBus = eventBus;

        this._isSyncing = false;
        this._maxRetries = 5;

        // Suscripción mediante Patrón Observer a la recuperación de conectividad
        this._network.subscribe(async ({ isOnline }) => {
            if (isOnline) {
                await this.syncPendingQueue({ source: 'auto_reconnect' });
            }
        });
    }

    get isSyncing() {
        return this._isSyncing;
    }

    /**
     * Ejecuta el procesamiento idempotente de la cola de sincronización.
     * Protegido por mutex `_isSyncing` para evitar ejecuciones simultáneas.
     *
     * @param {Object} [options={}]
     * @param {string} [options.source='manual']
     * @returns {Promise<{ syncedCount: number, failedCount: number, skipped: boolean }>}
     */
    async syncPendingQueue(options = {}) {
        if (this._isSyncing) {
            return { syncedCount: 0, failedCount: 0, skipped: true };
        }

        const isReachable = await this._network.checkConnectivity();
        if (!isReachable) {
            return { syncedCount: 0, failedCount: 0, skipped: true };
        }

        const pendingItems = await this._local.getPendingSyncQueue();
        await this._emitQueueUpdated();

        if (pendingItems.length === 0) {
            return { syncedCount: 0, failedCount: 0, skipped: false };
        }

        this._isSyncing = true;
        let syncedCount = 0;
        let failedCount = 0;

        this._eventBus.emit(EVENTS.SYNC_STARTED, {
            total: pendingItems.length,
            source: options.source || 'manual'
        });

        try {
            for (let i = 0; i < pendingItems.length; i++) {
                const item = pendingItems[i];

                this._eventBus.emit(EVENTS.SYNC_PROGRESS, {
                    current: i + 1,
                    total: pendingItems.length,
                    entityType: item.entity_type,
                    entityId: item.entity_id
                });

                try {
                    await this._processQueueItem(item);
                    // Solo se remueve de la cola tras confirmar que todas las operaciones remotas tuvieron éxito
                    await this._local.removeSyncQueueItem(item.id);
                    syncedCount++;
                } catch (error) {
                    failedCount++;
                    const nextRetry = (item.retry_count || 0) + 1;
                    await this._local.updateSyncQueueItem({
                        ...item,
                        status: SYNC_STATUS.ERROR,
                        retry_count: nextRetry,
                        last_error: error.message || 'Error de sincronización con Supabase'
                    });

                    if (item.entity_type === SYNC_ENTITY_TYPES.FINDING_BUNDLE) {
                        await this._local.updateFindingSyncStatus(item.entity_id, SYNC_STATUS.ERROR);
                    }

                    console.error(`[SyncService] Falló sincronización de ${item.id}:`, error);
                }
            }
        } finally {
            this._isSyncing = false;
            await this._emitQueueUpdated();

            this._eventBus.emit(EVENTS.SYNC_COMPLETED, {
                syncedCount,
                failedCount,
                totalProcessed: pendingItems.length
            });

            if (failedCount > 0) {
                this._eventBus.emit(EVENTS.SYNC_ERROR, {
                    message: `${failedCount} registro(s) no pudieron sincronizarse y permanecen seguros en el dispositivo para reintento.`
                });
            }
        }

        return { syncedCount, failedCount, skipped: false };
    }

    /**
     * Procesa un ítem individual según su tipo de entidad.
     * @param {Object} item
     */
    async _processQueueItem(item) {
        switch (item.entity_type) {
            case SYNC_ENTITY_TYPES.EXPEDITION:
                await this._syncExpeditionItem(item.entity_id);
                break;

            case SYNC_ENTITY_TYPES.FINDING_BUNDLE:
                await this._syncFindingBundleItem(item.entity_id);
                break;

            case SYNC_ENTITY_TYPES.METADATA_AUDIT:
                await this._syncMetadataAuditItem(item.entity_id);
                break;

            default:
                throw new Error(`Tipo de entidad desconocido en cola: ${item.entity_type}`);
        }
    }

    async _syncExpeditionItem(expeditionId) {
        const localExp = await this._local.getExpeditionById(expeditionId);
        if (!localExp) return;

        await this._remote.upsertExpedition(localExp);
        await this._local.markExpeditionSynced(expeditionId);
    }

    /**
     * Sincroniza un hallazgo y todas sus fotografías asociadas manteniendo la integridad referencial.
     * 1. Si el hallazgo referencia una expedición local pendiente, la sincroniza primero.
     * 2. Hace upsert del hallazgo en `public.findings`.
     * 3. Sube cada fotografía a `evidencias-ambientales` y hace upsert en `public.photographs`.
     * 4. Marca hallazgo y fotos como `synced`.
     *
     * @param {string} findingId
     */
    async _syncFindingBundleItem(findingId) {
        const { finding, photographs } = await this._local.getFindingBundleById(findingId);
        if (!finding) return;

        await this._local.updateFindingSyncStatus(findingId, SYNC_STATUS.SYNCING);

        // Verificar si tiene expedición asociada aún no sincronizada
        if (finding.expedition_id) {
            const exp = await this._local.getExpeditionById(finding.expedition_id);
            if (exp && exp.sync_status !== SYNC_STATUS.SYNCED) {
                await this._remote.upsertExpedition(exp);
                await this._local.markExpeditionSynced(exp.id);
            }
        }

        // Paso 1: Upsert del Hallazgo en PostgreSQL
        await this._remote.upsertFinding(finding);

        // Paso 2: Subida de Blobs y Upsert de cada fotografía vinculada
        for (const photo of photographs) {
            if (photo.sync_status !== SYNC_STATUS.SYNCED) {
                const remotePhoto = await this._remote.uploadAndUpsertPhotograph(photo);
                await this._local.markPhotoSynced(photo.id, remotePhoto.storage_path);
            }
        }

        // Paso 3: Confirmar hallazgo como sincronizado
        await this._local.markFindingSynced(findingId);
    }

    async _syncMetadataAuditItem(auditId) {
        const auditRecord = await this._local.getMetadataAuditById(auditId);
        if (!auditRecord) return;

        await this._remote.upsertMetadataCorrectionAudit(auditRecord);
        await this._local.markMetadataAuditSynced(auditId);
    }

    async _emitQueueUpdated() {
        const queue = await this._local.getPendingSyncQueue();
        this._eventBus.emit(EVENTS.QUEUE_UPDATED, { pendingCount: queue.length });
    }
}

export const syncService = new SyncService();