/**
 * @file js/viewmodels/AdminViewModel.js
 * @description ViewModel para el Dashboard Administrativo y Análisis Espacial SIG.
 * Consulta datos reales desde Supabase, calcula KPIs, aplica filtros y gestiona alertas.
 */

import { ENV } from '../config/env.js';
import { SYNC_STATUS } from '../models/ReporteAmbiental.js';
import { remoteReportRepository } from '../repositories/RemoteReportRepository.js';
import { reportRepository } from '../repositories/ReportRepository.js';
import { exportService } from '../services/ExportService.js';

export class AdminViewModel {
    /**
     * @param {Object} [deps]
     */
    constructor({
        repository = reportRepository,
        remoteRepo = remoteReportRepository,
        exporter = exportService
    } = {}) {
        this._repo = repository;
        this._remoteRepo = remoteRepo;
        this._exporter = exporter;

        /** @type {Array<Object>} */
        this._allFindings = [];
        /** @type {Array<Object>} */
        this._filteredFindings = [];
        /** @type {Array<Object>} */
        this._expeditions = [];
        /** @type {Array<Object>} */
        this._alerts = [];
        /** @type {Array<Object>} */
        this._metadataAudits = [];
        this._pendingSyncCount = 0;

        this._filters = {
            category: 'all',
            minAltitude: '',
            maxAltitude: '',
            dateFrom: '',
            dateTo: '',
            observationSource: 'all' // 'all' | 'gps' | 'simulated'
        };
    }

    get filteredFindings() {
        return [...this._filteredFindings];
    }

    get allFindings() {
        return [...this._allFindings];
    }

    get alerts() {
        return [...this._alerts];
    }

    get expeditions() {
        return [...this._expeditions];
    }

    get metadataAudits() {
        return [...this._metadataAudits];
    }

    get filters() {
        return { ...this._filters };
    }

    /**
     * Carga todos los hallazgos, expediciones, alertas y auditorías reales desde Supabase + cola local.
     */
    async loadDashboardData() {
        const [findings, expeditions, alerts, pendingCount] = await Promise.all([
            this._repo.getUnifiedFindings({ userId: null }),
            this._repo.getExpeditions(),
            this._repo.getUnifiedAlertsAndNotifications(),
            this._repo.getPendingSyncCount()
        ]);

        this._allFindings = findings;
        this._expeditions = expeditions;
        this._alerts = alerts;
        this._pendingSyncCount = pendingCount;

        try {
            this._metadataAudits = await this._remoteRepo.fetchMetadataAudits();
        } catch {
            this._metadataAudits = [];
        }

        this.applyFilters();
    }

    /**
     * Actualiza los criterios de filtrado y recalcula el subconjunto de hallazgos para el mapa y KPIs.
     * @param {Partial<typeof this._filters>} newFilters
     * @returns {Array<Object>} Hallazgos filtrados.
     */
    applyFilters(newFilters = {}) {
        this._filters = {
            ...this._filters,
            ...newFilters
        };

        const { category, minAltitude, maxAltitude, dateFrom, dateTo, observationSource } =
            this._filters;

        const minAltNum = minAltitude !== '' && minAltitude !== null ? Number(minAltitude) : null;
        const maxAltNum = maxAltitude !== '' && maxAltitude !== null ? Number(maxAltitude) : null;
        const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
        const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

        this._filteredFindings = this._allFindings.filter((item) => {
            // 1. Filtro por categoría del hallazgo
            if (category && category !== 'all' && item.category !== category) {
                return false;
            }

            // 2. Filtro por tipo/fuente de observación ('gps' real vs 'simulated')
            if (
                observationSource &&
                observationSource !== 'all' &&
                item.location_source !== observationSource
            ) {
                return false;
            }

            // 3. Filtro por rango de altitud
            if (minAltNum !== null && Number.isFinite(minAltNum)) {
                if (typeof item.altitude !== 'number' || item.altitude < minAltNum) {
                    return false;
                }
            }
            if (maxAltNum !== null && Number.isFinite(maxAltNum)) {
                if (typeof item.altitude !== 'number' || item.altitude > maxAltNum) {
                    return false;
                }
            }

            // 4. Filtro por intervalo de fechas
            const capturedMs = new Date(item.captured_at).getTime();
            if (fromTime !== null && Number.isFinite(fromTime) && capturedMs < fromTime) {
                return false;
            }
            if (toTime !== null && Number.isFinite(toTime) && capturedMs > toTime) {
                return false;
            }

            return true;
        });

        return this.filteredFindings;
    }

    /**
     * Restablece todos los filtros a sus valores iniciales.
     */
    resetFilters() {
        return this.applyFilters({
            category: 'all',
            minAltitude: '',
            maxAltitude: '',
            dateFrom: '',
            dateTo: '',
            observationSource: 'all'
        });
    }

    /**
     * Calcula los indicadores reales del Dashboard Administrativo (Requisito #11).
     * Nunca inventa datos ficticios.
     */
    computeMetrics() {
        const dataset = this._filteredFindings;

        let totalPhotos = 0;
        const uniqueSpecies = new Set();
        const byCategory = {};
        const byPeriodMonth = {};
        const byAltitudeBand = {
            'Subpáramo (< 3.200 m)': 0,
            'Páramo propiamente dicho (3.200 - 3.600 m)': 0,
            'Superpáramo (> 3.600 m)': 0,
            'Sin dato de altitud': 0
        };

        for (const cat of ENV.FINDING_CATEGORIES) {
            byCategory[cat.id] = { label: cat.label, count: 0, badgeColor: cat.badgeColor };
        }

        for (const f of dataset) {
            // Conteo de fotografías
            const pCount = Array.isArray(f.photographs)
                ? f.photographs.length
                : f.photo_count ?? 0;
            totalPhotos += pCount;

            // Conteo de especies únicas registradas (normalizadas en minúscula)
            if (f.species_name && f.species_name.trim().length > 0) {
                uniqueSpecies.add(f.species_name.trim().toLowerCase());
            }

            // Distribución por categoría
            if (!byCategory[f.category]) {
                byCategory[f.category] = { label: f.category, count: 0, badgeColor: '#8d99ae' };
            }
            byCategory[f.category].count += 1;

            // Distribución por periodo (Año-Mes)
            if (f.captured_at) {
                const yearMonth = f.captured_at.slice(0, 7); // YYYY-MM
                byPeriodMonth[yearMonth] = (byPeriodMonth[yearMonth] || 0) + 1;
            }

            // Distribución por franja altitudinal de páramo
            if (typeof f.altitude === 'number' && Number.isFinite(f.altitude)) {
                if (f.altitude < 3200) {
                    byAltitudeBand['Subpáramo (< 3.200 m)'] += 1;
                } else if (f.altitude <= 3600) {
                    byAltitudeBand['Páramo propiamente dicho (3.200 - 3.600 m)'] += 1;
                } else {
                    byAltitudeBand['Superpáramo (> 3.600 m)'] += 1;
                }
            } else {
                byAltitudeBand['Sin dato de altitud'] += 1;
            }
        }

        const localPendingFindings = this._allFindings.filter(
            (f) => f.sync_status !== SYNC_STATUS.SYNCED
        ).length;

        return {
            totalFindings: dataset.length,
            totalPhotographs: totalPhotos,
            totalUniqueSpecies: uniqueSpecies.size,
            pendingSyncRecords: Math.max(this._pendingSyncCount, localPendingFindings),
            byCategory: Object.values(byCategory),
            byPeriodMonth: Object.entries(byPeriodMonth).sort((a, b) => b[0].localeCompare(a[0])),
            byAltitudeBand: Object.entries(byAltitudeBand),
            recentActivity: dataset.slice(0, 12)
        };
    }

    /**
     * Exporta los hallazgos actualmente filtrados a CSV compatible con QGIS.
     */
    exportFilteredToCSV() {
        this._exporter.exportToCSVFile(this._filteredFindings);
    }

    /**
     * Exporta los hallazgos actualmente filtrados a GeoJSON compatible con QGIS.
     */
    exportFilteredToGeoJSON() {
        this._exporter.exportToGeoJSONFile(this._filteredFindings);
    }

    /**
     * Marca una notificación como leída en Supabase.
     * @param {string} notificationId
     */
    async markAlertRead(notificationId) {
        if (!notificationId || notificationId.startsWith('local-alert-')) return;
        await this._remoteRepo.markNotificationAsRead(notificationId);
        this._alerts = this._alerts.map((a) =>
            a.id === notificationId ? { ...a, is_read: true } : a
        );
    }

    /**
     * Solicita permiso contextual (no obligatorio) para notificaciones del navegador (Requisito #12).
     * @returns {Promise<string>} 'granted' | 'denied' | 'default' | 'unsupported'
     */
    async requestContextualBrowserNotifications() {
        if (typeof window === 'undefined' || !('Notification' in window)) {
            return 'unsupported';
        }
        if (Notification.permission === 'granted') {
            return 'granted';
        }
        return Notification.requestPermission();
    }

    /**
     * Resuelve la URL firmada o de Blob para visualizar una fotografía autorizada.
     * @param {Object} photo
     */
    async resolvePhotoUrl(photo) {
        return this._repo.resolvePhotoUrl(photo);
    }
}

export const adminViewModel = new AdminViewModel();