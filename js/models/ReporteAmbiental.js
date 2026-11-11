/**
 * @file js/models/ReporteAmbiental.js
 * @description Entidad de dominio ReporteAmbiental, Fotografías asociadas y
 * patrón Factory/Builder para garantizar que solo se creen reportes válidos
 * alineados con el esquema PostgreSQL de Supabase.
 */

import { ENV } from '../config/env.js';
import { Validator } from '../core/Validator.js';
import { generateUUID, isValidUUID } from '../utils/uuid.js';

export const SYNC_STATUS = Object.freeze({
    PENDING: 'pending',
    SYNCING: 'syncing',
    SYNCED: 'synced',
    ERROR: 'error'
});

/**
 * Entidad de Dominio que representa un Hallazgo Ambiental junto con sus fotografías.
 */
export class ReporteAmbiental {
    /**
     * @param {Object} findingRecord - Columnas compatibles con tabla `findings`.
     * @param {Array<Object>} photographs - Lista de fotografías compatibles con tabla `photographs`.
     * @param {string} [syncStatus='pending']
     */
    constructor(findingRecord, photographs = [], syncStatus = SYNC_STATUS.PENDING) {
        this.finding = Object.freeze({ ...findingRecord });
        this.photographs = Object.freeze(photographs.map((p) => Object.freeze({ ...p })));
        this.sync_status = syncStatus;
    }

    /**
     * Retorna el payload exacto para hacer upsert en la tabla `public.findings` de Supabase.
     */
    toRemoteFindingPayload() {
        return {
            id: this.finding.id,
            expedition_id: this.finding.expedition_id || null,
            created_by: this.finding.created_by,
            category: this.finding.category,
            species_name: this.finding.species_name || null,
            description: this.finding.description || null,
            latitude: this.finding.latitude,
            longitude: this.finding.longitude,
            altitude: this.finding.altitude ?? null,
            location_accuracy: this.finding.location_accuracy ?? null,
            location_source: this.finding.location_source,
            captured_at: this.finding.captured_at,
            created_at: this.finding.created_at
        };
    }

    /**
     * Retorna el objeto para almacenar localmente en IndexedDB (`local_findings`).
     */
    toLocalFindingRecord() {
        return {
            ...this.toRemoteFindingPayload(),
            sync_status: this.sync_status,
            photo_count: this.photographs.length
        };
    }
}

/**
 * Factory y Builder para construir instancias válidas de ReporteAmbiental,
 * Expediciones y Auditorías de Corrección de Metadatos.
 */
export class ReporteAmbientalFactory {
    /**
     * Crea y valida un ReporteAmbiental completo (Hallazgo + Fotografías vinculadas).
     *
     * @param {Object} params
     * @param {string} [params.id] - UUID opcional (se genera en cliente si no viene).
     * @param {string|null} [params.expedition_id]
     * @param {string} params.created_by - UUID del usuario autenticado.
     * @param {string} params.category
     * @param {string|null} [params.species_name]
     * @param {string|null} [params.description]
     * @param {number} params.latitude
     * @param {number} params.longitude
     * @param {number|null} [params.altitude]
     * @param {number|null} [params.location_accuracy]
     * @param {'gps'|'simulated'} params.location_source
     * @param {string} [params.captured_at]
     * @param {Array<Object>} [params.capturedPhotos=[]] - Fotos procesadas por CameraService.
     * @returns {ReporteAmbiental}
     */
    static create(params) {
        const nowIso = new Date().toISOString();
        const findingId = params.id && isValidUUID(params.id) ? params.id : generateUUID();

        const findingCandidate = {
            id: findingId,
            expedition_id: params.expedition_id || null,
            created_by: params.created_by,
            category: params.category,
            species_name: Validator.sanitizeOptionalText(params.species_name, 200),
            description: Validator.sanitizeOptionalText(params.description, 2000),
            latitude: typeof params.latitude === 'number' ? Number(params.latitude) : Number.NaN,
            longitude: typeof params.longitude === 'number' ? Number(params.longitude) : Number.NaN,
            altitude:
                params.altitude !== null && params.altitude !== undefined && params.altitude !== ''
                    ? Number(params.altitude)
                    : null,
            location_accuracy:
                params.location_accuracy !== null &&
                params.location_accuracy !== undefined &&
                params.location_accuracy !== ''
                    ? Number(params.location_accuracy)
                    : null,
            location_source: params.location_source || ENV.LOCATION_SOURCES.GPS,
            captured_at: params.captured_at || nowIso,
            created_at: params.created_at || nowIso
        };

        const validation = Validator.validateFindingPayload(findingCandidate);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(' '));
        }

        const rawPhotos = Array.isArray(params.capturedPhotos) ? params.capturedPhotos : [];
        const normalizedPhotos = rawPhotos.map((photo) => {
            const photoId = photo.id && isValidUUID(photo.id) ? photo.id : generateUUID();
            const fileName = photo.file_name || `evidencia_${photoId.slice(0, 8)}.jpg`;

            // Ruta compatible con políticas de Storage por carpeta de usuario: {userId}/{findingId}/{photoId}.jpg
            const storagePath =
                photo.storage_path || `${findingCandidate.created_by}/${findingId}/${photoId}.jpg`;

            // Si la foto fue tomada antes de fijar coordenadas en el formulario, hereda las del hallazgo
            // pero si ya tenía coordenadas propias de captura automática, las conserva inmutables.
            const photoLat =
                typeof photo.latitude === 'number' && Number.isFinite(photo.latitude)
                    ? photo.latitude
                    : findingCandidate.latitude;
            const photoLng =
                typeof photo.longitude === 'number' && Number.isFinite(photo.longitude)
                    ? photo.longitude
                    : findingCandidate.longitude;
            const photoAlt =
                photo.altitude !== null && photo.altitude !== undefined
                    ? photo.altitude
                    : findingCandidate.altitude;
            const photoAcc =
                photo.location_accuracy !== null && photo.location_accuracy !== undefined
                    ? photo.location_accuracy
                    : findingCandidate.location_accuracy;
            const photoSource = photo.location_source || findingCandidate.location_source;

            return {
                id: photoId,
                finding_id: findingId,
                storage_path: storagePath,
                file_name: fileName,
                mime_type: photo.mime_type || ENV.IMAGE_COMPRESSION.MIME_TYPE,
                file_size: typeof photo.file_size === 'number' ? photo.file_size : photo.blob?.size || null,
                latitude: photoLat,
                longitude: photoLng,
                altitude: photoAlt,
                location_accuracy: photoAcc,
                location_source: photoSource,
                captured_at: photo.captured_at || findingCandidate.captured_at,
                created_at: nowIso,
                blob: photo.blob || null,
                sync_status: SYNC_STATUS.PENDING
            };
        });

        return new ReporteAmbiental(findingCandidate, normalizedPhotos, SYNC_STATUS.PENDING);
    }

    /**
     * Crea un registro de Expedición válido compatible con la tabla `public.expeditions`.
     * @param {Object} params
     * @param {string} params.name
     * @param {string|null} [params.description]
     * @param {string} params.created_by
     * @param {string} [params.start_date]
     * @param {string|null} [params.end_date]
     */
    static createExpedition(params) {
        const cleanName = Validator.sanitizeOptionalText(params?.name, 150);
        if (!cleanName) {
            throw new Error('El nombre de la expedición es obligatorio.');
        }
        if (!isValidUUID(params?.created_by)) {
            throw new Error('El creador de la expedición debe tener un UUID válido.');
        }

        const nowIso = new Date().toISOString();
        return Object.freeze({
            id: params.id && isValidUUID(params.id) ? params.id : generateUUID(),
            name: cleanName,
            description: Validator.sanitizeOptionalText(params.description, 1000),
            start_date: params.start_date || nowIso,
            end_date: params.end_date || null,
            created_by: params.created_by,
            created_at: nowIso,
            sync_status: SYNC_STATUS.PENDING
        });
    }

    /**
     * Crea un registro de corrección auditada de metadatos (Requisito #7).
     * Conserva el valor original, el valor corregido, el motivo, la fecha y el usuario responsable.
     *
     * @param {Object} params
     * @param {'findings'|'photographs'} params.target_table
     * @param {string} params.record_id
     * @param {string} params.field_name
     * @param {any} params.original_value
     * @param {any} params.corrected_value
     * @param {string} params.reason
     * @param {string} params.corrected_by
     */
    static createMetadataAudit(params) {
        if (!['findings', 'photographs'].includes(params.target_table)) {
            throw new Error('La tabla objetivo de auditoría debe ser "findings" o "photographs".');
        }
        if (!isValidUUID(params.record_id)) {
            throw new Error('El identificador del registro a auditar no es un UUID válido.');
        }
        if (!isValidUUID(params.corrected_by)) {
            throw new Error('El identificador del usuario responsable no es un UUID válido.');
        }

        const cleanReason = Validator.sanitizeOptionalText(params.reason, 500);
        if (!cleanReason) {
            throw new Error('Debe especificar una justificación técnica para la corrección del metadato.');
        }

        if (params.corrected_value === null || params.corrected_value === undefined || String(params.corrected_value).trim() === '') {
            throw new Error('El valor corregido no puede estar vacío.');
        }

        return Object.freeze({
            id: generateUUID(),
            target_table: params.target_table,
            record_id: params.record_id,
            field_name: String(params.field_name).trim(),
            original_value:
                params.original_value !== null && params.original_value !== undefined
                    ? String(params.original_value)
                    : null,
            corrected_value: String(params.corrected_value).trim(),
            reason: cleanReason,
            corrected_by: params.corrected_by,
            corrected_at: new Date().toISOString(),
            sync_status: SYNC_STATUS.PENDING
        });
    }
}