/* =========================================================
   Homework kit — shared by the student and staff portals.
   • PDF → page images in the browser (pdf.js, bundled in /assets/vendor/pdfjs)
   • Photos → light JPEGs that stay readable (max 1600 px)
   • Quick quality check (too dark / blurry) before uploading
   window.HwKit
   ========================================================= */
(function () {
    'use strict';
    const PDF_LIB = '/assets/vendor/pdfjs/pdf.min.js', PDF_WORKER = '/assets/vendor/pdfjs/pdf.worker.min.js';
    let libP = null;
    function lib() {
        if (window.__pdfjsLib) return Promise.resolve(window.__pdfjsLib);       // test hook
        if (!libP) libP = import(PDF_LIB).then(m => { m.GlobalWorkerOptions.workerSrc = PDF_WORKER; return m; });
        return libP;
    }
    /** Open a PDF from a File/ArrayBuffer, or from a URL (streamed with byte ranges). */
    async function openPdf(src) {
        const pdfjs = await lib();
        const opts = src instanceof ArrayBuffer || ArrayBuffer.isView(src) ? { data: src }
            : (typeof Blob !== 'undefined' && src instanceof Blob) ? { data: await src.arrayBuffer() }
                : { url: src, withCredentials: true, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144 };
        return pdfjs.getDocument({ ...opts, isEvalSupported: false }).promise;
    }
    function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
    /** Render one PDF page to a JPEG data URL (longest side ≤ maxSide). */
    async function renderPage(pdf, n, { maxSide = 1600, quality = 0.8 } = {}) {
        const page = await pdf.getPage(n);
        const v1 = page.getViewport({ scale: 1 });
        const scale = Math.min(4, maxSide / Math.max(v1.width, v1.height));
        const vp = page.getViewport({ scale });
        const c = canvasOf(vp.width, vp.height), ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const dataUrl = c.toDataURL('image/jpeg', quality);
        page.cleanup && page.cleanup();
        return { dataUrl, width: c.width, height: c.height, canvas: c };
    }
    const thumbOf = (pdf, n) => renderPage(pdf, n, { maxSide: 260, quality: 0.7 }).then(r => r.dataUrl);

    function loadImage(src) { return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Could not open this photo')); i.src = src; }); }
    /** Photo file → readable JPEG data URL (max 1600 px, ~150–450 KB). */
    async function photoToJpeg(file, { maxSide = 1600, quality = 0.8 } = {}) {
        const url = URL.createObjectURL(file);
        try {
            let img;
            try { img = await loadImage(url); } catch (e) { throw new Error(`"${file.name}" isn't a photo we can open — use JPG or PNG`); }
            const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
            const c = canvasOf(img.naturalWidth * s, img.naturalHeight * s), ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            let q = quality, out = c.toDataURL('image/jpeg', q);
            while (out.length > 1_400_000 && q > 0.45) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }   // keep under the 1 MB upload limit
            return { dataUrl: out, width: c.width, height: c.height, canvas: c };
        } finally { URL.revokeObjectURL(url); }
    }
    /** Brightness + sharpness on a small grey copy. Returns { dark, blurry, brightness, sharpness }. */
    function checkQuality(canvas) {
        try {
            const w = 360, h = Math.max(1, Math.round(canvas.height * w / canvas.width));
            const c = canvasOf(w, h), ctx = c.getContext('2d');
            ctx.drawImage(canvas, 0, 0, w, h);
            const d = ctx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
            let sum = 0;
            for (let i = 0, p = 0; i < d.length; i += 4, p++) { g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sum += g[p]; }
            const mean = sum / g.length;
            let lsum = 0, lsq = 0, n = 0;
            for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
                const i = y * w + x, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
                lsum += l; lsq += l * l; n++;
            }
            const variance = n ? lsq / n - (lsum / n) ** 2 : 0;
            return { dark: mean < 85, blurry: variance < 45, brightness: Math.round(mean), sharpness: Math.round(variance) };
        } catch (e) { return { dark: false, blurry: false }; }
    }
    const b64 = (dataUrl) => String(dataUrl).split(',')[1] || '';
    const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
    /** "34-37, 40" → [34,35,36,37,40] (bounded by `max`) */
    function parsePages(text, max) {
        const out = new Set();
        String(text || '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).split(/[,،\s]+/).forEach(part => {
            const m = part.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/); if (!m) return;
            let a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a; if (a > b) [a, b] = [b, a];
            for (let i = a; i <= b && i - a < 200; i++) if (i >= 1 && (!max || i <= max)) out.add(i);
        });
        return [...out].sort((x, y) => x - y);
    }
    window.HwKit = { openPdf, renderPage, thumbOf, photoToJpeg, checkQuality, b64, isPdf, parsePages };
})();
