/**
 * @file js/services/NetworkMonitor.js
 * @description Monitor de conectividad que implementa el patrón Observer
 * para notificar cambios de estado Online/Offline al SyncService y a la interfaz.
 */

import { appEventBus, EVENTS } from '../core/EventBus.js';
import { supabaseService } from './SupabaseService.js';

export class NetworkMonitor {
    /**
     * @param {import('../core/EventBus.js').EventBus} [eventBus]
     */
    constructor(eventBus = appEventBus) {
        this._eventBus = eventBus;
        this._isOnline = typeof navigator !== 'undefined' ? Boolean(navigator.onLine) : true;
        this._isChecking = false;

        this._handleBrowserOnline = this._handleBrowserOnline.bind(this);
        this._handleBrowserOffline = this._handleBrowserOffline.bind(this);

        if (typeof window !== 'undefined') {
            window.addEventListener('online', this._handleBrowserOnline);
            window.addEventListener('offline', this._handleBrowserOffline);
        }
    }

    /**
     * Indica el estado de conectividad actual.
     * @returns {boolean}
     */
    get isOnline() {
        return this._isOnline;
    }

    /**
     * Permite que cualquier servicio (ej. SyncService) se suscriba a cambios de conectividad.
     * @param {(status: { isOnline: boolean, timestamp: string }) => void} observerCallback
     * @returns {Function} Función para cancelar suscripción.
     */
    subscribe(observerCallback) {
        return this._eventBus.on(EVENTS.NETWORK_STATUS_CHANGED, observerCallback);
    }

    /**
     * Verifica activamente si hay salida real hacia Supabase.
     * @returns {Promise<boolean>}
     */
    async checkConnectivity() {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            this._updateStatus(false);
            return false;
        }

        if (this._isChecking) return this._isOnline;
        this._isChecking = true;

        try {
            const reachable = await supabaseService.ping();
            this._updateStatus(reachable);
            return reachable;
        } catch {
            this._updateStatus(false);
            return false;
        } finally {
            this._isChecking = false;
        }
    }

    async _handleBrowserOnline() {
        await this.checkConnectivity();
    }

    _handleBrowserOffline() {
        this._updateStatus(false);
    }

    /**
     * Actualiza el estado interno y notifica a los observadores si cambió.
     * @param {boolean} nextState
     */
    _updateStatus(nextState) {
        const previous = this._isOnline;
        this._isOnline = Boolean(nextState);

        if (previous !== this._isOnline) {
            this._eventBus.emit(EVENTS.NETWORK_STATUS_CHANGED, {
                isOnline: this._isOnline,
                timestamp: new Date().toISOString()
            });
        }
    }
}

export const networkMonitor = new NetworkMonitor();