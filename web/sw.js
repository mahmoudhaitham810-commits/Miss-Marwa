// نسخة مطابقة لـ OneSignalSDKWorker.js — موجودة بس عشان الأجهزة اللي اتسجل عليها sw.js قبل كده تفضل الإشعارات شغالة عندها. الملف الأساسي هو OneSignalSDKWorker.js.
// مهم: المتصفح بيسمح بـ Service Worker واحد بس لكل نطاق (scope). قبل كده كان فيه اتنين
// (sw.js و ده) بيتسجلوا على نفس النطاق "/" وكل واحد بيشيل التاني — فالإشعارات كانت
// بتقف تشتغل من غير ما حد يعرف السبب. دلوقتي الملف ده بيعمل الحاجتين:
// 1) استقبال إشعارات OneSignal
// 2) الـ fetch handler اللي المتصفح محتاجه عشان يعرض "تثبيت التطبيق" (PWA)
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    // بنتدخل في فتح الصفحات بس (مش طلبات الـ API)، عشان لو النت قاطع الطالب يشوف
    // رسالة واضحة بدل صفحة خطأ المتصفح. طلبات الـ API بتمشي عادي من غير تدخل.
    if (event.request.mode !== 'navigate') return;
    event.respondWith(
        fetch(event.request).catch(() => new Response(
            '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#020617;color:#e2e8f0;text-align:center;padding:16px">' +
            '<div><h2>مفيش اتصال بالإنترنت</h2><p>اتأكد من النت وحدّث الصفحة.</p></div></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        ))
    );
});
