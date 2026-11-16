import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'make_directory_async');
Gio._promisify(Gio.File.prototype, 'query_filesystem_info_async');

const APP = 'desk-widgets';

export function dataPath(name) {
    return GLib.build_filenamev([GLib.get_user_data_dir(), APP, name]);
}

export function cachePath(name) {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), APP, name]);
}

// File contents, or null when the file is missing or unreadable.
export async function readText(path) {
    try {
        const [bytes] = await Gio.File.new_for_path(path).load_contents_async(null);
        return new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
}

// Like readText, but tells a missing file (text null, error false) apart from
// one that exists and cannot be read (error true).
export async function readTextChecked(path) {
    try {
        const [bytes] = await Gio.File.new_for_path(path).load_contents_async(null);
        return {text: new TextDecoder().decode(bytes), error: false};
    } catch (e) {
        return {text: null, error: !e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)};
    }
}

// Atomic write; creates the parent directory if needed.
export async function writeText(path, text) {
    const file = Gio.File.new_for_path(path);
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
    await file.replace_contents_bytes_async(
        new GLib.Bytes(new TextEncoder().encode(text)),
        null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

// Used fraction (0..100) of the filesystem holding `path`, or null.
export async function diskUsedPercent(path) {
    try {
        const info = await Gio.File.new_for_path(path).query_filesystem_info_async(
            'filesystem::size,filesystem::free', GLib.PRIORITY_DEFAULT, null);
        const size = info.get_attribute_uint64('filesystem::size');
        const free = info.get_attribute_uint64('filesystem::free');
        return size > 0 ? Math.round(100 * (size - free) / size) : null;
    } catch {
        return null;
    }
}
