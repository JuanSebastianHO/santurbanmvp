/**
 * @file js/services/CameraService.js
 * @description Servicio para procesar fotografías capturadas desde cámara móvil o galería,
 * comprimirlas en el dispositivo y adjuntar automáticamente sus metadatos geográficos inmutables.
 */

import { generateUUID } from '../utils/uuid.js';
import { imageCompressionService } from './ImageCompressionService.js';

export class CameraService {
    /**
     * @param {import('./ImageCompressionService.js').ImageCompressionService} [compressionService]
     */
    constructor(compressionService = imageCompressionService) {
        this._compressionService = compressionService;
        /** @type {Set<string>} */
        this._activePreviewUrls = new Set();
    }

    /**
     * Procesa un archivo capturado por el usuario (cámara o dispositivo), lo comprime
     * y empaqueta sus metadatos automáticos de ubicación y fecha.
     *
     * @param {File|Blob} file - Archivo proveniente del input de cámara o galería.
     * @param {Object|null} currentGeoLocation - Ubicación actual del LocationService (puede ser null si aún no hay GPS).
     * @returns {Promise<{
     *   id: string,
     *   blob: Blob,
     *   previewUrl: string,
     *   file_name: string,
     *   mime_type: string,
     *   file_size: number,
     *   original_size: number,
     *   width: number,
     *   height: number,
     *   latitude: number|null,
     *   longitude: number|null,
     *   altitude: number|null,
     *   location_accuracy: number|null,
     *   location_source: string|null,
     *   captured_at: string
     * }>}
     */
    async processCapturedFile(file, currentGeoLocation = null) {
        if (!file) {
            throw new Error('No se recibió ningún archivo fotográfico.');
        }

        const photoId = generateUUID();
        const compressed = await this._compressionService.compressImage(file);
        const previewUrl = this.createPreviewUrl(compressed.blob);

        const safeFileName = this._buildSafeFileName(file.name, photoId);
        const capturedTimestamp = new Date().toISOString();

        // Metadatos automáticos sin inventar coordenadas si no están disponibles
        const hasValidGeo =
            currentGeoLocation &&
            typeof currentGeoLocation.latitude === 'number' &&
            typeof currentGeoLocation.longitude === 'number';

        return {
            id: photoId,
            blob: compressed.blob,
            previewUrl,
            file_name: safeFileName,
            mime_type: compressed.mimeType,
            file_size: compressed.compressedSize,
            original_size: compressed.originalSize,
            width: compressed.width,
            height: compressed.height,
            latitude: hasValidGeo ? currentGeoLocation.latitude : null,
            longitude: hasValidGeo ? currentGeoLocation.longitude : null,
            altitude:
                hasValidGeo && typeof currentGeoLocation.altitude === 'number'
                    ? currentGeoLocation.altitude
                    : null,
            location_accuracy:
                hasValidGeo && typeof currentGeoLocation.location_accuracy === 'number'
                    ? currentGeoLocation.location_accuracy
                    : null,
            location_source: hasValidGeo ? currentGeoLocation.location_source : null,
            captured_at: hasValidGeo && currentGeoLocation.captured_at ? currentGeoLocation.captured_at : capturedTimestamp
        };
    }

    /**
     * Genera una ObjectURL para vista previa en el DOM y la registra para limpieza posterior.
     * @param {Blob} blob
     * @returns {string}
     */
    createPreviewUrl(blob) {
        const url = URL.createObjectURL(blob);
        this._activePreviewUrls.add(url);
        return url;
    }

    /**
     * Libera una URL de vista previa de la memoria del navegador.
     * @param {string} url
     */
    revokePreviewUrl(url) {
        if (url && this._activePreviewUrls.has(url)) {
            URL.revokeObjectURL(url);
            this._activePreviewUrls.delete(url);
        }
    }

    /**
     * Libera todas las vistas previas activas.
     */
    revokeAllPreviews() {
        for (const url of this._activePreviewUrls) {
            URL.revokeObjectURL(url);
        }
        this._activePreviewUrls.clear();
    }

    /**
     * Construye un nombre de archivo limpio con extensión .jpg.
     * @param {string|undefined} originalName
     * @param {string} fallbackId
     * @returns {string}
     */
    _buildSafeFileName(originalName, fallbackId) {
        if (!originalName || typeof originalName !== 'string') {
            return `evidencia_${fallbackId.slice(0, 8)}.jpg`;
        }
        const base = originalName
            .replace(/\.[^/.]+$/, '')
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .slice(0, 50);
        return `${base || 'evidencia'}_${fallbackId.slice(0, 6)}.jpg`;
    }
}

export const cameraService = new CameraService();