/**
 * @file js/viewmodels/FieldViewModel.js
 * @description ViewModel para la vista de trabajo de campo (Guardabosque).
 * Coordina LocationService, CameraService, ReportRepository y SyncService.
 */

import { ENV } from '../config/env.js';
import { appEventBus, EVENTS } from '../core/EventBus.js';
import { reportRepository } from '../repositories/ReportRepository.js';
import { cameraService } from '../services/CameraService.js';
import { locationService } from '../services/LocationService.js';
import { networkMonitor } from '../services/NetworkMonitor.js';
import { syncService } from '../services/SyncService.js';

export class FieldViewModel {
    /**
     * @param {Object} [deps]
     */
    constructor({
        repository = reportRepository,
        location = locationService,
        camera = cameraService,
        sync = syncService,
        network = networkMonitor,
        eventBus = appEventBus
    } = {}) {
        this._repo = repository;
        this._location = location;
        this._camera = camera;
        this._sync = sync;
        this._network = network;
        this._eventBus = eventBus;

        /** @type {Object|null} */
        this._currentUserProfile = null;
        /** @type {Object|null} */
        this._currentCoordinates = null;
        /** @type {Array<Object>} */
        this._stagedPhotos = [];
        /** @type {Array<Object>} */
        this._expeditions = [];
        /** @type {Array<Object>} */
        this._myFindings = [];
    }

    get currentCoordinates() {
        return this._currentCoordinates;
    }

    get stagedPhotos() {
        return [...this._stagedPhotos];
    }

    get expeditions() {
        return [...this._expeditions];
    }

    get myFindings() {
        return [...this._myFindings];
    }

    /**
     * Inicializa los datos necesarios para el Guardabosque autenticado.
     * @param {Object} userProfile
     */
    async initialize(userProfile) {
        this._currentUserProfile = userProfile;
        await this.refreshData();
    }

    /**
     * Recarga expediciones, hallazgos del usuario y contador de cola pendiente.
     */
    async refreshData() {
        if (!this._currentUserProfile) return;
        this._expeditions = await this._repo.getExpeditions();
        this._myFindings = await this._repo.getUnifiedFindings({
            userId: this._currentUserProfile.id
        });
    }

    /**
     * Solicita ubicación GPS real bajo demanda al navegador.
     */
    async captureRealGPS() {
        const position = await this._location.getCurrentPosition();
        this._currentCoordinates = position;
        return position;
    }

    /**
     * Avanza al siguiente punto de la ruta simulada del Páramo de Santurbán ("Avanzar ruta").
     * Identifica explícitamente la fuente como `simulated`.
     */
    advanceSimulatedRoute() {
        const simulatedPos = this._location.advanceSimulatedRoute();
        this._currentCoordinates = simulatedPos;
        return simulatedPos;
    }

    /**
     * Procesa y comprime una o varias fotografías seleccionadas o tomadas con la cámara,
     * vinculándoles automáticamente las coordenadas vigentes.
     *
     * @param {FileList|File[]} files
     * @returns {Promise<Object[]>}
     */
    async addPhotographs(files) {
        if (!files || files.length === 0) return this._stagedPhotos;

        for (const file of Array.from(files)) {
            const processed = await this._camera.processCapturedFile(file, this._currentCoordinates);
            this._stagedPhotos.push(processed);
        }
        return this.stagedPhotos;
    }

    /**
     * Elimina una fotografía de la lista previa antes de guardar el hallazgo.
     * @param {string} photoId
     */
    removeStagedPhoto(photoId) {
        const target = this._stagedPhotos.find((p) => p.id === photoId);
        if (target?.previewUrl) {
            this._camera.revokePreviewUrl(target.previewUrl);
        }
        this._stagedPhotos = this._stagedPhotos.filter((p) => p.id !== photoId);
    }

    /**
     * Registra el hallazgo ambiental con sus fotografías en IndexedDB y dispara sincronización si hay red.
     * @param {Object} formValues
     */
    async submitFinding(formValues) {
        if (!this._currentUserProfile) {
            throw new Error('No hay una sesión de usuario activa.');
        }

        if (!this._currentCoordinates) {
            throw new Error(
                'Debe capturar primero las coordenadas (mediante GPS real o el botón "Avanzar ruta") antes de guardar el hallazgo.'
            );
        }

        const savedFinding = await this._repo.createFindingReport({
            created_by: this._currentUserProfile.id,
            expedition_id: formValues.expedition_id || null,
            category: formValues.category,
            species_name: formValues.species_name,
            description: formValues.description,
            latitude: this._currentCoordinates.latitude,
            longitude: this._currentCoordinates.longitude,
            altitude: this._currentCoordinates.altitude,
            location_accuracy: this._currentCoordinates.location_accuracy,
            location_source: this._currentCoordinates.location_source || ENV.LOCATION_SOURCES.GPS,
            captured_at: this._currentCoordinates.captured_at || new Date().toISOString(),
            capturedPhotos: this._stagedPhotos
        });

        // Limpiar fotos en preparación tras persistir en IndexedDB
        this._camera.revokeAllPreviews();
        this._stagedPhotos = [];

        await this.refreshData();

        // Si hay conexión activa, disparar sincronización en segundo plano sin bloquear la UI
        if (this._network.isOnline) {
            this._sync.syncPendingQueue({ source: 'after_capture' }).then(() => {
                this.refreshData();
            });
        }

        return savedFinding;
    }

    /**
     * Crea una nueva expedición y actualiza el listado.
     * @param {{ name: string, description: string }} data
     */
    async createExpedition({ name, description }) {
        if (!this._currentUserProfile) {
            throw new Error('Sesión no disponible.');
        }

        const created = await this._repo.createExpedition({
            name,
            description,
            created_by: this._currentUserProfile.id
        });

        await this.refreshData();

        if (this._network.isOnline) {
            this._sync.syncPendingQueue({ source: 'after_expedition' });
        }

        return created;
    }

    /**
     * Registra una corrección auditada de metadatos sobre un hallazgo existente.
     * Conserva el valor original, el valor corregido, la fecha y el usuario responsable (Requisito #7).
     *
     * @param {Object} params
     * @param {string} params.findingId
     * @param {string} params.fieldName
     * @param {any} params.originalValue
     * @param {any} params.correctedValue
     * @param {string} params.reason
     */
    async submitMetadataCorrection({ findingId, fieldName, originalValue, correctedValue, reason }) {
        if (!this._currentUserProfile) {
            throw new Error('Sesión no disponible.');
        }

        const audit = await this._repo.registerMetadataCorrection({
            target_table: 'findings',
            record_id: findingId,
            field_name: fieldName,
            original_value: originalValue,
            corrected_value: correctedValue,
            reason,
            corrected_by: this._currentUserProfile.id
        });

        await this.refreshData();

        if (this._network.isOnline) {
            await this._sync.syncPendingQueue({ source: 'after_audit' });
            await this.refreshData();
        }

        return audit;
    }

    /**
     * Ejecuta sincronización manual solicitada por el usuario.
     */
    async triggerManualSync() {
        const result = await this._sync.syncPendingQueue({ source: 'manual_button' });
        await this.refreshData();
        return result;
    }

    /**
     * Obtiene una URL firmada o de Blob local para visualizar una foto.
     * @param {Object} photo
     */
    async resolvePhotoUrl(photo) {
        return this._repo.resolvePhotoUrl(photo);
    }

    /**
     * Retorna el conteo actual de elementos pendientes en la cola de sincronización.
     */
    async getPendingSyncCount() {
        return this._repo.getPendingSyncCount();
    }
}

export const fieldViewModel = new FieldViewModel();