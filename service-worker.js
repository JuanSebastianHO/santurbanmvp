/**
 * @file service-worker.js
 * @description Service Worker optimizado para Vercel y navegadores con Tracking Prevention.
 * Garantiza que al activar modo Offline y presionar F5, el HTML, los módulos ES6
 * y las sub-dependencias de CDN (Supabase + Leaflet) carguen 100% desde caché local.
 */

const CACHE_VERSION = 'santurban-pwa-v1.1.0';
const STATIC_CACHE_NAME = `${CACHE_VERSION}-static`;
const CDN_CACHE_NAME = `${CACHE_VERSION}-cdn`;
const TILES_CACHE_NAME = `${CACHE_VERSION}-osm-tiles`;

/**
 * Archivos locales esenciales del App Shell.
 */
const APP_SHELL_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/assets/icons/app-icon.svg',
    '/css/styles.css',
    '/css/components.css',
    '/css/responsive.css',
    '/js/app.js',
    '/js/config/env.js',
    '/js/config/santurban-route.js',
    '/js/core/EventBus.js',
    '/js/core/Validator.js',
    '/js/models/ReporteAmbiental.js',
    '/js/models/SyncItem.js',
    '/js/repositories/LocalReportRepository.js',
    '/js/repositories/RemoteReportRepository.js',
    '/js/repositories/ReportRepository.js',
    '/js/services/CameraService.js',
    '/js/services/ExportService.js',
    '/js/services/ImageCompressionService.js',
    '/js/services/IndexedDBService.js',
    '/js/services/LocationService.js',
    '/js/services/NetworkMonitor.js',
    '/js/services/SupabaseService.js',
    '/js/services/SyncService.js',
    '/js/utils/dom.js',
    '/js/utils/uuid.js',
    '/js/viewmodels/AdminViewModel.js',
    '/js/viewmodels/AuthViewModel.js',
    '/js/viewmodels/FieldViewModel.js',
    '/js/views/AdminDashboardView.js',
    '/js/views/AuthView.js',
    '/js/views/FieldView.js',
    '/js/views/MapView.js'
];

/**
 * Librerías externas requeridas para funcionar sin conexión.
 */
const EXTERNAL_CDN_ASSETS = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
];

// 1. INSTALACIÓN: Pre-carga completa del App Shell y librerías CDN
self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const staticCache = await caches.open(STATIC_CACHE_NAME);
            const cdnCache = await caches.open(CDN_CACHE_NAME);

            // Cachear activos propios haciendo fetch explícito para asegurar que '/' e '/index.html' queden listos
            await Promise.allSettled(
                APP_SHELL_ASSETS.map(async (path) => {
                    try {
                        const response = await fetch(path, { cache: 'reload' });
                        if (response.ok) {
                            await staticCache.put(path, response);
                        }
                    } catch (err) {
                        console.warn(`[SW] Omitido en install local: ${path}`, err);
                    }
                })
            );

            // Cachear entradas principales de CDN con CORS habilitado
            await Promise.allSettled(
                EXTERNAL_CDN_ASSETS.map(async (cdnUrl) => {
                    try {
                        const response = await fetch(cdnUrl, { mode: 'cors' });
                        if (response.ok) {
                            await cdnCache.put(cdnUrl, response);
                        }
                    } catch (err) {
                        console.warn(`[SW] Omitido en install CDN: ${cdnUrl}`, err);
                    }
                })
            );

            await self.skipWaiting();
        })()
    );
});

// 2. ACTIVACIÓN: Limpieza de cachés viejas y toma de control inmediata de la pestaña
self.addEventListener('activate', (event) => {
    const validCaches = new Set([STATIC_CACHE_NAME, CDN_CACHE_NAME, TILES_CACHE_NAME]);
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys.map((key) => {
                    if (!validCaches.has(key)) {
                        return caches.delete(key);
                    }
                    return Promise.resolve();
                })
            );
            await self.clients.claim();
        })()
    );
});

// 3. INTERCEPTACIÓN DE PETICIONES (FETCH)
self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);

    // A. No cachear llamadas a la API de tu proyecto Supabase (Auth, REST, Storage)
    if (url.hostname.includes('supabase.co')) {
        return;
    }

    // B. NAVEGACIÓN HTML (Cuando presionas F5 en Vercel o abres la PWA sin internet)
    if (request.mode === 'navigate' || request.destination === 'document') {
        event.respondWith(handleNavigationRequest(request));
        return;
    }

    // C. MÓDULOS Y LIBRERÍAS DE CDN (jsdelivr y unpkg, incluyendo sub-módulos de Supabase)
    if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('unpkg.com')) {
        event.respondWith(handleCdnRequest(request));
        return;
    }

    // D. TESELAS DE MAPA OPENSTREETMAP
    if (url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(handleOsmTileRequest(request));
        return;
    }

    // E. ARCHIVOS LOCALES DEL PROYECTO (JS, CSS, SVG, manifest.json)
    if (url.origin === self.location.origin) {
        event.respondWith(handleLocalAssetRequest(request));
    }
});

/**
 * Resuelve recargas de página (F5) en Vercel:
 * Intenta red rápida o devuelve inmediatamente el HTML cacheado ('/' o '/index.html').
 */
async function handleNavigationRequest(request) {
    const staticCache = await caches.open(STATIC_CACHE_NAME);

    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
            staticCache.put('/', networkResponse.clone());
            staticCache.put('/index.html', networkResponse.clone());
            return networkResponse;
        }
    } catch {
        // Estamos Offline: buscar el documento HTML en caché sin importar cómo lo llame Vercel
    }

    const cachedRoot =
        (await staticCache.match(request, { ignoreSearch: true })) ||
        (await staticCache.match('/index.html', { ignoreSearch: true })) ||
        (await staticCache.match('/', { ignoreSearch: true }));

    if (cachedRoot) {
        return cachedRoot;
    }

    return new Response(
        '<!DOCTYPE html><html lang="es"><body><h2>Modo Offline: Recargue una vez con conexión para inicializar la caché.</h2></body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
}

/**
 * Estrategia Cache-First para todas las librerías CDN (Supabase ESM y sus sub-módulos, Leaflet).
 * Así nunca fallan al recargar sin internet.
 */
async function handleCdnRequest(request) {
    const cdnCache = await caches.open(CDN_CACHE_NAME);
    const cached = await cdnCache.match(request);
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(request, { mode: 'cors' });
        if (response && response.ok) {
            await cdnCache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('', { status: 503, statusText: 'CDN Offline Unavailable' });
    }
}

/**
 * Estrategia Cache-First con actualización en segundo plano para nuestros módulos JS/CSS locales.
 */
async function handleLocalAssetRequest(request) {
    const staticCache = await caches.open(STATIC_CACHE_NAME);
    const cached = await staticCache.match(request, { ignoreSearch: true });

    const fetchPromise = fetch(request)
        .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
                staticCache.put(request, networkResponse.clone());
            }
            return networkResponse;
        })
        .catch(() => null);

    if (cached) {
        return cached;
    }

    const networkResult = await fetchPromise;
    if (networkResult) {
        return networkResult;
    }

    return new Response('', { status: 404, statusText: 'Local Asset Not Cached' });
}

/**
 * Cacheo de teselas de OpenStreetMap para ver el mapa sin internet.
 */
async function handleOsmTileRequest(request) {
    const cache = await caches.open(TILES_CACHE_NAME);
    const cachedTile = await cache.match(request);
    if (cachedTile) {
        return cachedTile;
    }

    try {
        const response = await fetch(request);
        if (response && response.status === 200) {
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('', { status: 408, statusText: 'Offline Tile Unavailable' });
    }
}
