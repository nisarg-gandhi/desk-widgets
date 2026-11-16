import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {cachePath, readText, writeText} from './store.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const TIMEOUT_SECONDS = 10;
let _session = null;

function session() {
    _session ??= new Soup.Session({timeout: TIMEOUT_SECONDS, user_agent: 'Mozilla/5.0'});
    return _session;
}

// Cancel everything in flight. Called when the extension is disabled.
export function abortAll() {
    _session?.abort();
    _session = null;
}

// Rejects on a non-200 status, a timeout, or a body that is not JSON.
export async function fetchJson(url) {
    const message = Soup.Message.new('GET', url);
    const bytes = await session().send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
    if (message.get_status() !== Soup.Status.OK)
        throw new Error(`HTTP ${message.get_status()}`);
    return JSON.parse(new TextDecoder().decode(bytes.get_data()));
}

// The last good response for `key`, marked stale, or null.
export async function readCache(key) {
    try {
        const cached = JSON.parse(await readText(cachePath(`${key}.json`)));
        if (typeof cached?.fetchedAt !== 'number' || cached.data === undefined)
            return null;
        return {data: cached.data, fetchedAt: cached.fetchedAt, stale: true};
    } catch {
        return null;
    }
}

// Fetch and cache. A response that `isValid` rejects counts as a failure, so
// it never replaces a good cached value. On failure: the cached copy, or null.
export async function cachedFetch(key, url, isValid = () => true) {
    try {
        const data = await fetchJson(url);
        if (!isValid(data))
            throw new Error('unusable response');
        const fetchedAt = Date.now();
        writeText(cachePath(`${key}.json`), JSON.stringify({fetchedAt, data}))
            .catch(e => console.error('desk-widgets: could not write cache', e));
        return {data, fetchedAt, stale: false};
    } catch {
        return readCache(key);
    }
}
