// Uses gi:// like data.test.js: store.js is the file layer the apps share.
import GLib from 'gi://GLib';
import {eq} from './assert.js';
import {readText, writeText} from '../lib/store.js';

const dir = GLib.dir_make_tmp('dw-store-XXXXXX');
const path = `${dir}/sub/note.md`;
const withTimeout = (p, ms) => Promise.race([p, new Promise((_r, reject) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => (reject(new Error('timed out')), GLib.SOURCE_REMOVE)))]);

await withTimeout(writeText(path, 'hello'), 3000);
eq(await readText(path), 'hello', 'write creates the folder and the file');
let emptyOk = true;
try {
    await withTimeout(writeText(path, ''), 3000);
} catch (e) {
    emptyOk = e.message;
}
eq(emptyOk, true, 'writing empty text finishes');
eq(await readText(path), '', 'empty text replaces the old content');
eq(await readText(`${dir}/missing.md`), null, 'missing file reads as null');
