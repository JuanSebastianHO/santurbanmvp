/**
 * @file js/utils/uuid.js
 * @description Generador y validador de identificadores únicos UUID v4 en el cliente.
 * Indispensable para la idempotencia del enfoque Offline-First.
 */

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Genera un UUID v4 criptográficamente seguro.
 * @returns {string} UUID v4 en minúsculas.
 */
export function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    // Fallback usando crypto.getRandomValues conforme a RFC 4122 sección 4.4
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // Versión 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variante RFC 4122

        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
        return (
            `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-` +
            `${hex[4]}${hex[5]}-` +
            `${hex[6]}${hex[7]}-` +
            `${hex[8]}${hex[9]}-` +
            `${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
        );
    }

    throw new Error('El navegador no soporta generación criptográfica segura para UUID.');
}

/**
 * Verifica si una cadena es un UUID válido.
 * @param {string} value
 * @returns {boolean}
 */
export function isValidUUID(value) {
    if (typeof value !== 'string') return false;
    return UUID_V4_REGEX.test(value.trim());
}