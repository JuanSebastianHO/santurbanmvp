/**
 * @file js/views/FieldView.js
 * @description Vista de trabajo de campo para Guardabosques.
 * Diseñada con modo oscuro de alto contraste, botones táctiles grandes,
 * mini-mapa Leaflet para verificar posición GPS/Ruta Simulada y soporte Offline-First.
 */

import { ENV } from '../config/env.js';
import { appEventBus, EVENTS } from '../core/EventBus.js';
import { SYNC_STATUS } from '../models/ReporteAmbiental.js';
import { clearElement, createElement, formatDateTime } from '../utils/dom.js';

export class FieldView {
    /**
     * @param {HTMLElement} container
     * @param {import('../viewmodels/FieldViewModel.js').FieldViewModel} viewModel
     */
    constructor(container, viewModel) {
        this._container = container;
        this._viewModel = viewModel;

        this._selectedCategory = ENV.FINDING_CATEGORIES[0].id;
        this._miniMap = null;
        this._miniMapMarker = null;
        this._routePolyline = null;
        this._routeCoordsHistory = [];

        // Referencias a nodos DOM dinámicos
        this._feedbackBanner = null;
        this._telemetryDom = {};
        this._photoGridContainer = null;
        this._expeditionSelect = null;
        this._speciesGroup = null;
        this._speciesInput = null;
        this._descriptionInput = null;
        this._recordsListContainer = null;
        this._syncStatusText = null;
        this._syncBtn = null;

        this._unsubscribers = [];
    }

    /**
     * Renderiza la estación de trabajo de campo completa.
     */
    async render() {
        this.destroy();
        clearElement(this._container);

        this._feedbackBanner = createElement('div', {
            className: 'alert-banner hidden',
            attrs: { role: 'status', 'aria-live': 'polite' }
        });

        const leftColumn = this._buildCaptureColumn();
        const rightColumn = this._buildSyncAndHistoryColumn();

        const workspaceGrid = createElement('div', {
            className: 'field-workspace-grid',
            children: [leftColumn, rightColumn]
        });

        this._container.appendChild(this._feedbackBanner);
        this._container.appendChild(workspaceGrid);

        // Inicializar mini-mapa Leaflet de referencia en campo
        this._initMiniMap();

        // Poblar expediciones e historial de registros
        this._populateExpeditionsDropdown();
        await this._renderMyFindingsList();
        await this._updateSyncSummary();

        // Suscribirse a eventos de sincronización para refrescar estado en vivo
        this._unsubscribers.push(
            appEventBus.on(EVENTS.SYNC_STARTED, () => {
                if (this._syncBtn) {
                    this._syncBtn.disabled = true;
                    this._syncBtn.textContent = 'Sincronizando con Supabase...';
                }
            }),
            appEventBus.on(EVENTS.SYNC_PROGRESS, ({ current, total }) => {
                if (this._syncStatusText) {
                    this._syncStatusText.textContent = `Subiendo registro ${current} de ${total}...`;
                }
            }),
            appEventBus.on(EVENTS.SYNC_COMPLETED, async ({ syncedCount, failedCount }) => {
                await this._viewModel.refreshData();
                await this._renderMyFindingsList();
                await this._updateSyncSummary();

                if (syncedCount > 0 && failedCount === 0) {
                    this._showBanner(
                        `Sincronización completada: ${syncedCount} registro(s) respaldados en Supabase.`,
                        'success'
                    );
                } else if (failedCount > 0) {
                    this._showBanner(
                        `Sincronización parcial: ${syncedCount} subidos, ${failedCount} pendientes para reintento.`,
                        'warning'
                    );
                }
            })
        );
    }

    /**
     * Construye la columna izquierda: GPS/Simulación, Cámara y Formulario de Hallazgo.
     */
    _buildCaptureColumn() {
        // 1. Bloque de Ubicación GPS y Ruta Simulada
        const gpsBtn = createElement('button', {
            className: 'btn btn-primary',
            text: 'Obtener Ubicación GPS',
            attrs: { type: 'button', id: 'btn-capture-gps' },
            events: {
                click: () => this._handleCaptureGPS(gpsBtn)
            }
        });

        const simulateBtn = createElement('button', {
            className: 'btn btn-earth',
            text: 'Avanzar ruta (Simulación Santurbán)',
            attrs: { type: 'button', id: 'btn-advance-route' },
            events: {
                click: () => this._handleAdvanceSimulatedRoute()
            }
        });

        this._telemetryDom = {
            sourceBadge: createElement('span', {
                className: 'role-badge',
                text: 'Sin fijar'
            }),
            sectorLabel: createElement('div', {
                className: 'form-hint',
                text: 'Capture su posición con el GPS del dispositivo o use "Avanzar ruta" para pruebas académicas.'
            }),
            latVal: createElement('div', { className: 'telemetry-value', text: '---' }),
            lngVal: createElement('div', { className: 'telemetry-value', text: '---' }),
            altVal: createElement('div', { className: 'telemetry-value', text: '---' }),
            accVal: createElement('div', { className: 'telemetry-value', text: '---' }),
            timeVal: createElement('div', { className: 'telemetry-value', text: '---' })
        };

        const telemetryBox = createElement('div', {
            className: 'telemetry-box',
            children: [
                createElement('div', {
                    className: 'panel-header',
                    children: [
                        createElement('strong', { text: '1. Coordenadas y Altitud del Hallazgo' }),
                        this._telemetryDom.sourceBadge
                    ]
                }),
                createElement('div', {
                    className: 'action-button-group',
                    children: [gpsBtn, simulateBtn]
                }),
                this._telemetryDom.sectorLabel,
                createElement('div', {
                    className: 'telemetry-grid',
                    children: [
                        this._createTelemetryCell('Latitud', this._telemetryDom.latVal),
                        this._createTelemetryCell('Longitud', this._telemetryDom.lngVal),
                        this._createTelemetryCell('Altitud (m s.n.m.)', this._telemetryDom.altVal),
                        this._createTelemetryCell('Precisión (±m)', this._telemetryDom.accVal),
                        this._createTelemetryCell('Hora Captura', this._telemetryDom.timeVal)
                    ]
                }),
                createElement('div', {
                    className: 'map-container-box map-container-small',
                    attrs: { id: 'field-mini-map', style: 'margin-top: 0.85rem;' }
                })
            ]
        });

        // 2. Bloque de Fotografía y Compresión en Dispositivo
        const cameraInput = createElement('input', {
            className: 'hidden',
            attrs: {
                type: 'file',
                accept: 'image/*',
                capture: 'environment',
                id: 'input-camera-capture'
            },
            events: {
                change: (e) => this._handlePhotoSelection(e.target.files, e.target)
            }
        });

        const galleryInput = createElement('input', {
            className: 'hidden',
            attrs: {
                type: 'file',
                accept: 'image/*',
                multiple: 'multiple',
                id: 'input-gallery-select'
            },
            events: {
                change: (e) => this._handlePhotoSelection(e.target.files, e.target)
            }
        });

        const openCameraBtn = createElement('button', {
            className: 'btn btn-secondary',
            text: 'Abrir Cámara',
            attrs: { type: 'button' },
            events: { click: () => cameraInput.click() }
        });

        const openGalleryBtn = createElement('button', {
            className: 'btn btn-secondary',
            text: 'Seleccionar Imagen del Dispositivo',
            attrs: { type: 'button' },
            events: { click: () => galleryInput.click() }
        });

        this._photoGridContainer = createElement('div', {
            className: 'photo-preview-grid'
        });

        const photoSection = createElement('div', {
            className: 'telemetry-box',
            children: [
                createElement('div', {
                    className: 'panel-header',
                    children: [
                        createElement('strong', { text: '2. Evidencia Fotográfica (Compresión Automática)' })
                    ]
                }),
                cameraInput,
                galleryInput,
                createElement('div', {
                    className: 'action-button-group',
                    children: [openCameraBtn, openGalleryBtn]
                }),
                createElement('span', {
                    className: 'form-hint',
                    text: 'Las fotografías se comprimen localmente en JPEG (calidad científica 82%) y conservan las coordenadas y hora exactas de captura.'
                }),
                this._photoGridContainer
            ]
        });

        // 3. Selector de Expedición + Botón Nueva Expedición
        this._expeditionSelect = createElement('select', {
            className: 'form-select',
            attrs: { id: 'field-expedition-select' }
        });

        const newExpBtn = createElement('button', {
            className: 'btn btn-secondary btn-sm',
            text: '+ Nueva Expedición',
            attrs: { type: 'button' },
            events: { click: () => this._openNewExpeditionModal() }
        });

        const expeditionGroup = createElement('div', {
            className: 'form-group',
            children: [
                createElement('div', {
                    style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;',
                    children: [
                        createElement('label', {
                            className: 'form-label',
                            text: '3. Expedición Asociada',
                            attrs: { for: 'field-expedition-select', style: 'margin-bottom:0;' }
                        }),
                        newExpBtn
                    ]
                }),
                this._expeditionSelect
            ]
        });

        // 4. Selector Táctil de Categoría del Hallazgo
        const categoryChipsContainer = createElement('div', {
            className: 'category-grid',
            attrs: { role: 'radiogroup', 'aria-label': 'Categoría del hallazgo' }
        });

        const renderCategoryChips = () => {
            clearElement(categoryChipsContainer);
            for (const cat of ENV.FINDING_CATEGORIES) {
                const isSelected = cat.id === this._selectedCategory;
                const chip = createElement('button', {
                    className: [
                        'category-chip',
                        isSelected ? 'active' : '',
                        cat.isAlert ? 'alert-chip' : ''
                    ],
                    text: cat.label,
                    attrs: {
                        type: 'button',
                        role: 'radio',
                        'aria-checked': String(isSelected)
                    },
                    events: {
                        click: () => {
                            this._selectedCategory = cat.id;
                            renderCategoryChips();
                            this._updateSpeciesRequirementUI();
                        }
                    }
                });
                categoryChipsContainer.appendChild(chip);
            }
        };
        renderCategoryChips();

        // 5. Nombre de la especie y Descripción
        this._speciesInput = createElement('input', {
            className: 'form-input',
            attrs: {
                type: 'text',
                id: 'field-species-name',
                placeholder: 'Ej: Espeletia grandiflora (Frailejón) / Tremarctos ornatus'
            }
        });

        this._speciesGroup = createElement('div', {
            className: 'form-group',
            children: [
                createElement('label', {
                    className: 'form-label',
                    attrs: { id: 'field-species-label', for: 'field-species-name' },
                    text: 'Nombre de la Especie (Obligatorio para Especie nativa)'
                }),
                this._speciesInput
            ]
        });

        this._descriptionInput = createElement('textarea', {
            className: 'form-textarea',
            attrs: {
                id: 'field-description',
                placeholder: 'Describa el estado del individuo, condiciones del microhábitat o severidad de la afectación ambiental...'
            }
        });

        const submitFindingBtn = createElement('button', {
            className: 'btn btn-primary btn-block btn-large',
            text: 'Registrar Hallazgo Ambiental',
            attrs: { type: 'submit', id: 'btn-submit-finding' }
        });

        const form = createElement('form', {
            events: {
                submit: async (e) => {
                    e.preventDefault();
                    await this._handleFindingSubmit(submitFindingBtn);
                }
            },
            children: [
                telemetryBox,
                photoSection,
                expeditionGroup,
                createElement('div', {
                    className: 'form-group',
                    children: [
                        createElement('label', {
                            className: 'form-label',
                            text: '4. Categoría del Hallazgo'
                        }),
                        categoryChipsContainer
                    ]
                }),
                this._speciesGroup,
                createElement('div', {
                    className: 'form-group',
                    children: [
                        createElement('label', {
                            className: 'form-label',
                            text: 'Observaciones y Descripción de Campo',
                            attrs: { for: 'field-description' }
                        }),
                        this._descriptionInput
                    ]
                }),
                submitFindingBtn
            ]
        });

        return createElement('section', {
            className: 'panel-card',
            children: [
                createElement('div', {
                    className: 'panel-header',
                    children: [
                        createElement('h2', {
                            className: 'panel-title',
                            text: 'Captura de Hallazgo en Campo'
                        })
                    ]
                }),
                form
            ]
        });
    }

    /**
     * Construye la columna derecha: Estado de Sincronización Offline-First e Historial del Guardabosque.
     */
    _buildSyncAndHistoryColumn() {
        this._syncStatusText = createElement('p', {
            className: 'form-hint',
            text: 'Verificando cola local en IndexedDB...'
        });

        this._syncBtn = createElement('button', {
            className: 'btn btn-primary btn-block',
            text: 'Sincronizar Registros Pendientes Ahora',
            attrs: { type: 'button', id: 'btn-manual-sync' },
            events: {
                click: () => this._handleManualSync()
            }
        });

        const syncCard = createElement('section', {
            className: 'panel-card',
            children: [
                createElement('div', {
                    className: 'panel-header',
                    children: [
                        createElement('h2', {
                            className: 'panel-title',
                            text: 'Sincronización Offline-First'
                        })
                    ]
                }),
                this._syncStatusText,
                createElement('div', {
                    style: 'margin-top: 0.85rem;',
                    children: [this._syncBtn]
                })
            ]
        });

        this._recordsListContainer = createElement('div', {
            className: 'records-list'
        });

        const historyCard = createElement('section', {
            className: 'panel-card',
            children: [
                createElement('div', {
                    className: 'panel-header',
                    children: [
                        createElement('h2', {
                            className: 'panel-title',
                            text: 'Mis Hallazgos Registrados'
                        })
                    ]
                }),
                this._recordsListContainer
            ]
        });

        return createElement('div', {
            children: [syncCard, historyCard]
        });
    }

    _createTelemetryCell(label, valueNode) {
        return createElement('div', {
            className: 'telemetry-item',
            children: [
                createElement('div', { className: 'telemetry-label', text: label }),
                valueNode
            ]
        });
    }

    /**
     * Inicializa el mini-mapa Leaflet para visualizar la ubicación GPS o el avance de la ruta simulada.
     */
    _initMiniMap() {
        const mapEl = document.getElementById('field-mini-map');
        if (!mapEl || typeof L === 'undefined') return;

        this._miniMap = L.map(mapEl).setView(
            [ENV.MAP_DEFAULTS.CENTER_LAT, ENV.MAP_DEFAULTS.CENTER_LNG],
            ENV.MAP_DEFAULTS.DEFAULT_ZOOM
        );

        L.tileLayer(ENV.MAP_DEFAULTS.TILE_URL, {
            attribution: ENV.MAP_DEFAULTS.TILE_ATTRIBUTION,
            maxZoom: ENV.MAP_DEFAULTS.MAX_ZOOM
        }).addTo(this._miniMap);

        // Si ya había coordenadas en el ViewModel, mostrarlas
        if (this._viewModel.currentCoordinates) {
            this._updateTelemetryUI(this._viewModel.currentCoordinates);
        }
    }

    async _handleCaptureGPS(buttonEl) {
        buttonEl.disabled = true;
        buttonEl.textContent = 'Adquiriendo satélites GPS...';

        try {
            const coords = await this._viewModel.captureRealGPS();
            this._routeCoordsHistory = [];
            if (this._routePolyline && this._miniMap) {
                this._miniMap.removeLayer(this._routePolyline);
                this._routePolyline = null;
            }
            this._updateTelemetryUI(coords);
            this._showBanner('Ubicación GPS real capturada correctamente.', 'success');
        } catch (err) {
            this._showBanner(err.message, 'error');
        } finally {
            buttonEl.disabled = false;
            buttonEl.textContent = 'Obtener Ubicación GPS';
        }
    }

    _handleAdvanceSimulatedRoute() {
        const simCoords = this._viewModel.advanceSimulatedRoute();
        this._updateTelemetryUI(simCoords);
    }

    _updateTelemetryUI(coords) {
        if (!coords) return;

        const isSim = coords.location_source === ENV.LOCATION_SOURCES.SIMULATED;
        this._telemetryDom.sourceBadge.textContent = isSim ? 'FUENTE: SIMULATED' : 'FUENTE: GPS REAL';
        this._telemetryDom.sourceBadge.style.borderColor = isSim ? 'var(--status-warning)' : 'var(--accent-moss)';
        this._telemetryDom.sourceBadge.style.color = isSim ? 'var(--status-warning)' : 'var(--accent-moss)';

        this._telemetryDom.sectorLabel.textContent = isSim
            ? `Ruta Simulada Paso ${coords.step}/${coords.totalSteps}: ${coords.sectorName}`
            : 'Posición obtenida desde el receptor GPS del dispositivo.';

        this._telemetryDom.latVal.textContent = `${coords.latitude.toFixed(6)}°`;
        this._telemetryDom.lngVal.textContent = `${coords.longitude.toFixed(6)}°`;
        this._telemetryDom.altVal.textContent =
            coords.altitude !== null && coords.altitude !== undefined
                ? `${coords.altitude} m`
                : 'No provista';
        this._telemetryDom.accVal.textContent =
            coords.location_accuracy !== null && coords.location_accuracy !== undefined
                ? `±${coords.location_accuracy} m`
                : 'N/D';
        this._telemetryDom.timeVal.textContent = new Date(coords.captured_at).toLocaleTimeString('es-CO');

        if (this._miniMap && typeof L !== 'undefined') {
            const latLng = [coords.latitude, coords.longitude];

            if (!this._miniMapMarker) {
                this._miniMapMarker = L.marker(latLng).addTo(this._miniMap);
            } else {
                this._miniMapMarker.setLatLng(latLng);
            }

            if (isSim) {
                this._routeCoordsHistory.push(latLng);
                if (this._routePolyline) {
                    this._routePolyline.setLatLngs(this._routeCoordsHistory);
                } else {
                    this._routePolyline = L.polyline(this._routeCoordsHistory, {
                        color: '#f4a261',
                        weight: 3,
                        dashArray: '6, 6'
                    }).addTo(this._miniMap);
                }
            }

            this._miniMapMarker
                .bindPopup(
                    isSim
                        ? `<strong>Simulación:</strong> ${coords.sectorName}<br/>Altitud: ${coords.altitude} m`
                        : `<strong>Posición GPS Real</strong><br/>(${coords.latitude}, ${coords.longitude})`
                )
                .openPopup();

            this._miniMap.setView(latLng, 14);
        }
    }

    async _handlePhotoSelection(fileList, inputEl) {
        if (!fileList || fileList.length === 0) return;
        try {
            await this._viewModel.addPhotographs(fileList);
            this._renderStagedPhotos();
        } catch (err) {
            this._showBanner(err.message || 'Error al comprimir fotografía.', 'error');
        } finally {
            inputEl.value = '';
        }
    }

    _renderStagedPhotos() {
        clearElement(this._photoGridContainer);
        const photos = this._viewModel.stagedPhotos;

        for (const photo of photos) {
            const kbCompressed = Math.round(photo.file_size / 1024);
            const kbOriginal = Math.round(photo.original_size / 1024);

            const card = createElement('div', {
                className: 'photo-preview-card',
                children: [
                    createElement('img', {
                        className: 'photo-preview-img',
                        attrs: {
                            src: photo.previewUrl,
                            alt: `Vista previa ${photo.file_name}`
                        }
                    }),
                    createElement('div', {
                        className: 'photo-preview-meta',
                        children: [
                            createElement('div', {
                                text: `${photo.width}x${photo.height}px • ${kbCompressed} KB (antes ${kbOriginal} KB)`
                            }),
                            createElement('div', {
                                text:
                                    photo.latitude !== null
                                        ? `Geo: ${photo.latitude.toFixed(4)}, ${photo.longitude.toFixed(4)} (${photo.location_source})`
                                        : 'Geo: Se vinculará al guardar'
                            })
                        ]
                    }),
                    createElement('button', {
                        className: 'btn btn-danger btn-sm',
                        text: 'Quitar Foto',
                        attrs: { type: 'button', style: 'margin: 0.4rem;' },
                        events: {
                            click: () => {
                                this._viewModel.removeStagedPhoto(photo.id);
                                this._renderStagedPhotos();
                            }
                        }
                    })
                ]
            });

            this._photoGridContainer.appendChild(card);
        }
    }

    _updateSpeciesRequirementUI() {
        const label = document.getElementById('field-species-label');
        if (!label) return;
        if (this._selectedCategory === 'especie_nativa') {
            label.textContent = 'Nombre de la Especie (Obligatorio para Especie nativa *)';
            this._speciesInput.required = true;
        } else {
            label.textContent = 'Nombre de la Especie (Opcional cuando corresponda)';
            this._speciesInput.required = false;
        }
    }

    _populateExpeditionsDropdown() {
        if (!this._expeditionSelect) return;
        clearElement(this._expeditionSelect);

        this._expeditionSelect.appendChild(
            createElement('option', {
                text: '-- Sin expedición específica --',
                attrs: { value: '' }
            })
        );

        for (const exp of this._viewModel.expeditions) {
            const syncTag = exp.sync_status === SYNC_STATUS.PENDING ? ' [Local]' : '';
            this._expeditionSelect.appendChild(
                createElement('option', {
                    text: `${exp.name}${syncTag}`,
                    attrs: { value: exp.id }
                })
            );
        }
    }

    async _handleFindingSubmit(submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Guardando localmente...';

        try {
            const saved = await this._viewModel.submitFinding({
                expedition_id: this._expeditionSelect.value || null,
                category: this._selectedCategory,
                species_name: this._speciesInput.value,
                description: this._descriptionInput.value
            });

            // Limpiar campos de texto y vistas previas
            this._speciesInput.value = '';
            this._descriptionInput.value = '';
            this._renderStagedPhotos();

            await this._renderMyFindingsList();
            await this._updateSyncSummary();

            const alertNote =
                saved.category === 'foco_degradacion'
                    ? ' Se ha activado una alerta prioritaria de Foco de Degradación.'
                    : '';

            this._showBanner(
                `Hallazgo registrado con UUID ${saved.id.slice(0, 8)}... en almacenamiento local seguro.${alertNote}`,
                'success'
            );
        } catch (err) {
            this._showBanner(err.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Registrar Hallazgo Ambiental';
        }
    }

    async _handleManualSync() {
        try {
            const res = await this._viewModel.triggerManualSync();
            if (res.skipped) {
                this._showBanner(
                    'No hay conexión a internet disponible o ya hay una sincronización en curso.',
                    'warning'
                );
            } else if (res.syncedCount === 0 && res.failedCount === 0) {
                this._showBanner('Todos los registros locales ya están sincronizados con Supabase.', 'success');
            }
        } catch (err) {
            this._showBanner(err.message || 'Error al sincronizar.', 'error');
        }
    }

    async _updateSyncSummary() {
        const pendingCount = await this._viewModel.getPendingSyncCount();
        if (this._syncStatusText) {
            this._syncStatusText.textContent =
                pendingCount === 0
                    ? 'Estado: Todos sus hallazgos y fotografías están sincronizados con Supabase.'
                    : `Estado: Tiene ${pendingCount} tarea(s) en cola local esperando sincronización.`;
        }
        if (this._syncBtn) {
            this._syncBtn.disabled = false;
            this._syncBtn.textContent =
                pendingCount > 0
                    ? `Sincronizar Ahora (${pendingCount} pendiente${pendingCount > 1 ? 's' : ''})`
                    : 'Verificar y Sincronizar';
        }
    }

    async _renderMyFindingsList() {
        if (!this._recordsListContainer) return;
        clearElement(this._recordsListContainer);

        const findings = this._viewModel.myFindings;
        if (findings.length === 0) {
            this._recordsListContainer.appendChild(
                createElement('p', {
                    className: 'form-hint',
                    text: 'Aún no ha registrado hallazgos en este dispositivo.'
                })
            );
            return;
        }

        for (const item of findings) {
            const catMeta =
                ENV.FINDING_CATEGORIES.find((c) => c.id === item.category) || {
                    label: item.category
                };

            const isSynced = item.sync_status === SYNC_STATUS.SYNCED;
            const statusBadge = createElement('span', {
                className: `status-pill ${isSynced ? 'status-online' : 'status-offline'}`,
                text: isSynced ? 'Sincronizado' : item.sync_status === SYNC_STATUS.ERROR ? 'Reintento pendiente' : 'Pendiente local'
            });

            const sourceTag = createElement('span', {
                className: 'role-badge',
                text: item.location_source === 'simulated' ? 'SIMULADO' : 'GPS'
            });

            const auditBtn = createElement('button', {
                className: 'btn btn-secondary btn-sm',
                text: 'Corregir Metadato (Auditado)',
                attrs: { type: 'button' },
                events: {
                    click: () => this._openMetadataAuditModal(item)
                }
            });

            const photoCount = item.photographs?.length ?? item.photo_count ?? 0;

            const recordCard = createElement('article', {
                className: 'record-item',
                children: [
                    createElement('div', {
                        style: 'flex: 1;',
                        children: [
                            createElement('div', {
                                style: 'display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; margin-bottom:0.35rem;',
                                children: [
                                    createElement('strong', { text: catMeta.label }),
                                    sourceTag,
                                    statusBadge
                                ]
                            }),
                            item.species_name
                                ? createElement('div', {
                                      style: 'color: var(--accent-moss); font-weight:600; font-size:0.9rem;',
                                      text: `Especie: ${item.species_name}`
                                  })
                                : null,
                            createElement('p', {
                                style: 'font-size:0.88rem; color: var(--text-secondary); margin: 0.25rem 0;',
                                text: item.description || 'Sin descripción adicional.'
                            }),
                            createElement('div', {
                                className: 'form-hint',
                                text: `Coord: (${Number(item.latitude).toFixed(5)}, ${Number(item.longitude).toFixed(5)}) • Alt: ${
                                    item.altitude !== null && item.altitude !== undefined ? `${item.altitude}m` : 'N/D'
                                } • Fotos: ${photoCount} • ${formatDateTime(item.captured_at)}`
                            })
                        ].filter(Boolean)
                    }),
                    auditBtn
                ]
            });

            this._recordsListContainer.appendChild(recordCard);
        }
    }

    /**
     * Abre un modal para crear una nueva expedición (funciona tanto Online como Offline).
     */
    _openNewExpeditionModal() {
        const modalRoot = document.getElementById('modal-root');
        if (!modalRoot) return;
        clearElement(modalRoot);
        modalRoot.classList.remove('hidden');

        const nameInput = createElement('input', {
            className: 'form-input',
            attrs: {
                type: 'text',
                required: 'required',
                placeholder: 'Ej: Patrullaje Sector Laguna Brava - Noviembre'
            }
        });

        const descInput = createElement('textarea', {
            className: 'form-textarea',
            attrs: { placeholder: 'Objetivos del recorrido y cuadrante...' }
        });

        const closeModal = () => {
            modalRoot.classList.add('hidden');
            clearElement(modalRoot);
        };

        const modalForm = createElement('form', {
            events: {
                submit: async (e) => {
                    e.preventDefault();
                    try {
                        const created = await this._viewModel.createExpedition({
                            name: nameInput.value,
                            description: descInput.value
                        });
                        this._populateExpeditionsDropdown();
                        this._expeditionSelect.value = created.id;
                        await this._updateSyncSummary();
                        closeModal();
                        this._showBanner(`Expedición "${created.name}" creada y disponible.`, 'success');
                    } catch (err) {
                        alert(err.message);
                    }
                }
            },
            children: [
                createElement('div', {
                    className: 'form-group',
                    children: [
                        createElement('label', { className: 'form-label', text: 'Nombre de la Expedición *' }),
                        nameInput
                    ]
                }),
                createElement('div', {
                    className: 'form-group',
                    children: [
                        createElement('label', { className: 'form-label', text: 'Descripción' }),
                        descInput
                    ]
                }),
                createElement('div', {
                    className: 'action-button-group',
                    children: [
                        createElement('button', {
                            className: 'btn btn-primary',
                            text: 'Guardar Expedición',
                            attrs: { type: 'submit' }
                        }),
                        createElement('button', {
                            className: 'btn btn-secondary',
                            text: 'Cancelar',
                            attrs: { type: 'button' },
                            events: { click: closeModal }
                        })
                    ]
                })
            ]
        });

        const backdrop = createElement('div', {
            className: 'modal-backdrop',
            children: [
                createElement('div', {
                    className: 'modal-content',
                    children: [
                        createElement('div', {
                            className: 'panel-header',
                            children: [
                                createElement('h3', { className: 'panel-title', text: 'Crear Nueva Expedición' })
                            ]
                        }),
                        modalForm
                    ]
                })
            ]
        });

        modalRoot.appendChild(backdrop);
    }

    /**
     * Abre el modal de Corrección Auditada de Metadatos (Requisito #7).
     * Conserva el valor original inmutable en el historial de auditoría.
     * @param {Object} findingItem
     */
    _openMetadataAuditModal(findingItem) {
        const modalRoot = document.getElementById('modal-root');
        if (!modalRoot) return;
        clearElement(modalRoot);
        modalRoot.classList.remove('hidden');

        const fieldSelect = createElement('select', {
            className: 'form-select',
            children: [
                createElement('option', { text: 'Altitud (m s.n.m.)', attrs: { value: 'altitude' } }),
                createElement('option', { text: 'Nombre de Especie', attrs: { value: 'species_name' } }),
                createElement('option', { text: 'Descripción', attrs: { value: 'description' } }),
                createElement('option', { text: 'Latitud', attrs: { value: 'latitude' } }),
                createElement('option', { text: 'Longitud', attrs: { value: 'longitude' } })
            ]
        });

        const originalValueDisplay = createElement('input', {
            className: 'form-input',
            attrs: { type: 'text', readonly: 'readonly' }
        });

        const updateOriginalPreview = () => {
            const key = fieldSelect.value;
            const val = findingItem[key];
            originalValueDisplay.value = val !== null && val !== undefined ? String(val) : '(Sin valor registrado)';
        };
        fieldSelect.addEventListener('change', updateOriginalPreview);
        updateOriginalPreview();

        const newValueInput = createElement('input', {
            className: 'form-input',
            attrs: {
                type: 'text',
                required: 'required',
                placeholder: 'Ingrese el nuevo valor verificado...'
            }
        });

        const reasonInput = createElement('textarea', {
            className: 'form-textarea',
            attrs: {
                required: 'required',
                placeholder: 'Justificación obligatoria de auditoría (ej. calibración barométrica con altímetro de referencia o determinación taxonómica en herbario)...'
            }
        });

        const closeModal = () => {
            modalRoot.classList.add('hidden');
            clearElement(modalRoot);
        };

        const form = createElement('form', {
            events: {
                submit: async (e) => {
                    e.preventDefault();
                    const selectedField = fieldSelect.value;
                    try {
                        await this._viewModel.submitMetadataCorrection({
                            findingId: findingItem.id,
                            fieldName: selectedField,
                            originalValue: findingItem[selectedField],
                            correctedValue: newValueInput.value,
                            reason: reasonInput.value
                        });
                        await this._renderMyFindingsList();
                        await this._updateSyncSummary();
                        closeModal();
                        this._showBanner(
                            'Corrección auditada registrada. Se conservó el valor original, valor corregido, fecha y usuario responsable.',
                            'success'
                        );
                    } catch (err) {
                        alert(err.message);
                    }
                }
            },
            children: [
                createElement('p', {
                    className: 'form-hint',
                    style: 'margin-bottom: 1rem;',
                    text: 'Por integridad científica, ningún metadato se sobrescribe silenciosamente. Esta operación creará un registro inmutable en la tabla de auditoría.'
                }),
                createElement('div', {
                    className: 'form-group',
                    children: [
                        createElement('label', { className: 'form-label', text: 'Campo a Corregir' }),
                        fieldSelect
                    ]
                }),
                createElement('div', {
                    className: 'form-group',
                    children: [
                        createElement('label', { className: 'form-label', text: 'Valor Original (Se conservará en auditoría)' }),
                        originalValueDisplay
                    ]
                }),
                createElement('div', {
                    className: 'form-group',
                    children: [
                        createElement('label', { className: 'form-label', text: 'Valor Corregido *' }),
                        newValueInput
                    ]
                }),
                createElement('div', {
                    className: 'form-group',
                    children: [
                        createElement('label', { className: 'form-label', text: 'Motivo / Justificación Técnica *' }),
                        reasonInput
                    ]
                }),
                createElement('div', {
                    className: 'action-button-group',
                    children: [
                        createElement('button', {
                            className: 'btn btn-primary',
                            text: 'Registrar Corrección Auditada',
                            attrs: { type: 'submit' }
                        }),
                        createElement('button', {
                            className: 'btn btn-secondary',
                            text: 'Cancelar',
                            attrs: { type: 'button' },
                            events: { click: closeModal }
                        })
                    ]
                })
            ]
        });

        const backdrop = createElement('div', {
            className: 'modal-backdrop',
            children: [
                createElement('div', {
                    className: 'modal-content',
                    children: [
                        createElement('div', {
                            className: 'panel-header',
                            children: [
                                createElement('h3', {
                                    className: 'panel-title',
                                    text: 'Corrección Auditada de Metadatos'
                                })
                            ]
                        }),
                        form
                    ]
                })
            ]
        });

        modalRoot.appendChild(backdrop);
    }

    _showBanner(message, type = 'success') {
        if (!this._feedbackBanner) return;
        this._feedbackBanner.className = `alert-banner alert-${type}`;
        this._feedbackBanner.textContent = message;
        this._feedbackBanner.classList.remove('hidden');
    }

    /**
     * Limpia instancias de Leaflet y suscripciones de eventos al desmontar la vista.
     */
    destroy() {
        for (const unsub of this._unsubscribers) {
            if (typeof unsub === 'function') unsub();
        }
        this._unsubscribers = [];

        if (this._miniMap) {
            this._miniMap.remove();
            this._miniMap = null;
            this._miniMapMarker = null;
            this._routePolyline = null;
        }
    }
}