/**
 * @file js/services/ImageCompressionService.js
 * @description Servicio con responsabilidad única (SRP) para comprimir y redimensionar
 * fotografías en el cliente usando HTML5 Canvas antes de almacenarlas en IndexedDB o subirlas.
 */

import { ENV } from '../config/env.js';

export class ImageCompressionService {
    /**
     * Comprime un archivo de imagen o Blob preservando la relación de aspecto
     * y calidad visual científica.
     *
     * @param {File|Blob} fileOrBlob - Archivo de imagen capturado.
     * @param {Object} [options]
     * @param {number} [options.maxWidth]
     * @param {number} [options.maxHeight]
     * @param {number} [options.quality]
     * @param {string} [options.mimeType]
     * @returns {Promise<{
     *   blob: Blob,
     *   width: number,
     *   height: number,
     *   originalSize: number,
     *   compressedSize: number,
     *   mimeType: string
     * }>}
     */
    async compressImage(fileOrBlob, options = {}) {
        if (!(fileOrBlob instanceof Blob)) {
            throw new TypeError('El archivo proporcionado no es una imagen válida (Blob/File).');
        }

        if (fileOrBlob.type && !fileOrBlob.type.startsWith('image/')) {
            throw new Error('El archivo seleccionado no corresponde a un formato de imagen.');
        }

        const maxWidth = options.maxWidth ?? ENV.IMAGE_COMPRESSION.MAX_WIDTH;
        const maxHeight = options.maxHeight ?? ENV.IMAGE_COMPRESSION.MAX_HEIGHT;
        const quality = options.quality ?? ENV.IMAGE_COMPRESSION.QUALITY;
        const mimeType = options.mimeType ?? ENV.IMAGE_COMPRESSION.MIME_TYPE;

        const imgElement = await this._loadImageFromBlob(fileOrBlob);
        const { targetWidth, targetHeight } = this._calculateTargetDimensions(
            imgElement.naturalWidth || imgElement.width,
            imgElement.naturalHeight || imgElement.height,
            maxWidth,
            maxHeight
        );

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('No fue posible inicializar el contexto gráfico 2D para comprimir la imagen.');
        }

        // Fondo blanco por si la imagen de entrada es PNG con transparencia y se convierte a JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(imgElement, 0, 0, targetWidth, targetHeight);

        const compressedBlob = await new Promise((resolve, reject) => {
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        reject(new Error('Falló la compresión de la fotografía en el dispositivo.'));
                        return;
                    }
                    resolve(blob);
                },
                mimeType,
                quality
            );
        });

        return {
            blob: compressedBlob,
            width: targetWidth,
            height: targetHeight,
            originalSize: fileOrBlob.size,
            compressedSize: compressedBlob.size,
            mimeType: compressedBlob.type || mimeType
        };
    }

    /**
     * Calcula las dimensiones finales manteniendo la proporción original sin agrandar imágenes pequeñas.
     * @param {number} srcWidth
     * @param {number} srcHeight
     * @param {number} maxWidth
     * @param {number} maxHeight
     * @returns {{ targetWidth: number, targetHeight: number }}
     */
    _calculateTargetDimensions(srcWidth, srcHeight, maxWidth, maxHeight) {
        let width = srcWidth || 800;
        let height = srcHeight || 600;

        if (width <= maxWidth && height <= maxHeight) {
            return { targetWidth: width, targetHeight: height };
        }

        const ratio = Math.min(maxWidth / width, maxHeight / height);
        return {
            targetWidth: Math.max(1, Math.round(width * ratio)),
            targetHeight: Math.max(1, Math.round(height * ratio))
        };
    }

    /**
     * Carga un Blob dentro de un objeto HTMLImageElement.
     * @param {Blob} blob
     * @returns {Promise<HTMLImageElement>}
     */
    _loadImageFromBlob(blob) {
        return new Promise((resolve, reject) => {
            const objectUrl = URL.createObjectURL(blob);
            const img = new Image();

            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(img);
            };

            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('No se pudo decodificar el archivo de imagen seleccionado.'));
            };

            img.src = objectUrl;
        });
    }
}

export const imageCompressionService = new ImageCompressionService();