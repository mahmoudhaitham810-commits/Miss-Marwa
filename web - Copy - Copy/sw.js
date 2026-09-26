const CACHE_NAME = 'science-academy-cache-v1';

// Basic install event to satisfy PWA requirements
self.addEventListener('install', (event) => {
    self.skipWaiting();
    console.log('[Service Worker] Installed');
});

// Basic activate event
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
    console.log('[Service Worker] Activated');
});

// Basic fetch event (cache-first or network-first strategy isn't strictly needed 
// for the "Add to Home Screen" prompt, but we need to intercept fetch to pass the PWA audit)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            // Optional: Return a fallback offline page if network fails
            return new Response('You are offline. Please check your connection.');
        })
    );
});
