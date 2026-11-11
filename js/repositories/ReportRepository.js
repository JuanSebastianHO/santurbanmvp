/**
 * @file js/repositories/ReportRepository.js
 * @description Repositorio coordinador Offline-First que abstrae LocalReportRepository
 * y RemoteReportRepository para la capa de aplicación (ViewModels).
 */

import { appEventBus, EVENTS } from '../core/EventBus.js';
import { ReporteAmbientalFactory, SYNC_STATUS } from '../models/ReporteAmbiental.js';
import { networkMonitor } from '../services/NetworkMonitor.js';
import { supabaseService } from '../services/SupabaseService.js';
import { localReportRepository } from './LocalReportRepository.js';
import { remoteReportRepository } from './RemoteReportRepository.js';

export class ReportRepository {
    /**
     * @param {Object} [deps]
     */
    constructor({
        localRepo = localReportRepository,
        remoteRepo = remoteReportRepository,
        network = networkMonitor,
        supabase = supabaseService,
        eventBus = appEventBus
    } = {}) {
        this._local = localRepo;
        this._remote = remoteRepo;
        this._network = network;
        this._supabase = supabase;
        this._eventBus = eventBus;
    }

    /**
     * Registra un nuevo Hallazgo Ambiental junto con sus fotografías comprimidas.
     * Enfoque Offline-First: siempre se persiste en IndexedDB primero y se encola.
     *
     * @param {Object} findingInput
     * @returns {Promise<Object>}
     */
    async createFindingReport(findingInput) {
        const reporteEntity = ReporteAmbientalFactory.create(findingInput);
        const savedLocal = await this._local.saveReporteBundle(reporteEntity);

        this._eventBus.emit(EVENTS.FINDING_CREATED_LOCAL, savedLocal);
        await this._emitQueueCount();

        if (savedLocal.category === 'foco_degradacion') {
            this._eventBus.emit(EVENTS.DEGRADATION_ALERT, {
                finding: savedLocal,
                isSynced: false
            });
        }

        return savedLocal;
    }

    /**
     * Crea una nueva expedición bajo enfoque Offline-First.
     * @param {Object} expeditionInput
     * @returns {Promise<Object>}
     */
    async createExpedition(expeditionInput) {
        const expedition = ReporteAmbientalFactory.createExpedition(expeditionInput);
        await this._local.saveExpedition(expedition);
        await this._emitQueueCount();
        return expedition;
    }

    /**
     * Registra una corrección auditada de metadatos conservando el valor original.
     * @param {Object} auditInput
     * @returns {Promise<Object>}
     */
    async registerMetadataCorrection(auditInput) {
        const auditRecord = ReporteAmbientalFactory.createMetadataAudit(auditInput);
        await this._local.saveMetadataCorrectionAudit(auditRecord);
        await this._emitQueueCount();
        return auditRecord;
    }

    /**
     * Obtiene la lista unificada de expediciones (remotas + locales pendientes) sin duplicados.
     * @returns {Promise<Object[]>}
     */
    async getExpeditions() {
        if (this._network.isOnline) {
            try {
                const remoteList = await this._remote.fetchExpeditions();
                await this._local.cacheRemoteExpeditions(remoteList);
            } catch (err) {
                console.warn('[ReportRepository] Usando expediciones de IndexedDB (modo offline):', err.message);
            }
        }
        return this._local.getAllExpeditions();
    }

    /**
     * Obtiene la lista unificada de hallazgos (combinando registros de Supabase con
     * los registros locales pendientes en IndexedDB sin duplicar por UUID).
     *
     * @param {Object} [options={}]
     * @param {string|null} [options.userId=null] - Si se pasa, filtra por usuario (para Guardabosque).
     * @returns {Promise<Object[]>}
     */
    async getUnifiedFindings(options = {}) {
        const localFindings = await this._local.getAllFindings(options.userId || null);
        const mergedMap = new Map();

        // 1. Primero insertamos los registros locales (tienen prioridad si están 'pending' o 'error')
        for (const localItem of localFindings) {
            mergedMap.set(localItem.id, localItem);
        }

        // 2. Si hay conexión, consultamos Supabase y fusionamos
        if (this._network.isOnline) {
            try {
                const remoteFindings = await this._remote.fetchFindingsWithPhotographs({
                    userId: options.userId || undefined
                });

                for (const remoteItem of remoteFindings) {
                    const existingLocal = mergedMap.get(remoteItem.id);

                    // Si no existe localmente o ya estaba sincronizado, usamos la versión autoritativa remota
                    if (!existingLocal || existingLocal.sync_status === SYNC_STATUS.SYNCED) {
                        mergedMap.set(remoteItem.id, {
                            ...remoteItem,
                            photographs: remoteItem.photographs || [],
                            sync_status: SYNC_STATUS.SYNCED
                        });
                    }
                }
            } catch (err) {
                console.warn('[ReportRepository] Falló consulta remota de hallazgos, sirviendo datos locales:', err.message);
            }
        }

        return Array.from(mergedMap.values()).sort(
            (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
        );
    }

    /**
     * Obtiene las notificaciones remotas combinadas con las alertas locales pendientes de `foco_degradacion`.
     * Diferencia claramente registros pendientes de registros sincronizados (Requisito #12).
     *
     * @returns {Promise<Object[]>}
     */
    async getUnifiedAlertsAndNotifications() {
        const localFindings = await this._local.getAllFindings(null);
        const pendingDegradationAlerts = localFindings
            .filter((f) => f.category === 'foco_degradacion' && f.sync_status !== SYNC_STATUS.SYNCED)
            .map((f) => ({
                id: `local-alert-${f.id}`,
                finding_id: f.id,
                title: 'Alerta Local (Pendiente de Sincronizar): Foco de Degradación',
                message: `Coordenadas (${Number(f.latitude).toFixed(5)}, ${Number(f.longitude).toFixed(5)}). ${
                    f.description || 'Sin descripción.'
                }`,
                notification_type: 'foco_degradacion',
                is_read: false,
                created_at: f.captured_at,
                sync_status: f.sync_status
            }));

        let remoteNotifications = [];
        if (this._network.isOnline) {
            try {
                const fetched = await this._remote.fetchNotifications();
                remoteNotifications = fetched.map((n) => ({
                    ...n,
                    sync_status: SYNC_STATUS.SYNCED
                }));
            } catch (err) {
                console.warn('[ReportRepository] No fue posible consultar notificaciones remotas:', err.message);
            }
        }

        // Evitar duplicados si una alerta local ya aparece en las remotas por finding_id
        const remoteFindingIds = new Set(remoteNotifications.map((n) => n.finding_id).filter(Boolean));
        const uniqueLocalAlerts = pendingDegradationAlerts.filter((a) => !remoteFindingIds.has(a.finding_id));

        return [...uniqueLocalAlerts, ...remoteNotifications].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
    }

    /**
     * Obtiene URL visualizable para una fotografía (sea un Blob local en IndexedDB o un path privado en Supabase Storage).
     * @param {Object} photo
     * @returns {Promise<string|null>}
     */
    async resolvePhotoUrl(photo) {
        if (!photo) return null;
        if (photo.blob instanceof Blob) {
            return URL.createObjectURL(photo.blob);
        }
        if (photo.storage_path && this._network.isOnline) {
            return this._supabase.getSignedPhotoUrl(photo.storage_path);
        }
        return null;
    }

    /**
     * Obtiene la cantidad de elementos pendientes en la cola de sincronización.
     * @returns {Promise<number>}
     */
    async getPendingSyncCount() {
        const queue = await this._local.getPendingSyncQueue();
        return queue.length;
    }

    async _emitQueueCount() {
        const count = await this.getPendingSyncCount();
        this._eventBus.emit(EVENTS.QUEUE_UPDATED, { pendingCount: count });
    }
}

export const reportRepository = new ReportRepository();