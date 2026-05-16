/**
 * Aigram integration — light identity hook.
 *
 * When Alter Isle is embedded inside the Aigram list, the host iframe
 * passes `api_origin` and `telegram_id` URL parameters and proxies API
 * calls through `window.parent.postMessage`. Outside Aigram (local dev,
 * direct link, Netlify mirror) those params are absent and we fall back
 * to an anonymous welcome.
 *
 * Per docs/spec:
 *  - `url` field is path-only ("/note/telegram/..."), never apiOrigin-prefixed
 *  - targetOrigin must be the pure origin of apiOrigin (no path)
 *  - request_id pairs the outbound message with its result
 *
 * This module only reads — no posts, no permissions side-effects.
 */

const REQUEST_TIMEOUT_MS = 4000;

function getAigramContext() {
    try {
        const params = new URLSearchParams(window.location.search);
        const apiOrigin = params.get('api_origin');
        const telegramId = params.get('telegram_id');
        if (!apiOrigin || !telegramId) return null;
        const targetOrigin = new URL(apiOrigin).origin;
        return { apiOrigin, telegramId, targetOrigin };
    } catch {
        return null;
    }
}

function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    // RFC4122 fallback for older browsers / WebViews.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function toBase64(s) { return btoa(unescape(encodeURIComponent(s))); }
function fromBase64(s) { return decodeURIComponent(escape(atob(s))); }

function callAigramAPI({ targetOrigin }, path, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const requestId = uuid();
        const payload = {
            url: path,
            method,
            data,
            request_id: requestId,
            emitter: window.location.origin,
        };

        const handler = (event) => {
            if (event.origin !== targetOrigin) return;
            if (typeof event.data !== 'string' || !event.data.startsWith('callAPIResult-')) return;
            let parsed;
            try {
                parsed = JSON.parse(fromBase64(event.data.slice('callAPIResult-'.length)));
            } catch {
                return;
            }
            if (parsed.request_id !== requestId) return;
            cleanup();
            if (parsed.success === false) reject(new Error(parsed.error || 'aigram-api-error'));
            else resolve(parsed.data);
        };

        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('aigram-api-timeout'));
        }, REQUEST_TIMEOUT_MS);

        function cleanup() {
            clearTimeout(timer);
            window.removeEventListener('message', handler);
        }

        window.addEventListener('message', handler);
        window.parent.postMessage(`callAPI-${toBase64(JSON.stringify(payload))}`, targetOrigin);
    });
}

/**
 * Returns the player's display name if we're inside Aigram and the host
 * answers within ~4s. Returns null otherwise (including all errors —
 * the welcome toast is a niceity, not a failure path).
 */
export async function getAigramUserName() {
    const ctx = getAigramContext();
    if (!ctx) return null;
    try {
        const result = await callAigramAPI(
            ctx,
            `/note/telegram/user/get/info/by/telegram_id?telegram_id=${ctx.telegramId}`,
        );
        const user = result?.data ?? result;
        const name = user?.name?.trim();
        return name || null;
    } catch {
        return null;
    }
}
