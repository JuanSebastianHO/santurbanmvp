/**
 * @file js/repositories/RemoteReportRepository.js
 * @description Repositorio remoto que interactúa con las tablas existentes de Supabase
 * y el bucket privado `evidencias-ambientales`. Todas las escrituras usan `upsert`
 * con el UUID generado en el cliente para garantizar idempotencia.
 */

import { ENV } from '../config/env.js';
import { supabaseService } from '../services/SupabaseService.js';

export class RemoteReportRepository {
    /**
     * @param {import('../services/SupabaseService.js').SupabaseService} [supabase]
     */
    constructor(supabase = supabaseService) {
        this._supabase = supabase;
    }

    // =========================================================================
    // EXPEDICIONES (`public.expeditions`)
    // =========================================================================

    /**
     * Inserta o actualiza una expedición de forma idempotente en `public.expeditions`.
     * @param {Object} expedition
     */
    async upsertExpedition(expedition) {
        const payload = {
            id: expedition.id,
            name: expedition.name,
            description: expedition.description ?? null,
            start_date: expedition.start_date,
            end_date: expedition.end_date ?? null,
            created_by: expedition.created_by,
            created_at: expedition.created_at
        };

        const { data, error } = await this._supabase.client
            .from(ENV.TABLES.EXPEDITIONS)
            .upsert(payload, { onConflict: 'id' })
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Obtiene todas las expediciones autorizadas por RLS.
     * @returns {Promise<Object[]>}
     */
    async fetchExpeditions() {
        const { data, error } = await this._supabase.client
            .from(ENV.TABLES.EXPEDITIONS)
            .select('id, name, description, start_date, end_date, created_by, created_at')
            .order('start_date', { ascending: false });

        if (error) throw error;
        return data || [];
    }

    // =========================================================================
    // HALLAZGOS (`public.findings`) Y FOTOGRAFÍAS (`public.photographs`)
    // =========================================================================

    /**
     * Inserta o actualiza un hallazgo de forma idempotente en `public.findings`.
     * @param {Object} finding
     */
    async upsertFinding(finding) {
        const payload = {
            id: finding.id,
            expedition_id: finding.expedition_id || null,
            created_by: finding.created_by,
            category: finding.category,
            species_name: finding.species_name || null,
            description: finding.description || null,
            latitude: Number(finding.latitude),
            longitude: Number(finding.longitude),
            altitude:
                finding.altitude !== null && finding.altitude !== undefined
                    ? Number(finding.altitude)
                    : null,
            location_accuracy:
                finding.location_accuracy !== null && finding.location_accuracy !== undefined
                    ? Number(finding.location_accuracy)
                    : null,
            location_source: finding.location_source || ENV.LOCATION_SOURCES.GPS,
            captured_at: finding.captured_at,
            created_at: finding.created_at
        };

        const { data, error } = await this._supabase.client
            .from(ENV.TABLES.FINDINGS)
            .upsert(payload, { onConflict: 'id' })
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Sube el Blob comprimido al bucket `evidencias-ambientales` y registra sus metadatos
     * de forma idempotente en la tabla `public.photographs`.
     *
     * @param {Object} photoRecord
     */
    async uploadAndUpsertPhotograph(photoRecord) {
        let storagePath = photoRecord.storage_path;

        // 1. Si hay un Blob binario pendiente por subir, se sube con upsert: true
        if (photoRecord.blob instanceof Blob) {
            storagePath = await this._supabase.uploadPhotographBlob(
                photoRecord.storage_path,
                photoRecord.blob,
                photoRecord.mime_type || ENV.IMAGE_COMPRESSION.MIME_TYPE
            );
        }

        // 2. Upsert de los metadatos en la tabla `photographs`
        const metadataPayload = {
            id: photoRecord.id,
            finding_id: photoRecord.finding_id,
            storage_path: storagePath,
            file_name: photoRecord.file_name || null,
            mime_type: photoRecord.mime_type || ENV.IMAGE_COMPRESSION.MIME_TYPE,
            file_size:
                typeof photoRecord.file_size === 'number'
                    ? photoRecord.file_size
                    : photoRecord.blob?.size || null,
            latitude:
                photoRecord.latitude !== null && photoRecord.latitude !== undefined
                    ? Number(photoRecord.latitude)
                    : null,
            longitude:
                photoRecord.longitude !== null && photoRecord.longitude !== undefined
                    ? Number(photoRecord.longitude)
                    : null,
            altitude:
                photoRecord.altitude !== null && photoRecord.altitude !== undefined
                    ? Number(photoRecord.altitude)
                    : null,
            location_accuracy:
                photoRecord.location_accuracy !== null && photoRecord.location_accuracy !== undefined
                    ? Number(photoRecord.location_accuracy)
                    : null,
            location_source: photoRecord.location_source || null,
            captured_at: photoRecord.captured_at,
            created_at: photoRecord.created_at
        };

        const { data, error } = await this._supabase.client
            .from(ENV.TABLES.PHOTOGRAPHS)
            .upsert(metadataPayload, { onConflict: 'id' })
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    /**
     * Consulta los hallazgos desde Supabase incluyendo sus fotografías asociadas.
     * RLS en Supabase filtra automáticamente según si el usuario es guardabosque o admin.
     *
     * @param {Object} [filters={}]
     * @param {string} [filters.userId] - Filtro opcional por creador.
     * @returns {Promise<Object[]>}
     */
    async fetchFindingsWithPhotographs(filters = {}) {
        let query = this._supabase.client
            .from(ENV.TABLES.FINDINGS)
            .select(
                `
                id,
                expedition_id,
                created_by,
                category,
                species_name,
                description,
                latitude,
                longitude,
                altitude,
                location_accuracy,
                location_source,
                captured_at,
                created_at,
                photographs (
                    id,
                    finding_id,
                    storage_path,
                    file_name,
                    mime_type,
                    file_size,
                    latitude,
                    longitude,
                    altitude,
                    location_accuracy,
                    location_source,
                    captured_at,
                    created_at
                )
            `
            )
            .order('captured_at', { ascending: false });

        if (filters.userId) {
            query = query.eq('created_by', filters.userId);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    }

    // =========================================================================
    // AUDITORÍA DE METADATOS (`public.metadata_corrections_audit`)
    // =========================================================================

    /**
     * Registra de forma idempotente una corrección auditada de metadatos en Supabase
     * y actualiza el campo correspondiente en la tabla objetivo.
     *
     * @param {Object} auditRecord
     */
    async upsertMetadataCorrectionAudit(auditRecord) {
        const payload = {
            id: auditRecord.id,
            target_table: auditRecord.target_table,
            record_id: auditRecord.record_id,
            field_name: auditRecord.field_name,
            original_value: auditRecord.original_value,
            corrected_value: auditRecord.corrected_value,
            reason: auditRecord.reason,
            corrected_by: auditRecord.corrected_by,
            corrected_at: auditRecord.corrected_at
        };

        const { data, error } = await this._supabase.client
            .from(ENV.TABLES.METADATA_AUDIT)
            .upsert(payload, { onConflict: 'id' })
            .select()
            .single();

        if (error) throw error;

        // Aplicamos el cambio auditado sobre la tabla principal si el campo es editable
        const allowedFields = [
            'species_name',
            'description',
            'category',
            'altitude',
            'latitude',
            'longitude'
        ];
        if (allowedFields.includes(auditRecord.field_name)) {
            let valueToUpdate = auditRecord.corrected_value;
            if (['latitude', 'longitude', 'altitude'].includes(auditRecord.field_name)) {
                valueToUpdate = Number(auditRecord.corrected_value);
            }

            await this._supabase.client
                .from(auditRecord.target_table)
                .update({ [auditRecord.field_name]: valueToUpdate })
                .eq('id', auditRecord.record_id);
        }

        return data;
    }

    /**
     * Obtiene el historial de correcciones auditadas de metadatos.
     * @param {string} [recordId]
     * @returns {Promise<Object[]>}
     */
    async fetchMetadataAudits(recordId = null) {
        let query = this._supabase.client
            .from(ENV.TABLES.METADATA_AUDIT)
            .select('*')
            .order('corrected_at', { ascending: false });

        if (recordId) {
            query = query.eq('record_id', recordId);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    }

    // =========================================================================
    // ALERTAS Y NOTIFICACIONES (`public.notifications`)
    // =========================================================================

    /**
     * Obtiene las notificaciones y alertas (ej. `foco_degradacion`).
     * @returns {Promise<Object[]>}
     */
    async fetchNotifications() {
        const { data, error } = await this._supabase.client
            .from(ENV.TABLES.NOTIFICATIONS)
            .select('id, user_id, finding_id, title, message, notification_type, is_read, created_at')
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;
        return data || [];
    }

    /**
     * Marca una notificación como leída.
     * @param {string} notificationId
     */
    async markNotificationAsRead(notificationId) {
        const { error } = await this._supabase.client
            .from(ENV.TABLES.NOTIFICATIONS)
            .update({ is_read: true })
            .eq('id', notificationId);

        if (error) throw error;
    }
}

export const remoteReportRepository = new RemoteReportRepository();