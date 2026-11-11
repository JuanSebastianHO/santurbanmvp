/**
 * @file js/core/Validator.js
 * @description Validaciones de dominio para coordenadas GPS, categorías,
 * altitudes y metadatos. Garantiza que nunca se inventen valores faltantes.
 */

import { ENV } from '../config/env.js';
import { isValidUUID } from '../utils/uuid.js';

const VALID_CATEGORY_IDS = new Set(ENV.FINDING_CATEGORIES.map((c) => c.id));
const VALID_LOCATION_SOURCES = new Set(Object.values(ENV.LOCATION_SOURCES));

export class Validator {
    /**
     * Valida que la latitud sea un número finito entre -90 y 90.
     * @param {unknown} lat
     * @returns {boolean}
     */
    static isValidLatitude(lat) {
        return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
    }

    /**
     * Valida que la longitud sea un número finito entre -180 y 180.
     * @param {unknown} lng
     * @returns {boolean}
     */
    static isValidLongitude(lng) {
        return typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
    }

    /**
     * Valida que una altitud sea null (no disponible) o un número plausible en metros (-500 a 9000).
     * No inventa 0 cuando el dispositivo no entrega altitud.
     * @param {unknown} alt
     * @returns {boolean}
     */
    static isValidOptionalAltitude(alt) {
        if (alt === null || alt === undefined) return true;
        return typeof alt === 'number' && Number.isFinite(alt) && alt >= -500 && alt <= 9000;
    }

    /**
     * Valida que la precisión horizontal sea null o un número positivo.
     * @param {unknown} accuracy
     * @returns {boolean}
     */
    static isValidOptionalAccuracy(accuracy) {
        if (accuracy === null || accuracy === undefined) return true;
        return typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0;
    }

    /**
     * Valida categoría contra el catálogo permitido.
     * @param {string} category
     * @returns {boolean}
     */
    static isValidCategory(category) {
        return typeof category === 'string' && VALID_CATEGORY_IDS.has(category);
    }

    /**
     * Valida fuente de ubicación ('gps' o 'simulated').
     * @param {string} source
     * @returns {boolean}
     */
    static isValidLocationSource(source) {
        return typeof source === 'string' && VALID_LOCATION_SOURCES.has(source);
    }

    /**
     * Sanitiza un texto de entrada removiendo etiquetas de control y espacios extremos.
     * @param {unknown} input
     * @param {number} [maxLength=1000]
     * @returns {string|null}
     */
    static sanitizeOptionalText(input, maxLength = 1000) {
        if (input === null || input === undefined) return null;
        const cleaned = String(input)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
            .trim();
        if (cleaned.length === 0) return null;
        return cleaned.slice(0, maxLength);
    }

    /**
     * Valida un objeto completo de hallazgo antes de instanciarlo o guardarlo.
     * @param {Object} data
     * @returns {{ isValid: boolean, errors: string[] }}
     */
    static validateFindingPayload(data) {
        const errors = [];

        if (!data || typeof data !== 'object') {
            return { isValid: false, errors: ['Los datos del hallazgo son inválidos.'] };
        }

        if (!isValidUUID(data.id)) {
            errors.push('El identificador del hallazgo debe ser un UUID v4 válido.');
        }

        if (!isValidUUID(data.created_by)) {
            errors.push('El identificador del usuario creador (created_by) es obligatorio.');
        }

        if (data.expedition_id !== null && data.expedition_id !== undefined && !isValidUUID(data.expedition_id)) {
            errors.push('El identificador de expedición no tiene un formato UUID válido.');
        }

        if (!Validator.isValidCategory(data.category)) {
            errors.push('Seleccione una categoría de hallazgo válida.');
        }

        // Si la categoría es especie_nativa, el nombre de la especie es requerido
        if (data.category === 'especie_nativa') {
            const species = Validator.sanitizeOptionalText(data.species_name, 200);
            if (!species) {
                errors.push('El nombre de la especie es obligatorio para la categoría "Especie nativa".');
            }
        }

        if (!Validator.isValidLatitude(data.latitude)) {
            errors.push('La latitud es obligatoria y debe estar entre -90° y 90°.');
        }

        if (!Validator.isValidLongitude(data.longitude)) {
            errors.push('La longitud es obligatoria y debe estar entre -180° y 180°.');
        }

        if (!Validator.isValidOptionalAltitude(data.altitude)) {
            errors.push('La altitud proporcionada no es un valor numérico válido.');
        }

        if (!Validator.isValidOptionalAccuracy(data.location_accuracy)) {
            errors.push('La precisión de ubicación debe ser un número positivo.');
        }

        if (!Validator.isValidLocationSource(data.location_source)) {
            errors.push('La fuente de ubicación debe ser "gps" o "simulated".');
        }

        if (!data.captured_at || Number.isNaN(new Date(data.captured_at).getTime())) {
            errors.push('La fecha y hora de captura (captured_at) son obligatorias.');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}