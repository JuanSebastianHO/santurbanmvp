/**
 * @file js/services/ExportService.js
 * @description Servicio de exportación de hallazgos ambientales a formatos estándar
 * de Sistemas de Información Geográfica (CSV y GeoJSON RFC 7946 compatibles con QGIS).
 */

export class ExportService {
    /**
     * Genera el contenido de texto CSV (RFC 4180) a partir de una lista de hallazgos.
     * Conserva todos los campos exigidos en el Requisito #13.
     *
     * @param {Array<Object>} findings
     * @returns {string} Cadena CSV lista para guardar.
     */
    generateCSV(findings = []) {
        const headers = [
            'id',
            'category',
            'species_name',
            'description',
            'latitude',
            'longitude',
            'altitude',
            'captured_at',
            'location_source',
            'location_accuracy',
            'expedition_id',
            'photo_count',
            'sync_status'
        ];

        const rows = [headers.join(',')];

        for (const item of findings) {
            const photoCount = Array.isArray(item.photographs)
                ? item.photographs.length
                : item.photo_count ?? 0;

            const rowValues = [
                this._escapeCSVField(item.id),
                this._escapeCSVField(item.category),
                this._escapeCSVField(item.species_name ?? ''),
                this._escapeCSVField(item.description ?? ''),
                this._escapeCSVField(item.latitude),
                this._escapeCSVField(item.longitude),
                this._escapeCSVField(item.altitude ?? ''),
                this._escapeCSVField(item.captured_at),
                this._escapeCSVField(item.location_source ?? 'gps'),
                this._escapeCSVField(item.location_accuracy ?? ''),
                this._escapeCSVField(item.expedition_id ?? ''),
                this._escapeCSVField(photoCount),
                this._escapeCSVField(item.sync_status ?? 'synced')
            ];

            rows.push(rowValues.join(','));
        }

        return rows.join('\r\n');
    }

    /**
     * Genera un objeto GeoJSON FeatureCollection estándar (RFC 7946) compatible con QGIS.
     * Nota importante SIG: En GeoJSON el orden de coordenadas en Point es [longitude, latitude, altitude?].
     *
     * @param {Array<Object>} findings
     * @returns {Object} Objeto GeoJSON FeatureCollection.
     */
    generateGeoJSON(findings = []) {
        const validFindings = findings.filter(
            (f) => typeof f.latitude === 'number' && typeof f.longitude === 'number'
        );

        const features = validFindings.map((item) => {
            const hasAltitude = typeof item.altitude === 'number' && Number.isFinite(item.altitude);
            const coordinates = hasAltitude
                ? [Number(item.longitude), Number(item.latitude), Number(item.altitude)]
                : [Number(item.longitude), Number(item.latitude)];

            const photoCount = Array.isArray(item.photographs)
                ? item.photographs.length
                : item.photo_count ?? 0;

            return {
                type: 'Feature',
                id: item.id,
                geometry: {
                    type: 'Point',
                    coordinates
                },
                properties: {
                    id: item.id,
                    category: item.category,
                    species_name: item.species_name ?? null,
                    description: item.description ?? null,
                    latitude: Number(item.latitude),
                    longitude: Number(item.longitude),
                    altitude: hasAltitude ? Number(item.altitude) : null,
                    captured_at: item.captured_at,
                    location_source: item.location_source ?? 'gps',
                    location_accuracy:
                        typeof item.location_accuracy === 'number'
                            ? Number(item.location_accuracy)
                            : null,
                    expedition_id: item.expedition_id ?? null,
                    photo_count: photoCount,
                    sync_status: item.sync_status ?? 'synced'
                }
            };
        });

        return {
            type: 'FeatureCollection',
            name: 'hallazgos_paramo_santurban',
            crs: {
                type: 'name',
                properties: {
                    name: 'urn:ogc:def:crs:OGC:1.3:CRS84'
                }
            },
            features
        };
    }

    /**
     * Descarga los hallazgos en un archivo .csv codificado en UTF-8 con BOM para compatibilidad con Excel y QGIS.
     * @param {Array<Object>} findings
     * @param {string} [filenamePrefix='santurban_hallazgos']
     */
    exportToCSVFile(findings, filenamePrefix = 'santurban_hallazgos') {
        const csvContent = '\uFEFF' + this.generateCSV(findings);
        const timestamp = new Date().toISOString().slice(0, 10);
        this._triggerFileDownload(
            csvContent,
            `${filenamePrefix}_${timestamp}.csv`,
            'text/csv;charset=utf-8;'
        );
    }

    /**
     * Descarga los hallazgos en un archivo .geojson listo para arrastrar a QGIS.
     * @param {Array<Object>} findings
     * @param {string} [filenamePrefix='santurban_hallazgos']
     */
    exportToGeoJSONFile(findings, filenamePrefix = 'santurban_hallazgos') {
        const geoJsonObj = this.generateGeoJSON(findings);
        const jsonString = JSON.stringify(geoJsonObj, null, 2);
        const timestamp = new Date().toISOString().slice(0, 10);
        this._triggerFileDownload(
            jsonString,
            `${filenamePrefix}_${timestamp}.geojson`,
            'application/geo+json;charset=utf-8;'
        );
    }

    /**
     * Escapa un valor individual según RFC 4180 y previene inyección de fórmulas CSV.
     * @param {any} value
     * @returns {string}
     */
    _escapeCSVField(value) {
        if (value === null || value === undefined) return '';
        let str = String(value);

        // Prevención de CSV Injection si un texto comienza con =, +, - o @ (excepto números negativos)
        if (/^[=+\-@]/.test(str) && Number.isNaN(Number(str))) {
            str = `'${str}`;
        }

        if (/[",\r\n]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }

    /**
     * Dispara la descarga de un Blob en el navegador.
     * @param {string} content
     * @param {string} fileName
     * @param {string} mimeType
     */
    _triggerFileDownload(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
}

export const exportService = new ExportService();