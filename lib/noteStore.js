// Notes on disk, shared by the desktop Notes card and the Notes app.
// One plain-text file per note: ~/.local/share/desk-widgets/notes/<id>.md
// Gio/GLib only, so it runs both inside GNOME Shell and in a GTK app.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {idOf, isNoteFile, newNoteId} from './logic/notes.js';
import {dataPath, readText, writeText} from './store.js';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.File.prototype, 'trash_async');
Gio._promisify(Gio.File.prototype, 'move_async');

export const notesDir = () => dataPath('notes');
export const notePath = id => GLib.build_filenamev([notesDir(), `${id}.md`]);

// Every note: [{id, text, mtime (ms)}], unsorted. [] if the folder is missing.
export async function listNotes() {
    const dir = Gio.File.new_for_path(notesDir());
    let names;
    try {
        const en = await dir.enumerate_children_async('standard::name,time::modified',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
        names = [];
        for (;;) {
            const infos = await en.next_files_async(64, GLib.PRIORITY_DEFAULT, null);
            if (infos.length === 0)
                break;
            for (const info of infos) {
                if (isNoteFile(info.get_name()))
                    names.push([info.get_name(), info.get_modification_date_time()?.to_unix_usec() ?? 0]);
            }
        }
    } catch {
        return [];
    }
    const notes = await Promise.all(names.map(async ([name, usec]) => {
        const text = await readText(GLib.build_filenamev([notesDir(), name]));
        return text === null ? null : {id: idOf(name), text, mtime: Math.floor(usec / 1000)};
    }));
    return notes.filter(Boolean);
}

export function readNote(id) {
    return readText(notePath(id));
}

export function writeNote(id, text) {
    return writeText(notePath(id), text);
}

// A new id that no existing note uses.
export function freshId(notes, now = new Date()) {
    return newNoteId(now, notes.map(n => n.id));
}

// Move to the Trash, so a deleted note can be restored from Files.
export async function trashNote(id) {
    await Gio.File.new_for_path(notePath(id)).trash_async(GLib.PRIORITY_DEFAULT, null);
}

// One-time move of the old single note (notes.md) into the notes folder.
// Renaming notes.md to notes.md.bak is the lock: rename is atomic, so only
// one program (the card or the app) succeeds and migrates; the other finds
// no notes.md. The old text is kept in notes.md.bak, never deleted.
// Returns the new note's id, or null when there was nothing to migrate.
export async function migrateOldNote(settings) {
    const old = Gio.File.new_for_path(dataPath('notes.md'));
    const bak = Gio.File.new_for_path(dataPath('notes.md.bak'));
    try {
        await old.move_async(bak, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null);
    } catch {
        return null;        // no notes.md: migrated before, or never used
    }
    const text = await readText(bak.get_path());
    if (text === null || !text.trim())
        return null;
    const id = freshId(await listNotes());
    await writeNote(id, text);
    settings?.set_string('pinned-note', id);
    return id;
}

// Calls fn (debounced) when any note file is added, changed or removed.
export class NotesWatcher {
    constructor(fn, delayMs = 200) {
        this._fn = fn;
        this._delay = delayMs;
        this._id = 0;
        GLib.mkdir_with_parents(notesDir(), 0o700);
        this._monitor = Gio.File.new_for_path(notesDir()).monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._signal = this._monitor.connect('changed', () => this._queue());
    }

    _queue() {
        if (this._id)
            GLib.source_remove(this._id);
        this._id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._delay, () => {
            this._id = 0;
            this._fn();
            return GLib.SOURCE_REMOVE;
        });
    }

    stop() {
        if (this._id)
            GLib.source_remove(this._id);
        this._id = 0;
        if (this._monitor) {
            this._monitor.disconnect(this._signal);
            this._monitor.cancel();
            this._monitor = null;
        }
    }
}

// Remove an empty note file outright (nothing to restore).
export async function deleteEmptyNote(id) {
    const text = await readNote(id);
    if (text !== null && !text.trim())
        Gio.File.new_for_path(notePath(id)).delete(null);
}
