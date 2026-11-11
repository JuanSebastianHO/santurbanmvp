/**
 * @file js/repositories/LocalReportRepository.js
 * @description Repositorio local sobre IndexedDB para el enfoque Offline-First.
 * Garantiza persistencia inmediata en dispositivo y administración de la cola de sincronización.
 */

import { ENV } from '../config/env.js';
import { SYNC_STATUS } from '../models/ReporteAmbiental.js';
import { SyncItem, SYNC_ENTITY_TYPES } from '../models/SyncItem.js';
import { indexedDBService } from '../services/IndexedDBService.js';

export class LocalReportRepository {
    /**
     * @param {import('../services/IndexedDBService.js').IndexedDBService} [idb]
     */
    constructor(idb = indexedDBService) {
        this._idb = idb;
    }

    // =========================================================================
    // HALLAZGOS Y FOTOGRAFÍAS LOCALES
    // =========================================================================

    /**
     * Guarda un ReporteAmbiental completo (hallazgo + fotos comprimidas) en IndexedDB
     * y registra la tarea determinista en `sync_queue`.
     *
     * @param {import('../models/ReporteAmbiental.js').ReporteAmbiental} reporte
     * @returns {Promise<Object>} Registro local guardado.
     */
    async saveReporteBundle(reporte) {
        const localFinding = reporte.toLocalFindingRecord();
        await this._idb.put(ENV.IDB_STORES.FINDINGS, localFinding);

        for (const photo of reporte.photographs) {
            await this._idb.put(ENV.IDB_STORES.PHOTOGRAPHS, {
                ...photo,
                sync_status: SYNC_STATUS.PENDING
            });
        }

        const queueItem = SyncItem.create({
            entityType: SYNC_ENTITY_TYPES.FINDING_BUNDLE,
            entityId: localFinding.id,
            priority: 2
        });
        await this._idb.put(ENV.IDB_STORES.SYNC_QUEUE, queueItem);

        return localFinding;
    }

    /**
     * Obtiene un hallazgo local junto con todas sus fotografías asociadas.
     * @param {string} findingId
     * @returns {Promise<{ finding: Object|null, photographs: Object[] }>}
     */
    async getFindingBundleById(findingId) {
        const finding = await this._idb.getById(ENV.IDB_STORES.FINDINGS, findingId);
        if (!finding) {
            return { finding: null, photographs: [] };
        }
        const photographs = await this._idb.getByIndex(
            ENV.IDB_STORES.PHOTOGRAPHS,
            'by_finding_id',
            findingId
        );
        return { finding, photographs };
    }

    /**
     * Obtiene todos los hallazgos almacenados localmente, ordenados del más reciente al más antiguo.
     * @param {string|null} [userId=null] - Si se especifica, filtra por usuario creador.
     * @returns {Promise<Object[]>}
     */
    async getAllFindings(userId = null) {
        const all = userId
            ? await this._idb.getByIndex(ENV.IDB_STORES.FINDINGS, 'by_created_by', userId)
            : await this._idb.getAll(ENV.IDB_STORES.FINDINGS);

        const allPhotos = await this._idb.getAll(ENV.IDB_STORES.PHOTOGRAPHS);
        const photosByFinding = new Map();

        for (const p of allPhotos) {
            if (!photosByFinding.has(p.finding_id)) {
                photosByFinding.set(p.finding_id, []);
            }
            // Omitimos clonar el Blob pesado al listar si no se requiere, pero mantenemos referencia
            photosByFinding.get(p.finding_id).push(p);
        }

        return all
            .map((f) => ({
                ...f,
                photographs: photosByFinding.get(f.id) || []
            }))
            .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
    }

    /**
     * Marca una fotografía local como sincronizada y libera su Blob binario pesado
     * una vez se ha confirmado su subida a Supabase Storage.
     * Conserva intactos sus metadatos geográficos.
     *
     * @param {string} photoId
     * @param {string} storagePath
     */
    async markPhotoSynced(photoId, storagePath) {
        const existing = await this._idb.getById(ENV.IDB_STORES.PHOTOGRAPHS, photoId);
        if (!existing) return;

        const updated = {
            ...existing,
            storage_path: storagePath,
            blob: null, // Se libera espacio de almacenamiento binario tras confirmar éxito remoto
            sync_status: SYNC_STATUS.SYNCED,
            synced_at: new Date().toISOString()
        };
        await this._idb.put(ENV.IDB_STORES.PHOTOGRAPHS, updated);
    }

    /**
     * Marca un hallazgo local como sincronizado.
     * @param {string} findingId
     */
    async markFindingSynced(findingId) {
        const existing = await this._idb.getById(ENV.IDB_STORES.FINDINGS, findingId);
        if (!existing) return;

        await this._idb.put(ENV.IDB_STORES.FINDINGS, {
            ...existing,
            sync_status: SYNC_STATUS.SYNCED,
            synced_at: new Date().toISOString()
        });
    }

    /**
     * Actualiza el estado de sincronización de un hallazgo local (ej. 'syncing' o 'error').
     * @param {string} findingId
     * @param {string} status
     */
    async updateFindingSyncStatus(findingId, status) {
        const existing = await this._idb.getById(ENV.IDB_STORES.FINDINGS, findingId);
        if (!existing) return;
        await this._idb.put(ENV.IDB_STORES.FINDINGS, {
            ...existing,
            sync_status: status
        });
    }

    // =========================================================================
    // EXPEDICIONES LOCALES
    // =========================================================================

    /**
     * Guarda una expedición creada localmente y la encola con prioridad 1
     * (para que se sincronice antes que cualquier hallazgo que dependa de ella).
     * @param {Object} expedition
     */
    async saveExpedition(expedition) {
        await this._idb.put(ENV.IDB_STORES.EXPEDITIONS, expedition);

        if (expedition.sync_status === SYNC_STATUS.PENDING) {
            const queueItem = SyncItem.create({
                entityType: SYNC_ENTITY_TYPES.EXPEDITION,
                entityId: expedition.id,
                priority: 1
            });
            await this._idb.put(ENV.IDB_STORES.SYNC_QUEUE, queueItem);
        }
        return expedition;
    }

    /**
     * Almacena en caché local una lista de expediciones provenientes de Supabase.
     * @param {Object[]} remoteExpeditions
     */
    async cacheRemoteExpeditions(remoteExpeditions) {
        for (const exp of remoteExpeditions) {
            const existing = await this._idb.getById(ENV.IDB_STORES.EXPEDITIONS, exp.id);
            if (!existing || existing.sync_status === SYNC_STATUS.SYNCED) {
                await this._idb.put(ENV.IDB_STORES.EXPEDITIONS, {
                    ...exp,
                    sync_status: SYNC_STATUS.SYNCED
                });
            }
        }
    }

    /**
     * Obtiene todas las expediciones locales ordenadas por fecha de inicio descendente.
     * @returns {Promise<Object[]>}
     */
    async getAllExpeditions() {
        const list = await this._idb.getAll(ENV.IDB_STORES.EXPEDITIONS);
        return list.sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());
    }

    /**
     *Obtiene una expedición por su ID.
     * @param {string} expeditionId
     */
    async getExpeditionById(expeditionId) {
        return this._idb.getById(ENV.IDB_STORES.EXPEDITIONS, expeditionId);
    }

    /**
     * Marca una expedición local como sincronizada.
     * @param {string} expeditionId
     */
    async markExpeditionSynced(expeditionId) {
        const existing = await this._idb.getById(ENV.IDB_STORES.EXPEDITIONS, expeditionId);
        if (!existing) return;
        await this._idb.put(ENV.IDB_STORES.EXPEDITIONS, {
            ...existing,
            sync_status: SYNC_STATUS.SYNCED
        });
    }

    // =========================================================================
    // AUDITORÍA DE CORRECCIÓN DE METADATOS (REQUISITO #7)
    // =========================================================================

    /**
     * Guarda una corrección auditada de metadatos sin borrar la trazabilidad del original,
     * aplica el cambio en el registro local y encola la sincronización.
     *
     * @param {Object} auditRecord
     */
    async saveMetadataCorrectionAudit(auditRecord) {
        await this._idb.put(ENV.IDB_STORES.METADATA_AUDIT, auditRecord);

        // Si el registro objetivo existe en IndexedDB, aplicamos el valor corregido
        // conservando el registro original intacto en `local_metadata_audit`.
        if (auditRecord.target_table === 'findings') {
            const finding = await this._idb.getById(ENV.IDB_STORES.FINDINGS, auditRecord.record_id);
            if (finding) {
                const parsedValue = this._castCorrectedValue(auditRecord.field_name, auditRecord.corrected_value);
                const updatedFinding = {
                    ...finding,
                    [auditRecord.field_name]: parsedValue,
                    sync_status: SYNC_STATUS.PENDING
                };
                await this._idb.put(ENV.IDB_STORES.FINDINGS, updatedFinding);

                // Re-encolar el hallazgo para que el cambio suba a Supabase si estaba sincronizado
                await this._idb.put(
                    ENV.IDB_STORES.SYNC_QUEUE,
                    SyncItem.create({
                        entityType: SYNC_ENTITY_TYPES.FINDING_BUNDLE,
                        entityId: finding.id,
                        priority: 2
                    })
                );
            }
        }

        const queueItem = SyncItem.create({
            entityType: SYNC_ENTITY_TYPES.METADATA_AUDIT,
            entityId: auditRecord.id,
            priority: 3
        });
        await this._idb.put(ENV.IDB_STORES.SYNC_QUEUE, queueItem);

        return auditRecord;
    }

    /**
     * Obtiene un registro de auditoría local por ID.
     * @param {string} auditId
     */
    async getMetadataAuditById(auditId) {
        return this._idb.getById(ENV.IDB_STORES.METADATA_AUDIT, auditId);
    }

    /**
     * Marca una auditoría local como sincronizada.
     * @param {string} auditId
     */
    async markMetadataAuditSynced(auditId) {
        const existing = await this._idb.getById(ENV.IDB_STORES.METADATA_AUDIT, auditId);
        if (!existing) return;
        await this._idb.put(ENV.IDB_STORES.METADATA_AUDIT, {
            ...existing,
            sync_status: SYNC_STATUS.SYNCED
        });
    }

    /**
     * Obtiene el historial de auditorías de un registro específico.
     * @param {string} recordId
     */
    async getAuditsByRecordId(recordId) {
        return this._idb.getByIndex(ENV.IDB_STORES.METADATA_AUDIT, 'by_record_id', recordId);
    }

    // =========================================================================
    // COLA DE SINCRONIZACIÓN (`sync_queue`)
    // =========================================================================

    /**
     * Obtiene todos los elementos pendientes o con error en la cola de sincronización,
     * ordenados por prioridad (1: Expediciones, 2: Hallazgos, 3: Auditorías) y luego por antigüedad (FIFO).
     * @returns {Promise<Object[]>}
     */
    async getPendingSyncQueue() {
        const allItems = await this._idb.getAll(ENV.IDB_STORES.SYNC_QUEUE);
        return allItems
            .filter((item) => item.status === SYNC_STATUS.PENDING || item.status === SYNC_STATUS.ERROR)
            .sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            });
    }

    /**
     * Actualiza un elemento de la cola de sincronización (ej. registrar reintento o error).
     * @param {Object} queueItem
     */
    async updateSyncQueueItem(queueItem) {
        await this._idb.put(ENV.IDB_STORES.SYNC_QUEUE, {
            ...queueItem,
            updated_at: new Date().toISOString()
        });
    }

    /**
     * Elimina un elemento de la cola únicamente después de confirmar que sincronizó con éxito.
     * @param {string} queueItemId
     */
    async removeSyncQueueItem(queueItemId) {
        await this._idb.delete(ENV.IDB_STORES.SYNC_QUEUE, queueItemId);
    }

    /**
     * Convierte el valor de texto de una corrección al tipo de dato adecuado de la columna.
     * @param {string} fieldName
     * @param {string} rawVal
     */
    _castCorrectedValue(fieldName, rawVal) {
        if (['latitude', 'longitude', 'altitude', 'location_accuracy'].includes(fieldName)) {
            const num = Number(rawVal);
            return Number.isFinite(num) ? num : null;
        }
        return rawVal;
    }
}

export const localReportRepository = new LocalReportRepository();