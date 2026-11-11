/**
 * @file js/app.js
 * @description Bootstrapper principal y coordinador MVVM de la aplicación
 * Monitoreo de Biodiversidad en el Páramo de Santurbán.
 */

import { ENV } from './config/env.js';
import { appEventBus, EVENTS } from './core/EventBus.js';
import { reportRepository } from './repositories/ReportRepository.js';
import { indexedDBService } from './services/IndexedDBService.js';
import { networkMonitor } from './services/NetworkMonitor.js';
import { syncService } from './services/SyncService.js';
import { adminViewModel } from './viewmodels/AdminViewModel.js';
import { authViewModel } from './viewmodels/AuthViewModel.js';
import { fieldViewModel } from './viewmodels/FieldViewModel.js';
import { AdminDashboardView } from './views/AdminDashboardView.js';
import { AuthView } from './views/AuthView.js';
import { FieldView } from './views/FieldView.js';

class SanturbanApp {
    constructor() {
        this._rootContainer = document.getElementById('app-root');
        this._networkPill = document.getElementById('network-status-pill');
        this._networkText = document.getElementById('network-status-text');
        this._queueBadge = document.getElementById('sync-queue-badge');
        this._userSessionBar = document.getElementById('user-session-bar');
        this._userRoleBadge = document.getElementById('user-role-badge');
        this._userNameLabel = document.getElementById('user-name-label');
        this._viewSwitchBtn = document.getElementById('view-switch-btn');
        this._logoutBtn = document.getElementById('logout-btn');
        this._pwaInstallBtn = document.getElementById('pwa-install-btn');

        this._currentViewInstance = null;
        this._activeMode = null; // 'field' | 'admin'
        this._deferredInstallPrompt = null;
    }

    /**
     * Arranca todos los servicios e inicializa la sesión de usuario.
     */
    async start() {
        await indexedDBService.init();

        this._bindTopbarEvents();
        this._bindGlobalObservers();
        this._registerServiceWorkerAndPWA();

        // Verificar estado inicial de conectividad y actualizar píldora visual
        const initialOnline = await networkMonitor.checkConnectivity();
        this._renderNetworkBadge(initialOnline);
        await this._refreshQueueBadge();

        // Inicializar sesión (soporta Supabase Auth online o recuperación desde caché local en frío)
        await authViewModel.initializeSession();
    }

    _bindTopbarEvents() {
        if (this._logoutBtn) {
            this._logoutBtn.addEventListener('click', async () => {
                await authViewModel.logout();
            });
        }

        // Los administradores pueden alternar entre el Dashboard SIG y la Vista de Campo
        if (this._viewSwitchBtn) {
            this._viewSwitchBtn.addEventListener('click', async () => {
                if (!authViewModel.isAdmin) return;
                const nextMode = this._activeMode === 'admin' ? 'field' : 'admin';
                await this._mountAuthenticatedWorkspace(nextMode);
            });
        }

        if (this._pwaInstallBtn) {
            this._pwaInstallBtn.addEventListener('click', async () => {
                if (!this._deferredInstallPrompt) return;
                this._deferredInstallPrompt.prompt();
                await this._deferredInstallPrompt.userChoice;
                this._deferredInstallPrompt = null;
                this._pwaInstallBtn.classList.add('hidden');
            });
        }
    }

    _bindGlobalObservers() {
        // 1. Cambios de Conectividad
        networkMonitor.subscribe(({ isOnline }) => {
            this._renderNetworkBadge(isOnline);
        });

        // 2. Cambios de Estado de Autenticación
        appEventBus.on(EVENTS.AUTH_STATE_CHANGED, async ({ isAuthenticated, profile }) => {
            if (!isAuthenticated || !profile) {
                this._renderUnauthenticatedState();
                return;
            }

            this._renderUserHeader(profile);

            // Al abrir sesión con conexión activa, sincronizar registros pendientes automáticamente (Requisito #8)
            if (networkMonitor.isOnline) {
                syncService.syncPendingQueue({ source: 'app_open' });
            }

            const defaultMode = profile.role === ENV.ROLES.ADMIN ? 'admin' : 'field';
            await this._mountAuthenticatedWorkspace(defaultMode);
        });

        // 3. Actualizaciones de la cola de sincronización
        appEventBus.on(EVENTS.QUEUE_UPDATED, ({ pendingCount }) => {
            this._updateQueueBadgeUI(pendingCount);
        });

        // 4. Notificación contextual cuando se registra un Foco de Degradación
        appEventBus.on(EVENTS.DEGRADATION_ALERT, ({ finding }) => {
            if (
                typeof window !== 'undefined' &&
                'Notification' in window &&
                Notification.permission === 'granted'
            ) {
                new Notification('Alerta Ambiental: Foco de Degradación', {
                    body: `Coordenadas (${Number(finding.latitude).toFixed(4)}, ${Number(
                        finding.longitude
                    ).toFixed(4)}). ${finding.description || ''}`,
                    tag: `degradacion-${finding.id}` // Evita notificaciones duplicadas en el SO
                });
            }
        });
    }

    _renderNetworkBadge(isOnline) {
        if (!this._networkPill || !this._networkText) return;
        this._networkPill.className = `status-pill ${isOnline ? 'status-online' : 'status-offline'}`;
        this._networkText.textContent = isOnline ? 'Conectado (Online)' : 'Modo Offline Activo';
    }

    async _refreshQueueBadge() {
        const count = await reportRepository.getPendingSyncCount();
        this._updateQueueBadgeUI(count);
    }

    _updateQueueBadgeUI(count) {
        if (!this._queueBadge) return;
        if (count > 0) {
            this._queueBadge.textContent = `${count} pendiente${count > 1 ? 's' : ''}`;
            this._queueBadge.classList.remove('hidden');
        } else {
            this._queueBadge.classList.add('hidden');
        }
    }

    _renderUserHeader(profile) {
        if (this._userSessionBar) {
            this._userSessionBar.classList.remove('hidden');
        }
        if (this._userRoleBadge) {
            this._userRoleBadge.textContent =
                profile.role === ENV.ROLES.ADMIN ? 'ADMINISTRADOR' : 'GUARDABOSQUE';
        }
        if (this._userNameLabel) {
            this._userNameLabel.textContent = profile.full_name || 'Usuario';
        }
        if (this._viewSwitchBtn) {
            if (profile.role === ENV.ROLES.ADMIN) {
                this._viewSwitchBtn.classList.remove('hidden');
            } else {
                this._viewSwitchBtn.classList.add('hidden');
            }
        }
    }

    _renderUnauthenticatedState() {
        if (this._currentViewInstance?.destroy) {
            this._currentViewInstance.destroy();
        }
        if (this._userSessionBar) {
            this._userSessionBar.classList.add('hidden');
        }

        this._activeMode = null;
        const authView = new AuthView(this._rootContainer, authViewModel);
        authView.renderLogin();
        this._currentViewInstance = authView;
    }

    /**
     * Monta la vista de Guardabosque o el Dashboard de Administrador.
     * La autorización real está garantizada en Supabase mediante RLS; además,
     * en cliente no se permite montar el Dashboard si el rol no es 'admin'.
     *
     * @param {'field'|'admin'} mode
     */
    async _mountAuthenticatedWorkspace(mode) {
        if (this._currentViewInstance?.destroy) {
            this._currentViewInstance.destroy();
        }

        const profile = authViewModel.profile;
        const effectiveMode = mode === 'admin' && authViewModel.isAdmin ? 'admin' : 'field';
        this._activeMode = effectiveMode;

        if (this._viewSwitchBtn && authViewModel.isAdmin) {
            this._viewSwitchBtn.textContent =
                effectiveMode === 'admin' ? 'Ir a Captura de Campo' : 'Volver al Dashboard SIG';
        }

        if (effectiveMode === 'admin') {
            const adminView = new AdminDashboardView(this._rootContainer, adminViewModel);
            this._currentViewInstance = adminView;
            await adminView.render();
        } else {
            await fieldViewModel.initialize(profile);
            const fieldView = new FieldView(this._rootContainer, fieldViewModel);
            this._currentViewInstance = fieldView;
            await fieldView.render();
        }
    }

    /**
     * Registra el Service Worker para soporte Offline de la PWA y escucha el evento de instalación.
     */
    _registerServiceWorkerAndPWA() {
        if (typeof window === 'undefined') return;

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this._deferredInstallPrompt = e;
            if (this._pwaInstallBtn) {
                this._pwaInstallBtn.classList.remove('hidden');
            }
        });

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', async () => {
                try {
                    const registration = await navigator.serviceWorker.register('./service-worker.js');
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        if (newWorker) {
                            newWorker.addEventListener('statechange', () => {
                                if (
                                    newWorker.state === 'installed' &&
                                    navigator.serviceWorker.controller
                                ) {
                                    console.info('[PWA] Nueva versión del Service Worker lista.');
                                }
                            });
                        }
                    });
                } catch (err) {
                    console.warn('[PWA] Registro de Service Worker omitido o fallido:', err.message);
                }
            });
        }
    }
}

const app = new SanturbanApp();
app.start();