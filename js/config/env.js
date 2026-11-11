/**
 * @file js/config/env.js
 * @description Configuración central del proyecto Monitoreo de Biodiversidad en el Páramo de Santurbán.
 * Contiene exactamente la URL y Publishable Key proporcionadas para el proyecto Supabase.
 */

const RAW_SUPABASE_URL = 'https://nkvkzyugbwcdaoxhcttp.supabase.co/rest/v1/';

/**
 * Normaliza la URL de Supabase por si incluye el sufijo '/rest/v1/'
 * ya que el SDK oficial @supabase/supabase-js requiere la URL raíz del proyecto
 * para construir internamente '/auth/v1', '/rest/v1' y '/storage/v1'.
 * @param {string} url
 * @returns {string}
 */
function normalizeSupabaseBaseUrl(url) {
    return url.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

export const ENV = Object.freeze({
    APP_NAME: 'Monitoreo de Biodiversidad — Páramo de Santurbán',
    APP_VERSION: '1.0.0',

    // =========================================================================
    // CREDENCIALES PÚBLICAS DE SUPABASE (UBICACIÓN EXACTA DE URL Y KEY)
    // =========================================================================
    SUPABASE_REST_URL: RAW_SUPABASE_URL,
    SUPABASE_URL: normalizeSupabaseBaseUrl(RAW_SUPABASE_URL),
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_3KSMln0RiLt2dQ_f1_kj0w_0fCWXbnc',

    // =========================================================================
    // RECURSOS DE BASE DE DATOS Y STORAGE EXISTENTES
    // =========================================================================
    STORAGE_BUCKET: 'evidencias-ambientales',
    SIGNED_URL_EXPIRES_IN: 3600, // 1 hora en segundos para visualización segura de fotos privadas

    TABLES: Object.freeze({
        PROFILES: 'profiles',
        EXPEDITIONS: 'expeditions',
        FINDINGS: 'findings',
        PHOTOGRAPHS: 'photographs',
        NOTIFICATIONS: 'notifications',
        METADATA_AUDIT: 'metadata_corrections_audit'
    }),

    // =========================================================================
    // ROLES Y CATEGORÍAS DE DOMINIO
    // =========================================================================
    ROLES: Object.freeze({
        RANGER: 'guardabosque',
        ADMIN: 'administrador'
    }),

    FINDING_CATEGORIES: Object.freeze([
        { id: 'especie_nativa', label: 'Especie nativa', isSpeciesRequired: true, badgeColor: '#2d6a4f' },
        { id: 'fauna', label: 'Fauna', isSpeciesRequired: false, badgeColor: '#40916c' },
        { id: 'flora', label: 'Flora', isSpeciesRequired: false, badgeColor: '#52b788' },
        { id: 'foco_degradacion', label: 'Foco de degradación', isSpeciesRequired: false, badgeColor: '#d90429', isAlert: true },
        { id: 'contaminacion', label: 'Contaminación', isSpeciesRequired: false, badgeColor: '#e07a5f' },
        { id: 'otro', label: 'Otro', isSpeciesRequired: false, badgeColor: '#8d99ae' }
    ]),

    LOCATION_SOURCES: Object.freeze({
        GPS: 'gps',
        SIMULATED: 'simulated'
    }),

    // =========================================================================
    // PARÁMETROS DE INDEXEDDB (OFFLINE FIRST)
    // =========================================================================
    IDB_NAME: 'santurban_biodiversidad_db',
    IDB_VERSION: 1,
    IDB_STORES: Object.freeze({
        FINDINGS: 'local_findings',
        PHOTOGRAPHS: 'local_photographs',
        EXPEDITIONS: 'local_expeditions',
        SYNC_QUEUE: 'sync_queue',
        METADATA_AUDIT: 'local_metadata_audit',
        SESSION_CACHE: 'session_cache'
    }),

    // =========================================================================
    // PARÁMETROS DE IMAGEN Y MAPA
    // =========================================================================
    IMAGE_COMPRESSION: Object.freeze({
        MAX_WIDTH: 1600,
        MAX_HEIGHT: 1600,
        QUALITY: 0.82,
        MIME_TYPE: 'image/jpeg'
    }),

    MAP_DEFAULTS: Object.freeze({
        CENTER_LAT: 7.2685, // Coordenadas centrales del complejo de Páramo de Santurbán
        CENTER_LNG: -72.9052,
        DEFAULT_ZOOM: 12,
        MIN_ZOOM: 7,
        MAX_ZOOM: 19,
        TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        TILE_ATTRIBUTION: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    })
});