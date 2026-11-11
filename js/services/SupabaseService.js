/**
 * @file js/services/SupabaseService.js
 * @description Servicio de infraestructura para interactuar con Supabase
 * (Auth, PostgreSQL vía PostgREST y Storage privado 'evidencias-ambientales').
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { ENV } from '../config/env.js';

export class SupabaseService {
    constructor() {
        if (!ENV.SUPABASE_URL || !ENV.SUPABASE_PUBLISHABLE_KEY) {
            throw new Error('Configuración de Supabase incompleta en js/config/env.js');
        }

        this._client = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: 'santurban_supabase_auth_token'
            }
        });

        /** @type {Map<string, { url: string, expiresAt: number }>} */
        this._signedUrlCache = new Map();
    }

    /**
     * Retorna la instancia subyacente del cliente de Supabase.
     */
    get client() {
        return this._client;
    }

    // =========================================================================
    // AUTENTICACIÓN Y PERFILES
    // =========================================================================

    /**
     * Inicia sesión con correo y contraseña.
     * @param {string} email
     * @param {string} password
     */
    async signInWithPassword(email, password) {
        const { data, error } = await this._client.auth.signInWithPassword({
            email: email.trim(),
            password
        });
        if (error) throw error;
        return data;
    }

    /**
     * Cierra la sesión activa.
     */
    async signOut() {
        this._signedUrlCache.clear();
        const { error } = await this._client.auth.signOut();
        if (error) throw error;
    }

    /**
     * Obtiene la sesión actual almacenada por el SDK.
     */
    async getSession() {
        const { data, error } = await this._client.auth.getSession();
        if (error) throw error;
        return data.session;
    }

    /**
     * Obtiene el perfil y rol del usuario desde la tabla `profiles`.
     * Cumple el Requisito #3: El rol se obtiene desde `profiles`.
     * @param {string} userId
     * @returns {Promise<{ id: string, full_name: string|null, role: string, created_at: string }>}
     */
    async getUserProfile(userId) {
        const { data, error } = await this._client
            .from(ENV.TABLES.PROFILES)
            .select('id, full_name, role, created_at')
            .eq('id', userId)
            .single();

        if (error) throw error;
        return data;
    }

    // =========================================================================
    // STORAGE PRIVADO ('evidencias-ambientales')
    // =========================================================================

    /**
     * Sube un Blob fotográfico comprimido al bucket privado 'evidencias-ambientales'
     * dentro de la carpeta del usuario autenticado: `{userId}/{findingId}/{photoId}.jpg`.
     * Utiliza `upsert: true` para garantizar idempotencia en reintentos de sincronización.
     *
     * @param {string} storagePath
     * @param {Blob} fileBlob
     * @param {string} [contentType='image/jpeg']
     * @returns {Promise<string>} Ruta almacenada en el bucket.
     */
    async uploadPhotographBlob(storagePath, fileBlob, contentType = 'image/jpeg') {
        const { data, error } = await this._client.storage
            .from(ENV.STORAGE_BUCKET)
            .upload(storagePath, fileBlob, {
                contentType,
                upsert: true,
                cacheControl: '3600'
            });

        if (error) throw error;
        return data.path;
    }

    /**
     * Genera una URL firmada temporal para visualizar una fotografía del bucket privado.
     * Incluye caché en memoria para evitar solicitar firmas repetidas durante la misma sesión.
     *
     * @param {string} storagePath
     * @returns {Promise<string|null>}
     */
    async getSignedPhotoUrl(storagePath) {
        if (!storagePath) return null;

        const now = Date.now();
        const cached = this._signedUrlCache.get(storagePath);
        if (cached && cached.expiresAt > now + 30000) {
            return cached.url;
        }

        const { data, error } = await this._client.storage
            .from(ENV.STORAGE_BUCKET)
            .createSignedUrl(storagePath, ENV.SIGNED_URL_EXPIRES_IN);

        if (error) {
            console.warn(`[SupabaseService] No se pudo firmar URL para ${storagePath}:`, error.message);
            return null;
        }

        if (data?.signedUrl) {
            this._signedUrlCache.set(storagePath, {
                url: data.signedUrl,
                expiresAt: now + ENV.SIGNED_URL_EXPIRES_IN * 1000
            });
            return data.signedUrl;
        }

        return null;
    }

    /**
     * Verifica conectividad real contra el servidor de Supabase.
     * Si el servidor responde (cualquier status HTTP > 0), hay salida real a internet.
     * @returns {Promise<boolean>}
     */
    async ping() {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            return false;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        try {
            const response = await fetch(`${ENV.SUPABASE_URL}/auth/v1/health`, {
                method: 'GET',
                headers: {
                    apikey: ENV.SUPABASE_PUBLISHABLE_KEY
                },
                signal: controller.signal,
                cache: 'no-store'
            });
            clearTimeout(timeoutId);
            // Si el servidor de Supabase responde (200, 401, etc.), hay conexión real a internet
            return response.status > 0;
        } catch {
            clearTimeout(timeoutId);
            return false;
        }
    }
}

export const supabaseService = new SupabaseService();
