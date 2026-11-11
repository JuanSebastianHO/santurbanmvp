/**
 * @file js/models/SyncItem.js
 * @description Modelo de elemento para la cola de sincronización Offline-First.
 * Permite rastrear intentos, errores y tipo de entidad sin generar duplicados.
 */

import { SYNC_STATUS } from './ReporteAmbiental.js';

export const SYNC_ENTITY_TYPES = Object.freeze({
    EXPEDITION: 'EXPEDITION',
    FINDING_BUNDLE: 'FINDING_BUNDLE',
    METADATA_AUDIT: 'METADATA_AUDIT'
});

export class SyncItem {
    /**
     * Construye un elemento de cola determinista cuyo ID se basa en el tipo y UUID de la entidad.
     * Así, encolar dos veces la misma entidad sobrescribe el item en cola sin duplicar tareas.
     *
     * @param {Object} params
     * @param {'EXPEDITION'|'FINDING_BUNDLE'|'METADATA_AUDIT'} params.entityType
     * @param {string} params.entityId - UUID del hallazgo, expedición o auditoría.
     * @param {number} [params.priority=1] - Prioridad (1: Expedición, 2: Hallazgo+Fotos, 3: Auditoría).
     */
    static create({ entityType, entityId, priority = 2 }) {
        if (!entityType || !entityId) {
            throw new Error('SyncItem requiere entityType y entityId.');
        }

        return {
            id: `${entityType}:${entityId}`,
            entity_type: entityType,
            entity_id: entityId,
            priority,
            status: SYNC_STATUS.PENDING,
            retry_count: 0,
            last_error: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
    }
}