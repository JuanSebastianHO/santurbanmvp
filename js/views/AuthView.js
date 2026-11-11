/**
 * @file js/views/AuthView.js
 * @description Vista de inicio de sesión de SanturBio con logo oficial.
 * Construida íntegramente con createElement y textContent para protección contra XSS.
 */

import { createElement, clearElement } from '../utils/dom.js';

export class AuthView {
    /**
     * @param {HTMLElement} containerElement
     * @param {import('../viewmodels/AuthViewModel.js').AuthViewModel} viewModel
     */
    constructor(containerElement, viewModel) {
        this._container = containerElement;
        this._viewModel = viewModel;
        this._errorBanner = null;
        this._submitBtn = null;
    }

    /**
     * Renderiza la pantalla de inicio de sesión.
     */
    renderLogin() {
        clearElement(this._container);

        this._errorBanner = createElement('div', {
            className: 'alert-banner alert-error hidden',
            attrs: { role: 'alert', 'aria-live': 'assertive' }
        });

        const emailInput = createElement('input', {
            className: 'form-input',
            attrs: {
                type: 'email',
                id: 'login-email',
                name: 'email',
                required: 'required',
                autocomplete: 'email',
                placeholder: 'guardabosque@santurbio.org'
            }
        });

        const passwordInput = createElement('input', {
            className: 'form-input',
            attrs: {
                type: 'password',
                id: 'login-password',
                name: 'password',
                required: 'required',
                autocomplete: 'current-password',
                placeholder: '••••••••'
            }
        });

        this._submitBtn = createElement('button', {
            className: 'btn btn-primary btn-block btn-large',
            text: 'Iniciar Sesión en SanturBio',
            attrs: { type: 'submit' }
        });

        const form = createElement('form', {
            className: 'auth-form',
            events: {
                submit: async (e) => {
                    e.preventDefault();
                    await this._handleLoginSubmit(emailInput.value, passwordInput.value);
                }
            },
            children: [
                this._errorBanner,
                createElement('div', {
                    className: 'form-group',
                    children: [
                        createElement('label', {
                            className: 'form-label',
                            text: 'Correo Electrónico Institucional',
                            attrs: { for: 'login-email' }
                        }),
                        emailInput
                    ]
                }),
                createElement('div', {
                    className: 'form-group',
                    children: [
                        createElement('label', {
                            className: 'form-label',
                            text: 'Contraseña',
                            attrs: { for: 'login-password' }
                        }),
                        passwordInput
                    ]
                }),
                this._submitBtn
            ]
        });

        const card = createElement('section', {
            className: 'auth-card',
            children: [
                createElement('div', {
                    className: 'auth-header',
                    children: [
                        createElement('img', {
                            attrs: {
                                src: './assets/icons/app-icon.svg',
                                alt: 'Logo SanturBio',
                                width: '78',
                                height: '78',
                                style: 'border-radius: 50%; margin-bottom: 0.75rem; box-shadow: 0 6px 18px rgba(0,0,0,0.35);'
                            }
                        }),
                        createElement('div', {
                            children: [
                                createElement('span', {
                                    className: 'ecosystem-badge',
                                    text: 'PÁRAMO DE SANTURBÁN • 2.800 - 4.290 m s.n.m.'
                                })
                            ]
                        }),
                        createElement('h1', {
                            className: 'auth-title',
                            text: 'SanturBio'
                        }),
                        createElement('p', {
                            className: 'auth-subtitle',
                            text: 'Sistema Offline-First de Monitoreo de Biodiversidad y Alertas Tempranas'
                        })
                    ]
                }),
                form,
                createElement('div', {
                    className: 'auth-footer-note',
                    children: [
                        createElement('p', {
                            text: 'Acceso protegido mediante Supabase Auth y Row Level Security (RLS). Los roles (Guardabosque / Administrador) se verifican desde el servidor.'
                        })
                    ]
                })
            ]
        });

        const wrapper = createElement('div', {
            className: 'auth-screen-wrapper',
            children: [card]
        });

        this._container.appendChild(wrapper);
    }

    async _handleLoginSubmit(email, password) {
        this._hideError();
        this._submitBtn.disabled = true;
        this._submitBtn.textContent = 'Verificando credenciales y rol...';

        try {
            await this._viewModel.login(email, password);
        } catch (error) {
            this._showError(
                error.message === 'Invalid login credentials'
                    ? 'Credenciales incorrectas. Verifique su correo y contraseña.'
                    : error.message || 'Error al iniciar sesión.'
            );
            this._submitBtn.disabled = false;
            this._submitBtn.textContent = 'Iniciar Sesión en SanturBio';
        }
    }

    _showError(message) {
        if (!this._errorBanner) return;
        this._errorBanner.textContent = message;
        this._errorBanner.classList.remove('hidden');
    }

    _hideError() {
        if (!this._errorBanner) return;
        this._errorBanner.textContent = '';
        this._errorBanner.classList.add('hidden');
    }
}
