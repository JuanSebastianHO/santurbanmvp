/**
 * @file js/views/AdminDashboardView.js
 * @description Vista del Dashboard Administrativo y Consola SIG (Leaflet + Heatmap + Exportación QGIS).
 * Construida con métodos DOM seguros contra XSS y alimentada exclusivamente con datos reales.
 */

import { ENV } from '../config/env.js';
import { SYNC_STATUS } from '../models/ReporteAmbiental.js';
import { clearElement, createElement, formatDateTime } from '../utils/dom.js';
import { MapView } from './MapView.js';

export class AdminDashboardView {
    /**
     * @param {HTMLElement} container
     * @param {import('../viewmodels/AdminViewModel.js').AdminViewModel} viewModel
     */
    constructor(container, viewModel) {
        this._container = container;
        this._viewModel = viewModel;

        /** @type {MapView|null} */
        this._mapView = null;

        // Nodos de actualización dinámica
        this._kpiGridEl = null;
        this._distributionsGridEl = null;
        this._alertsListEl = null;
        this._recentActivityEl = null;
        this._auditsListEl = null;
        this._filterInputs = {};
    }

    /**
     * Renderiza la consola administrativa completa y carga datos desde Supabase.
     */
    async render() {
        this.destroy();
        clearElement(this._container);

        // 1. Cabecera de Acciones Rápidas y Exportación SIG (QGIS)
        const refreshBtn = createElement('button', {
            className: 'btn btn-secondary btn-sm',
            text: 'Actualizar Datos',
            attrs: { type: 'button' },
            events: {
                click: async () => {
                    refreshBtn.disabled = true;
                    refreshBtn.textContent = 'Consultando Supabase...';
                    await this._viewModel.loadDashboardData();
                    this._refreshDynamicSections({ fitMapBounds: false });
                    refreshBtn.disabled = false;
                    refreshBtn.textContent = 'Actualizar Datos';
                }
            }
        });

        const exportCsvBtn = createElement('button', {
            className: 'btn btn-primary btn-sm',
            text: 'Exportar CSV (SIG / QGIS)',
            attrs: { type: 'button', id: 'btn-export-csv' },
            events: {
                click: () => this._viewModel.exportFilteredToCSV()
            }
        });

        const exportGeoJsonBtn = createElement('button', {
            className: 'btn btn-earth btn-sm',
            text: 'Exportar GeoJSON (QGIS)',
            attrs: { type: 'button', id: 'btn-export-geojson' },
            events: {
                click: () => this._viewModel.exportFilteredToGeoJSON()
            }
        });

        const headerBar = createElement('section', {
            className: 'panel-card',
            style: 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;',
            children: [
                createElement('div', {
                    children: [
                        createElement('h1', {
                            className: 'panel-title',
                            text: 'Dashboard Administrativo y Análisis SIG — Páramo de Santurbán'
                        }),
                        createElement('p', {
                            className: 'form-hint',
                            text: 'Indicadores en tiempo real desde Supabase PostgreSQL y distribución geográfica de hallazgos.'
                        })
                    ]
                }),
                createElement('div', {
                    className: 'action-button-group',
                    children: [refreshBtn, exportCsvBtn, exportGeoJsonBtn]
                })
            ]
        });

        // 2. Tarjetas de Indicadores Generales (KPIs)
        this._kpiGridEl = createElement('section', {
            className: 'kpi-grid',
            attrs: { 'aria-label': 'Indicadores clave de biodiversidad' }
        });

        // 3. Barra de Filtros Multicriterio (Requisito #10)
        const filterPanel = this._buildFilterPanel();

        // 4. Área Principal: Mapa Interactivo + Mapa de Calor (Izquierda) y Alertas Tempranas (Derecha)
        const mapPanel = this._buildMapSection();
        const alertsPanel = this._buildAlertsSection();

        const mainWorkspace = createElement('div', {
            className: 'admin-workspace-grid',
            children: [mapPanel, alertsPanel]
        });

        // 5. Desgloses Estadísticos (Por Categoría, Rango Altitudinal y Periodo)
        this._distributionsGridEl = createElement('div', {
            className: 'kpi-grid',
            style: 'grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));'
        });

        // 6. Actividad Reciente y Auditoría de Metadatos
        this._recentActivityEl = createElement('div', { className: 'records-list' });
        this._auditsListEl = createElement('div', { className: 'records-list' });

        const bottomGrid = createElement('div', {
            className: 'admin-workspace-grid',
            children: [
                createElement('section', {
                    className: 'panel-card',
                    children: [
                        createElement('div', {
                            className: 'panel-header',
                            children: [
                                createElement('h2', {
                                    className: 'panel-title',
                                    text: 'Actividad Reciente y Fotografías Autorizadas'
                                })
                            ]
                        }),
                        this._recentActivityEl
                    ]
                }),
                createElement('section', {
                    className: 'panel-card',
                    children: [
                        createElement('div', {
                            className: 'panel-header',
                            children: [
                                createElement('h2', {
                                    className: 'panel-title',
                                    text: 'Trazabilidad de Correcciones de Metadatos'
                                })
                            ]
                        }),
                        this._auditsListEl
                    ]
                })
            ]
        });

        this._container.appendChild(headerBar);
        this._container.appendChild(this._kpiGridEl);
        this._container.appendChild(filterPanel);
        this._container.appendChild(mainWorkspace);
        this._container.appendChild(this._distributionsGridEl);
        this._container.appendChild(bottomGrid);

        // Inicializar Mapa Leaflet + Heatmap
        this._mapView = new MapView('admin-main-map', {
            resolvePhotoUrlCallback: (photo) => this._viewModel.resolvePhotoUrl(photo)
        });
        this._mapView.initMap();

        // Cargar datos reales y poblar UI
        await this._viewModel.loadDashboardData();
        this._refreshDynamicSections({ fitMapBounds: true });
    }

    /**
     * Construye el panel de filtros (Categoría, Rango de Altitud, Intervalo de Fechas, Fuente de Observación).
     */
    _buildFilterPanel() {
        const categorySelect = createElement('select', {
            className: 'form-select',
            attrs: { id: 'filter-category' },
            children: [
                createElement('option', { text: 'Todas las categorías', attrs: { value: 'all' } }),
                ...ENV.FINDING_CATEGORIES.map((c) =>
                    createElement('option', { text: c.label, attrs: { value: c.id } })
                )
            ]
        });

        const sourceSelect = createElement('select', {
            className: 'form-select',
            attrs: { id: 'filter-source' },
            children: [
                createElement('option', {
                    text: 'Todas las observaciones (GPS + Simuladas)',
                    attrs: { value: 'all' }
                }),
                createElement('option', {
                    text: 'Solo Ubicaciones GPS Reales',
                    attrs: { value: ENV.LOCATION_SOURCES.GPS }
                }),
                createElement('option', {
                    text: 'Solo Ruta Simulada (Académica)',
                    attrs: { value: ENV.LOCATION_SOURCES.SIMULATED }
                })
            ]
        });

        const minAltInput = createElement('input', {
            className: 'form-input',
            attrs: {
                type: 'number',
                id: 'filter-min-alt',
                placeholder: 'Ej: 3000',
                step: '50'
            }
        });

        const maxAltInput = createElement('input', {
            className: 'form-input',
            attrs: {
                type: 'number',
                id: 'filter-max-alt',
                placeholder: 'Ej: 4100',
                step: '50'
            }
        });

        const dateFromInput = createElement('input', {
            className: 'form-input',
            attrs: { type: 'date', id: 'filter-date-from' }
        });

        const dateToInput = createElement('input', {
            className: 'form-input',
            attrs: { type: 'date', id: 'filter-date-to' }
        });

        this._filterInputs = {
            categorySelect,
            sourceSelect,
            minAltInput,
            maxAltInput,
            dateFromInput,
            dateToInput
        };

        const handleFilterChange = () => {
            this._viewModel.applyFilters({
                category: categorySelect.value,
                observationSource: sourceSelect.value,
                minAltitude: minAltInput.value,
                maxAltitude: maxAltInput.value,
                dateFrom: dateFromInput.value,
                dateTo: dateToInput.value
            });
            this._refreshDynamicSections({ fitMapBounds: false });
        };

        for (const inputEl of Object.values(this._filterInputs)) {
            inputEl.addEventListener('change', handleFilterChange);
            if (inputEl.tagName === 'INPUT') {
                inputEl.addEventListener('input', handleFilterChange);
            }
        }

        const clearFiltersBtn = createElement('button', {
            className: 'btn btn-secondary btn-sm',
            text: 'Limpiar Filtros',
            attrs: { type: 'button' },
            events: {
                click: () => {
                    categorySelect.value = 'all';
                    sourceSelect.value = 'all';
                    minAltInput.value = '';
                    maxAltInput.value = '';
                    dateFromInput.value = '';
                    dateToInput.value = '';
                    this._viewModel.resetFilters();
                    this._refreshDynamicSections({ fitMapBounds: true });
                }
            }
        });

        return createElement('section', {
            className: 'panel-card',
            children: [
                createElement('div', {
                    className: 'panel-header',
                    children: [
                        createElement('h2', {
                            className: 'panel-title',
                            text: 'Filtros Espaciales, Altitudinales y Temporales'
                        }),
                        clearFiltersBtn
                    ]
                }),
                createElement('div', {
                    className: 'filter-bar-grid',
                    children: [
                        createElement('div', {
                            children: [
                                createElement('label', {
                                    className: 'form-label',
                                    text: 'Categoría del Hallazgo',
                                    attrs: { for: 'filter-category' }
                                }),
                                categorySelect
                            ]
                        }),
                        createElement('div', {
                            children: [
                                createElement('label', {
                                    className: 'form-label',
                                    text: 'Tipo / Fuente de Observación',
                                    attrs: { for: 'filter-source' }
                                }),
                                sourceSelect
                            ]
                        }),
                        createElement('div', {
                            children: [
                                createElement('label', {
                                    className: 'form-label',
                                    text: 'Rango de Altitud (m s.n.m.)'
                                }),
                                createElement('div', {
                                    style: 'display:flex; gap:0.5rem;',
                                    children: [minAltInput, maxAltInput]
                                })
                            ]
                        }),
                        createElement('div', {
                            children: [
                                createElement('label', {
                                    className: 'form-label',
                                    text: 'Intervalo de Fechas'
                                }),
                                createElement('div', {
                                    style: 'display:flex; gap:0.5rem;',
                                    children: [dateFromInput, dateToInput]
                                })
                            ]
                        })
                    ]
                })
            ]
        });
    }

    /**
     * Construye el contenedor del mapa Leaflet y conmutadores de Marcadores y Mapa de Calor.
     */
    _buildMapSection() {
        const markersCheckbox = createElement('input', {
            attrs: { type: 'checkbox', checked: 'checked', id: 'toggle-map-markers' },
            events: {
                change: (e) => this._mapView?.setMarkersVisibility(e.target.checked)
            }
        });

        const heatCheckbox = createElement('input', {
            attrs: { type: 'checkbox', checked: 'checked', id: 'toggle-map-heat' },
            events: {
                change: (e) => this._mapView?.setHeatmapVisibility(e.target.checked)
            }
        });

        return createElement('section', {
            className: 'panel-card',
            children: [
                createElement('div', {
                    className: 'panel-header',
                    children: [
                        createElement('h2', {
                            className: 'panel-title',
                            text: 'Mapa de Hallazgos y Mapa de Calor (Leaflet + OpenStreetMap)'
                        }),
                        createElement('div', {
                            style: 'display:flex; gap:1rem; align-items:center; font-size:0.88rem;',
                            children: [
                                createElement('label', {
                                    style: 'display:flex; align-items:center; gap:0.35rem; cursor:pointer;',
                                    children: [
                                        markersCheckbox,
                                        createElement('span', { text: 'Mostrar Marcadores' })
                                    ]
                                }),
                                createElement('label', {
                                    style: 'display:flex; align-items:center; gap:0.35rem; cursor:pointer;',
                                    children: [
                                        heatCheckbox,
                                        createElement('span', { text: 'Mostrar Mapa de Calor' })
                                    ]
                                })
                            ]
                        })
                    ]
                }),
                createElement('div', {
                    className: 'map-container-box',
                    attrs: { id: 'admin-main-map' }
                })
            ]
        });
    }

    /**
     * Construye el centro de alertas de `foco_degradacion` y solicitud contextual de notificaciones.
     */
    _buildAlertsSection() {
        const notifyPermBtn = createElement('button', {
            className: 'btn btn-secondary btn-sm',
            text: 'Activar Avisos del Navegador',
            attrs: { type: 'button' },
            events: {
                click: async () => {
                    const status = await this._viewModel.requestContextualBrowserNotifications();
                    if (status === 'granted') {
                        notifyPermBtn.textContent = 'Avisos Activos';
                        notifyPermBtn.disabled = true;
                    }
                }
            }
        });

        this._alertsListEl = createElement('div', {
            className: 'records-list',
            style: 'max-height: 440px; overflow-y: auto;'
        });

        return createElement('section', {
            className: 'panel-card',
            children: [
                createElement('div', {
                    className: 'panel-header',
                    children: [
                        createElement('h2', {
                            className: 'panel-title',
                            text: 'Alertas Ambientales (Focos de Degradación)'
                        }),
                        notifyPermBtn
                    ]
                }),
                this._alertsListEl
            ]
        });
    }

    /**
     * Actualiza todos los widgets del Dashboard cuando cambian los datos o filtros.
     * @param {{ fitMapBounds?: boolean }} [options]
     */
    _refreshDynamicSections(options = {}) {
        const metrics = this._viewModel.computeMetrics();

        this._renderKPIs(metrics);
        this._renderDistributions(metrics);
        this._renderAlertsList();
        this._renderRecentActivity(metrics.recentActivity);
        this._renderMetadataAudits();

        if (this._mapView) {
            this._mapView.updateData(this._viewModel.filteredFindings, {
                fitBounds: Boolean(options.fitMapBounds)
            });
        }
    }

    _renderKPIs(metrics) {
        if (!this._kpiGridEl) return;
        clearElement(this._kpiGridEl);

        const kpiItems = [
            { label: 'Total de Hallazgos (Filtrados)', value: metrics.totalFindings },
            { label: 'Total de Fotografías', value: metrics.totalPhotographs },
            { label: 'Total de Especies Registradas', value: metrics.totalUniqueSpecies },
            { label: 'Expediciones Registradas', value: this._viewModel.expeditions.length },
            { label: 'Pendientes de Sincronización', value: metrics.pendingSyncRecords }
        ];

        for (const item of kpiItems) {
            this._kpiGridEl.appendChild(
                createElement('div', {
                    className: 'kpi-card',
                    children: [
                        createElement('div', { className: 'kpi-value', text: String(item.value) }),
                        createElement('div', { className: 'kpi-label', text: item.label })
                    ]
                })
            );
        }
    }

    _renderDistributions(metrics) {
        if (!this._distributionsGridEl) return;
        clearElement(this._distributionsGridEl);

        // 1. Hallazgos por Categoría
        const catRows = metrics.byCategory.map((c) =>
            createElement('div', {
                style: 'display:flex; justify-content:space-between; padding:0.35rem 0; border-bottom:1px solid var(--border-color); font-size:0.9rem;',
                children: [
                    createElement('span', { text: c.label }),
                    createElement('strong', {
                        style: 'font-family: var(--font-mono);',
                        text: String(c.count)
                    })
                ]
            })
        );

        // 2. Hallazgos por Altitud
        const altRows = metrics.byAltitudeBand.map(([bandLabel, count]) =>
            createElement('div', {
                style: 'display:flex; justify-content:space-between; padding:0.35rem 0; border-bottom:1px solid var(--border-color); font-size:0.9rem;',
                children: [
                    createElement('span', { text: bandLabel }),
                    createElement('strong', {
                        style: 'font-family: var(--font-mono);',
                        text: String(count)
                    })
                ]
            })
        );

        // 3. Hallazgos por Periodo (Mes)
        const periodRows =
            metrics.byPeriodMonth.length > 0
                ? metrics.byPeriodMonth.map(([period, count]) =>
                      createElement('div', {
                          style: 'display:flex; justify-content:space-between; padding:0.35rem 0; border-bottom:1px solid var(--border-color); font-size:0.9rem;',
                          children: [
                              createElement('span', { text: `Periodo ${period}` }),
                              createElement('strong', {
                                  style: 'font-family: var(--font-mono);',
                                  text: String(count)
                              })
                          ]
                      })
                  )
                : [
                      createElement('p', {
                          className: 'form-hint',
                          text: 'Sin registros para el intervalo seleccionado.'
                      })
                  ];

        this._distributionsGridEl.appendChild(
            createElement('section', {
                className: 'panel-card',
                children: [
                    createElement('h3', {
                        className: 'panel-title',
                        style: 'margin-bottom:0.75rem;',
                        text: 'Hallazgos por Categoría'
                    }),
                    ...catRows
                ]
            })
        );

        this._distributionsGridEl.appendChild(
            createElement('section', {
                className: 'panel-card',
                children: [
                    createElement('h3', {
                        className: 'panel-title',
                        style: 'margin-bottom:0.75rem;',
                        text: 'Hallazgos por Franja de Altitud'
                    }),
                    ...altRows
                ]
            })
        );

        this._distributionsGridEl.appendChild(
            createElement('section', {
                className: 'panel-card',
                children: [
                    createElement('h3', {
                        className: 'panel-title',
                        style: 'margin-bottom:0.75rem;',
                        text: 'Hallazgos por Periodo (YYYY-MM)'
                    }),
                    ...periodRows
                ]
            })
        );
    }

    _renderAlertsList() {
        if (!this._alertsListEl) return;
        clearElement(this._alertsListEl);

        const alerts = this._viewModel.alerts;
        if (alerts.length === 0) {
            this._alertsListEl.appendChild(
                createElement('p', {
                    className: 'form-hint',
                    text: 'No hay alertas activas registradas.'
                })
            );
            return;
        }

        for (const alertItem of alerts) {
            const isSynced = alertItem.sync_status === SYNC_STATUS.SYNCED;
            const syncBadge = createElement('span', {
                className: `status-pill ${isSynced ? 'status-online' : 'status-offline'}`,
                text: isSynced ? 'Sincronizado en Supabase' : 'Pendiente Local'
            });

            const relatedFinding = this._viewModel.allFindings.find(
                (f) => f.id === alertItem.finding_id
            );

            const locateBtn = relatedFinding
                ? createElement('button', {
                      className: 'btn btn-secondary btn-sm',
                      text: 'Ver en Mapa',
                      attrs: { type: 'button' },
                      events: {
                          click: () => {
                              this._mapView?.focusCoordinates(
                                  relatedFinding.latitude,
                                  relatedFinding.longitude,
                                  16
                              );
                          }
                      }
                  })
                : null;

            const card = createElement('article', {
                className: 'record-item',
                style:
                    alertItem.notification_type === 'foco_degradacion'
                        ? 'border-left: 4px solid var(--status-danger);'
                        : '',
                children: [
                    createElement('div', {
                        style: 'flex:1;',
                        children: [
                            createElement('div', {
                                style: 'display:flex; justify-content:space-between; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.3rem;',
                                children: [
                                    createElement('strong', { text: alertItem.title }),
                                    syncBadge
                                ]
                            }),
                            createElement('p', {
                                style: 'font-size:0.86rem; color: var(--text-secondary); margin-bottom:0.3rem;',
                                text: alertItem.message
                            }),
                            createElement('div', {
                                className: 'form-hint',
                                text: `Fecha: ${formatDateTime(alertItem.created_at)} • ID Hallazgo: ${
                                    alertItem.finding_id ? alertItem.finding_id.slice(0, 8) : 'N/A'
                                }`
                            })
                        ]
                    }),
                    locateBtn
                ].filter(Boolean)
            });

            this._alertsListEl.appendChild(card);
        }
    }

    _renderRecentActivity(recentFindings) {
        if (!this._recentActivityEl) return;
        clearElement(this._recentActivityEl);

        if (!recentFindings || recentFindings.length === 0) {
            this._recentActivityEl.appendChild(
                createElement('p', {
                    className: 'form-hint',
                    text: 'No se encontraron hallazgos con los filtros seleccionados.'
                })
            );
            return;
        }

        for (const item of recentFindings) {
            const catMeta = ENV.FINDING_CATEGORIES.find((c) => c.id === item.category) || {
                label: item.category
            };

            const isSynced = item.sync_status === SYNC_STATUS.SYNCED;
            const photos = Array.isArray(item.photographs) ? item.photographs : [];

            const viewPhotosBtn =
                photos.length > 0
                    ? createElement('button', {
                          className: 'btn btn-secondary btn-sm',
                          text: `Ver ${photos.length} Foto(s)`,
                          attrs: { type: 'button' },
                          events: {
                              click: () => this._openPhotosModal(item, photos)
                          }
                      })
                    : null;

            const focusMapBtn = createElement('button', {
                className: 'btn btn-secondary btn-sm',
                text: 'Ubicar',
                attrs: { type: 'button' },
                events: {
                    click: () => this._mapView?.focusCoordinates(item.latitude, item.longitude, 16)
                }
            });

            const row = createElement('article', {
                className: 'record-item',
                children: [
                    createElement('div', {
                        style: 'flex:1;',
                        children: [
                            createElement('div', {
                                style: 'display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;',
                                children: [
                                    createElement('strong', { text: catMeta.label }),
                                    createElement('span', {
                                        className: 'role-badge',
                                        text: item.location_source === 'simulated' ? 'SIMULADO' : 'GPS'
                                    }),
                                    createElement('span', {
                                        className: `status-pill ${isSynced ? 'status-online' : 'status-offline'}`,
                                        text: isSynced ? 'Sincronizado' : 'Pendiente'
                                    })
                                ]
                            }),
                            item.species_name
                                ? createElement('div', {
                                      style: 'color: var(--accent-moss); font-weight:600; font-size:0.9rem; margin-top:0.2rem;',
                                      text: `Especie: ${item.species_name}`
                                  })
                                : null,
                            createElement('p', {
                                style: 'font-size:0.86rem; color: var(--text-secondary); margin:0.2rem 0;',
                                text: item.description || 'Sin descripción.'
                            }),
                            createElement('div', {
                                className: 'form-hint',
                                text: `(${Number(item.latitude).toFixed(5)}, ${Number(item.longitude).toFixed(5)}) • Altitud: ${
                                    item.altitude ?? 'N/D'
                                } m • ${formatDateTime(item.captured_at)}`
                            })
                        ].filter(Boolean)
                    }),
                    createElement('div', {
                        style: 'display:flex; gap:0.4rem;',
                        children: [viewPhotosBtn, focusMapBtn].filter(Boolean)
                    })
                ]
            });

            this._recentActivityEl.appendChild(row);
        }
    }

    _renderMetadataAudits() {
        if (!this._auditsListEl) return;
        clearElement(this._auditsListEl);

        const audits = this._viewModel.metadataAudits;
        if (!audits || audits.length === 0) {
            this._auditsListEl.appendChild(
                createElement('p', {
                    className: 'form-hint',
                    text: 'No se han registrado correcciones auditadas de metadatos hasta el momento.'
                })
            );
            return;
        }

        for (const a of audits.slice(0, 10)) {
            this._auditsListEl.appendChild(
                createElement('div', {
                    className: 'record-item',
                    children: [
                        createElement('div', {
                            children: [
                                createElement('strong', {
                                    text: `Campo corregido: ${a.field_name} (${a.target_table})`
                                }),
                                createElement('div', {
                                    style: 'font-size: 0.85rem; margin-top: 0.2rem;',
                                    text: `Valor original: "${a.original_value ?? 'N/A'}" → Valor corregido: "${a.corrected_value}"`
                                }),
                                createElement('div', {
                                    className: 'form-hint',
                                    text: `Justificación: ${a.reason} • Fecha: ${formatDateTime(a.corrected_at)}`
                                })
                            ]
                        })
                    ]
                })
            );
        }
    }

    /**
     * Abre un modal seguro para visualizar las fotografías autorizadas de un hallazgo mediante URLs firmadas.
     */
    async _openPhotosModal(finding, photos) {
        const modalRoot = document.getElementById('modal-root');
        if (!modalRoot) return;
        clearElement(modalRoot);
        modalRoot.classList.remove('hidden');

        const closeModal = () => {
            modalRoot.classList.add('hidden');
            clearElement(modalRoot);
        };

        const grid = createElement('div', {
            className: 'photo-preview-grid',
            style: 'margin-bottom: 1rem;'
        });

        for (const p of photos) {
            const imgSlot = createElement('div', {
                className: 'photo-preview-card',
                children: [
                    createElement('div', {
                        style: 'padding: 1rem; font-size:0.8rem;',
                        text: 'Solicitando firma de acceso privado...'
                    })
                ]
            });
            grid.appendChild(imgSlot);

            this._viewModel.resolvePhotoUrl(p).then((url) => {
                clearElement(imgSlot);
                if (url) {
                    imgSlot.appendChild(
                        createElement('img', {
                            className: 'photo-preview-img',
                            attrs: {
                                src: url,
                                alt: p.file_name || 'Fotografía de hallazgo',
                                style: 'height: 180px;'
                            }
                        })
                    );
                }
                imgSlot.appendChild(
                    createElement('div', {
                        className: 'photo-preview-meta',
                        text: `Coord foto: (${p.latitude ?? 'N/D'}, ${p.longitude ?? 'N/D'}) • Alt: ${
                            p.altitude ?? 'N/D'
                        } m • Fuente: ${p.location_source ?? 'N/D'}`
                    })
                );
            });
        }

        const backdrop = createElement('div', {
            className: 'modal-backdrop',
            children: [
                createElement('div', {
                    className: 'modal-content',
                    style: 'max-width: 680px;',
                    children: [
                        createElement('div', {
                            className: 'panel-header',
                            children: [
                                createElement('h3', {
                                    className: 'panel-title',
                                    text: `Evidencias Fotográficas (Bucket Privado: ${ENV.STORAGE_BUCKET})`
                                }),
                                createElement('button', {
                                    className: 'btn btn-secondary btn-sm',
                                    text: 'Cerrar',
                                    attrs: { type: 'button' },
                                    events: { click: closeModal }
                                })
                            ]
                        }),
                        grid
                    ]
                })
            ]
        });

        modalRoot.appendChild(backdrop);
    }

    destroy() {
        if (this._mapView) {
            this._mapView.destroy();
            this._mapView = null;
        }
    }
}