/**
 * @file js/services/IndexedDBService.js
 * @description Servicio de infraestructura para persistencia local Offline-First
 * mediante IndexedDB nativo del navegador. Nunca almacena contraseñas ni claves secretas.
 */

import { ENV } from '../config/env.js';

export class IndexedDBService {
    constructor() {
        /** @type {IDBDatabase|null} */
        this._db = null;
        /** @type {Promise<IDBDatabase>|null} */
        this._initPromise = null;
    }

    /**
     * Abre e inicializa las tiendas de objetos (Object Stores) e índices en IndexedDB.
     * @returns {Promise<IDBDatabase>}
     */
    async init() {
        if (this._db) return this._db;
        if (this._initPromise) return this._initPromise;

        this._initPromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('IndexedDB no está soportado en este navegador.'));
                return;
            }

            const request = indexedDB.open(ENV.IDB_NAME, ENV.IDB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 1. Hallazgos locales (findings)
                if (!db.objectStoreNames.contains(ENV.IDB_STORES.FINDINGS)) {
                    const findingStore = db.createObjectStore(ENV.IDB_STORES.FINDINGS, { keyPath: 'id' });
                    findingStore.createIndex('by_sync_status', 'sync_status', { unique: false });
                    findingStore.createIndex('by_created_by', 'created_by', { unique: false });
                    findingStore.createIndex('by_category', 'category', { unique: false });
                    findingStore.createIndex('by_captured_at', 'captured_at', { unique: false });
                }

                // 2. Fotografías comprimidas y sus metadatos (photographs)
                if (!db.objectStoreNames.contains(ENV.IDB_STORES.PHOTOGRAPHS)) {
                    const photoStore = db.createObjectStore(ENV.IDB_STORES.PHOTOGRAPHS, { keyPath: 'id' });
                    photoStore.createIndex('by_finding_id', 'finding_id', { unique: false });
                    photoStore.createIndex('by_sync_status', 'sync_status', { unique: false });
                }

                // 3. Expediciones disponibles offline
                if (!db.objectStoreNames.contains(ENV.IDB_STORES.EXPEDITIONS)) {
                    const expStore = db.createObjectStore(ENV.IDB_STORES.EXPEDITIONS, { keyPath: 'id' });
                    expStore.createIndex('by_sync_status', 'sync_status', { unique: false });
                }

                // 4. Cola de sincronización FIFO idempotente
                if (!db.objectStoreNames.contains(ENV.IDB_STORES.SYNC_QUEUE)) {
                    const queueStore = db.createObjectStore(ENV.IDB_STORES.SYNC_QUEUE, { keyPath: 'id' });
                    queueStore.createIndex('by_status', 'status', { unique: false });
                    queueStore.createIndex('by_entity_id', 'entity_id', { unique: false });
                    queueStore.createIndex('by_created_at', 'created_at', { unique: false });
                }

                // 5. Auditoría local de correcciones de metadatos
                if (!db.objectStoreNames.contains(ENV.IDB_STORES.METADATA_AUDIT)) {
                    const auditStore = db.createObjectStore(ENV.IDB_STORES.METADATA_AUDIT, { keyPath: 'id' });
                    auditStore.createIndex('by_record_id', 'record_id', { unique: false });
                    auditStore.createIndex('by_sync_status', 'sync_status', { unique: false });
                }

                // 6. Caché de perfil de usuario (sin contraseñas ni tokens secretos)
                if (!db.objectStoreNames.contains(ENV.IDB_STORES.SESSION_CACHE)) {
                    db.createObjectStore(ENV.IDB_STORES.SESSION_CACHE, { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this._db = event.target.result;
                this._db.onversionchange = () => {
                    this._db.close();
                    this._db = null;
                    this._initPromise = null;
                };
                resolve(this._db);
            };

            request.onerror = (event) => {
                this._initPromise = null;
                reject(event.target.error || new Error('Error al abrir IndexedDB.'));
            };
        });

        return this._initPromise;
    }

    /**
     * Inserta o actualiza un registro de forma idempotente (put).
     * @param {string} storeName
     * @param {Object} record
     * @returns {Promise<any>}
     */
    async put(storeName, record) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(record);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Obtiene un registro por su clave primaria.
     * @param {string} storeName
     * @param {string} key
     * @returns {Promise<any|null>}
     */
    async getById(storeName, key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Obtiene todos los registros de una tienda.
     * @param {string} storeName
     * @returns {Promise<any[]>}
     */
    async getAll(storeName) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Obtiene registros filtrados por un índice específico.
     * @param {string} storeName
     * @param {string} indexName
     * @param {IDBValidKey} value
     * @returns {Promise<any[]>}
     */
    async getByIndex(storeName, indexName, value) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const req = index.getAll(value);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Elimina un registro por su clave primaria.
     * @param {string} storeName
     * @param {string} key
     * @returns {Promise<void>}
     */
    async delete(storeName, key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Limpia todos los registros de una tienda específica.
     * @param {string} storeName
     * @returns {Promise<void>}
     */
    async clearStore(storeName) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
}

export const indexedDBService = new IndexedDBService();