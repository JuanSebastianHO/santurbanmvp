/**
 * @file js/core/EventBus.js
 * @description Implementación del patrón Observer (Pub/Sub) para desacoplar
 * servicios de infraestructura (NetworkMonitor, SyncService) y ViewModels.
 */

export class EventBus {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this._listeners = new Map();
    }

    /**
     * Suscribe un callback a un evento específico.
     * @param {string} eventName
     * @param {Function} callback
     * @returns {Function} Función para cancelar la suscripción (unsubscribe).
     */
    on(eventName, callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('El listener debe ser una función.');
        }

        if (!this._listeners.has(eventName)) {
            this._listeners.set(eventName, new Set());
        }

        const handlers = this._listeners.get(eventName);
        handlers.add(callback);

        return () => this.off(eventName, callback);
    }

    /**
     * Elimina un callback de un evento.
     * @param {string} eventName
     * @param {Function} callback
     */
    off(eventName, callback) {
        const handlers = this._listeners.get(eventName);
        if (!handlers) return;
        handlers.delete(callback);
        if (handlers.size === 0) {
            this._listeners.delete(eventName);
        }
    }

    /**
     * Emite un evento con carga útil a todos los suscriptores.
     * @param {string} eventName
     * @param {any} [payload]
     */
    emit(eventName, payload) {
        const handlers = this._listeners.get(eventName);
        if (!handlers) return;

        for (const callback of Array.from(handlers)) {
            try {
                callback(payload);
            } catch (error) {
                console.error(`[EventBus] Error ejecutando listener para "${eventName}":`, error);
            }
        }
    }
}

// Instancia global compartida para inyección por defecto
export const appEventBus = new EventBus();

export const EVENTS = Object.freeze({
    NETWORK_STATUS_CHANGED: 'network:status_changed',
    AUTH_STATE_CHANGED: 'auth:state_changed',
    SYNC_STARTED: 'sync:started',
    SYNC_PROGRESS: 'sync:progress',
    SYNC_COMPLETED: 'sync:completed',
    SYNC_ERROR: 'sync:error',
    QUEUE_UPDATED: 'sync:queue_updated',
    FINDING_CREATED_LOCAL: 'finding:created_local',
    DEGRADATION_ALERT: 'alert:foco_degradacion'
});