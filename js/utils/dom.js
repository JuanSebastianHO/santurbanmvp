/**
 * @file js/utils/dom.js
 * @description Utilidades de manipulación segura del DOM para mitigar ataques XSS.
 * Prohibido insertar datos del usuario con innerHTML.
 */

/**
 * Escapa caracteres HTML peligrosos de una cadena de texto.
 * Útil cuando se construyen popups para bibliotecas externas como Leaflet.
 * @param {unknown} rawText
 * @returns {string}
 */
export function escapeHTML(rawText) {
    if (rawText === null || rawText === undefined) return '';
    return String(rawText)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Crea un elemento DOM de forma segura asignando texto mediante textContent.
 * @param {string} tagName - Etiqueta HTML (ej. 'div', 'button', 'span').
 * @param {Object} [options={}]
 * @param {string|string[]} [options.className] - Clases CSS.
 * @param {string} [options.text] - Contenido de texto seguro (usa textContent).
 * @param {Object<string, string>} [options.attrs] - Atributos HTML seguros.
 * @param {Object<string, string>} [options.dataset] - Atributos data-*.
 * @param {HTMLElement[]} [options.children] - Elementos hijos a adjuntar.
 * @param {Object<string, Function>} [options.events] - Listeners de eventos.
 * @returns {HTMLElement}
 */
export function createElement(tagName, options = {}) {
    const el = document.createElement(tagName);

    if (options.className) {
        if (Array.isArray(options.className)) {
            el.classList.add(...options.className.filter(Boolean));
        } else {
            el.className = options.className;
        }
    }

    if (options.text !== undefined && options.text !== null) {
        el.textContent = String(options.text);
    }

    if (options.attrs && typeof options.attrs === 'object') {
        for (const [key, val] of Object.entries(options.attrs)) {
            if (val !== undefined && val !== null && !key.toLowerCase().startsWith('on')) {
                el.setAttribute(key, String(val));
            }
        }
    }

    if (options.dataset && typeof options.dataset === 'object') {
        for (const [key, val] of Object.entries(options.dataset)) {
            if (val !== undefined && val !== null) {
                el.dataset[key] = String(val);
            }
        }
    }

    if (options.events && typeof options.events === 'object') {
        for (const [eventName, handler] of Object.entries(options.events)) {
            if (typeof handler === 'function') {
                el.addEventListener(eventName, handler);
            }
        }
    }

    if (Array.isArray(options.children)) {
        for (const child of options.children) {
            if (child instanceof Node) {
                el.appendChild(child);
            }
        }
    }

    return el;
}

/**
 * Limpia todos los nodos hijos de un elemento de forma segura.
 * @param {HTMLElement} container
 */
export function clearElement(container) {
    if (!container) return;
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
}

/**
 * Formatea una fecha ISO a formato legible local (Colombia es-CO).
 * @param {string|Date} isoDate
 * @returns {string}
 */
export function formatDateTime(isoDate) {
    if (!isoDate) return 'No disponible';
    const date = isoDate instanceof Date ? isoDate : new Date(isoDate);
    if (Number.isNaN(date.getTime())) return 'Fecha inválida';

    return new Intl.DateTimeFormat('es-CO', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(date);
}