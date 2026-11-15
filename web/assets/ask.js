/* =========================================================
   Ask Miss Marwa — shared chat pieces (student portal + staff portal)
   - photo: resized + compressed in the browser (≈100–250 KB)
   - voice note: recorded in the browser at low bitrate (≈15 KB / 10 s), max 2 min
   - bubbles + a composer (text · photo · voice)
   window.AskKit
   ========================================================= */
(function () {
    'use strict';
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const MAX_SECONDS = 120;
    const mediaUrl = (id) => `/api/ask?action=media&id=${encodeURIComponent(id)}`;

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1] || '');
            r.onerror = () => reject(new Error('Could not read the file'));
            r.readAsDataURL(blob);
        });
    }

    // ---------- Photo: max 1400 px, JPEG ----------
    async function loadImage(file) {
        if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { } }
        return await new Promise((resolve, reject) => {
            const img = new Image(); const u = URL.createObjectURL(file);
            img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('This photo can\'t be opened — try another one.')); };
            img.src = u;
        });
    }
    async function compressImage(file) {
        if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Please choose a photo.');
        const img = await loadImage(file);
        const W = img.width, H = img.height;
        const tryOnce = (max, q) => new Promise((resolve) => {
            const k = Math.min(1, max / Math.max(W, H));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            c.toBlob(b => resolve(b), 'image/jpeg', q);
        });
        let blob = await tryOnce(1400, 0.72);
        if (blob && blob.size > 380 * 1024) blob = await tryOnce(1100, 0.6);
        if (blob && blob.size > 600 * 1024) blob = await tryOnce(900, 0.5);
        if (!blob) throw new Error('This photo can\'t be opened — try another one.');
        return { kind: 'image', mime: 'image/jpeg', data: await blobToBase64(blob), size: blob.size, url: URL.createObjectURL(blob) };
    }

    // ---------- Voice note ----------
    function pickAudioType() {
        const types = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];
        if (!window.MediaRecorder) return null;
        return types.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || '';
    }
    const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    function recorder({ onTick, onAutoStop } = {}) {
        let rec = null, stream = null, chunks = [], started = 0, timer = null, stopResolve = null;
        return {
            async start() {
                if (!canRecord()) throw new Error('Voice notes aren\'t supported in this browser.');
                try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
                catch (e) { throw new Error('Allow the microphone to record a voice note.'); }
                const type = pickAudioType();
                const opts = { audioBitsPerSecond: 24000 }; if (type) opts.mimeType = type;
                try { rec = new MediaRecorder(stream, opts); } catch (e) { rec = new MediaRecorder(stream); }
                chunks = [];
                rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
                rec.onstop = async () => {
                    clearInterval(timer);
                    stream.getTracks().forEach(t => t.stop());
                    const seconds = Math.round((Date.now() - started) / 100) / 10;
                    const blob = new Blob(chunks, { type: (rec.mimeType || type || 'audio/webm') });
                    const mime = (blob.type || 'audio/webm').split(';')[0];
                    const out = blob.size ? { kind: 'audio', mime, data: await blobToBase64(blob), size: blob.size, seconds, url: URL.createObjectURL(blob) } : null;
                    if (stopResolve) stopResolve(out); else if (onAutoStop) onAutoStop(out);
                };
                rec.start(1000);
                started = Date.now();
                timer = setInterval(() => {
                    const s = (Date.now() - started) / 1000;
                    onTick && onTick(s);
                    if (s >= MAX_SECONDS && rec.state === 'recording') rec.stop();
                }, 250);
            },
            stop() { return new Promise((resolve) => { stopResolve = resolve; if (rec && rec.state === 'recording') rec.stop(); else resolve(null); }); },
            cancel() { stopResolve = () => { }; try { if (rec && rec.state === 'recording') rec.stop(); } catch (e) { } clearInterval(timer); if (stream) stream.getTracks().forEach(t => t.stop()); }
        };
    }
    const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

    // ---------- Bubbles ----------
    function fmtTime(at) {
        const d = new Date(String(at || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(at)) || String(at).includes('T') ? '' : 'Z'));
        if (isNaN(d)) return '';
        const today = new Date().toDateString() === d.toDateString();
        return d.toLocaleString('en-GB', today ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    }
    // viewer: 'student' (own messages on the right) or 'staff' (staff messages on the right)
    function bubble(m, viewer, icon) {
        const mine = viewer === 'student' ? m.sender === 'student' : m.sender === 'staff';
        const fromTeam = m.sender === 'staff' || m.sender === 'auto';
        // photo and/or voice note (older messages only have mediaId + mediaKind)
        const image = m.image || (m.mediaKind === 'image' ? m.mediaId : null);
        const audio = m.audio || (m.mediaKind === 'audio' && m.mediaId ? { id: m.mediaId, seconds: m.seconds } : null);
        const media = (image ? `<a class="ask-img" href="${mediaUrl(image)}" target="_blank" rel="noopener"><img src="${mediaUrl(image)}" alt="Photo" loading="lazy"></a>` : '')
            + (audio ? `<div class="ask-audio">${icon ? icon('mic', 'sm') : ''}<audio controls preload="none" src="${mediaUrl(audio.id)}"></audio>${audio.seconds ? `<span class="ask-dur">${mmss(audio.seconds)}</span>` : ''}</div>` : '');
        const who = m.sender === 'auto' ? 'Science Academy' : m.sender === 'staff' ? (m.staffName || 'Miss Marwa') : '';
        return `<div class="ask-row ${mine ? 'mine' : 'theirs'} ${m.sender}">
            ${!mine && fromTeam ? `<img class="ask-av" src="${m.sender === 'auto' ? '/assets/img/logo-96.png' : '/assets/img/marwa-160.png'}" alt="">` : ''}
            <div class="ask-bubble">
                ${who && !mine ? `<div class="ask-who">${esc(who)}${m.sender === 'staff' ? ' <span class="ask-team">· Miss Marwa\'s team</span>' : ''}</div>` : ''}
                ${who && mine && viewer === 'staff' && m.staffName ? `<div class="ask-who">${esc(m.staffName)}</div>` : ''}
                ${media}
                ${m.text ? `<div class="ask-text" dir="auto">${esc(m.text)}</div>` : ''}
                <div class="ask-time">${esc(fmtTime(m.at))}</div>
            </div></div>`;
    }

    // ---------- Composer: text + photo + voice note — any mix in one message ----------
    function composer(root, { placeholder = 'Write your question…', sendLabel = 'Send', icon, toast, onSend }) {
        let image = null, audio = null, rec = null, busy = false;
        const hasAny = () => !!(ta.value.trim() || image || audio);
        root.classList.add('ask-composer');
        root.innerHTML = `
            <div class="ask-attach" data-att-image hidden></div>
            <div class="ask-attach" data-att-audio hidden></div>
            <div class="ask-recbar" hidden><span class="ask-dot"></span><b class="ask-rtime">0:00</b><span class="small muted">Recording… max 2:00</span>
                <button type="button" class="btn btn-ghost btn-sm" data-rec-cancel>Cancel</button><button type="button" class="btn btn-primary btn-sm" data-rec-stop>Done</button></div>
            <div class="ask-inputrow">
                <label class="icon-btn ask-tool" title="Add a photo" aria-label="Add a photo">${icon('image')}<input type="file" accept="image/*" hidden data-photo></label>
                ${canRecord() ? `<button type="button" class="icon-btn ask-tool" data-rec title="Record a voice note" aria-label="Record a voice note">${icon('mic')}</button>` : ''}
                <textarea rows="1" dir="auto" maxlength="2000" placeholder="${esc(placeholder)}" data-text></textarea>
                <button type="button" class="btn btn-primary ask-send" data-send disabled>${icon('send')}<span>${esc(sendLabel)}</span></button>
            </div>`;
        const $ = (s) => root.querySelector(s);
        const ta = $('[data-text]');
        const update = () => {
            $('[data-send]').disabled = busy || !hasAny();
            const p = $('[data-photo]').closest('.ask-tool'); p.classList.toggle('on', !!image); p.title = image ? 'Change the photo' : 'Add a photo';
            const r = $('[data-rec]'); if (r) { r.classList.toggle('on', !!audio); r.title = audio ? 'Record again' : 'Record a voice note'; }
        };
        const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
        ta.addEventListener('input', () => { grow(); update(); });
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
        function showAttach() {
            const ai = $('[data-att-image]'), aa = $('[data-att-audio]');
            ai.hidden = !image; aa.hidden = !audio;
            ai.innerHTML = image ? `<img src="${image.url}" alt=""><span class="small muted">Photo · ${Math.round(image.size / 1024)} KB</span><button type="button" class="icon-btn" data-remove="image" aria-label="Remove the photo">${icon('x', 'sm')}</button>` : '';
            aa.innerHTML = audio ? `${icon('mic', 'sm')}<audio controls src="${audio.url}"></audio><span class="small muted">${mmss(audio.seconds || 0)}</span><button type="button" class="icon-btn" data-remove="audio" aria-label="Remove the voice note">${icon('x', 'sm')}</button>` : '';
            root.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { if (b.dataset.remove === 'image') image = null; else audio = null; showAttach(); }));
            update();
        }
        $('[data-photo]').addEventListener('change', async (e) => {
            const f = e.target.files && e.target.files[0]; e.target.value = '';
            if (!f) return;
            try { image = await compressImage(f); showAttach(); } catch (err) { toast(err.message, 'error'); }
        });
        $('[data-rec]')?.addEventListener('click', async () => {
            if (rec) return;
            rec = recorder({ onTick: (s) => { $('.ask-rtime').textContent = mmss(s); }, onAutoStop: (out) => { finishRec(out); toast('Voice notes can be 2 minutes long at most.', 'info'); } });
            try { await rec.start(); } catch (err) { rec = null; return toast(err.message, 'error'); }
            $('.ask-recbar').hidden = false; $('.ask-inputrow').hidden = true;
        });
        function finishRec(out) {
            rec = null; $('.ask-recbar').hidden = true; $('.ask-inputrow').hidden = false; $('.ask-rtime').textContent = '0:00';
            if (out) { if (out.seconds < 0.8) return toast('Too short — hold on a little longer.', 'info'); audio = out; showAttach(); }
        }
        $('[data-rec-stop]').addEventListener('click', async () => { if (rec) finishRec(await rec.stop()); });
        $('[data-rec-cancel]').addEventListener('click', () => { if (rec) { rec.cancel(); finishRec(null); } });
        const pack = (m) => m ? { kind: m.kind, mime: m.mime, data: m.data, seconds: m.seconds } : null;
        async function send() {
            if (busy || rec || !hasAny()) return;
            busy = true; update(); $('[data-send]').classList.add('loading');
            try {
                await onSend({ text: ta.value.trim(), image: pack(image), audio: pack(audio) });
                ta.value = ''; image = null; audio = null; showAttach(); grow();
            } catch (err) { toast(err.message || 'Could not send — try again.', 'error'); }
            finally { busy = false; $('[data-send]').classList.remove('loading'); update(); }
        }
        $('[data-send]').addEventListener('click', send);
        return { focus: () => ta.focus(), get busy() { return busy; } };
    }

    function waited(since) {
        const t = new Date(String(since || '').replace(' ', 'T') + (String(since).includes('T') ? '' : 'Z')).getTime();
        if (!t) return '';
        const m = Math.max(0, (Date.now() - t) / 60000);
        return m < 1 ? 'just now' : m < 60 ? `${Math.round(m)}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h${m % 60 >= 1 && m < 600 ? ' ' + Math.round(m % 60) + 'm' : ''}` : `${Math.floor(m / 1440)}d`;
    }
    // Engagement badge from the number of questions asked
    function engagement(n) {
        n = Number(n) || 0;
        if (n >= 10) return { label: 'Active asker', tone: 'success', n };
        if (n >= 4) return { label: 'Engaged', tone: 'primary', n };
        if (n >= 1) return { label: 'Occasional', tone: 'muted', n };
        return { label: 'No questions yet', tone: 'muted', n };
    }

    window.AskKit = { compressImage, recorder, canRecord, bubble, composer, mediaUrl, waited, mmss, engagement, UNITS: 6, LESSONS: 6 };
})();
