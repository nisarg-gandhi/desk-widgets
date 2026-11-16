// The habits file, shared by the desktop widget and the Habit Tracker app.
// Gio/GLib only, so it runs both inside GNOME Shell and in a GTK app.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {parseChecked} from './logic/streaks.js';
import {dataPath, readTextChecked, writeText} from './store.js';

const FILE = 'habits.json';
const RELOAD_DELAY_MS = 150;

export class HabitFile {
    // onChange() is called whenever this.data, this.loaded or this.blocked changes.
    constructor(onChange) {
        this.data = {};
        this.loaded = false;
        this.blocked = false;     // the file exists but cannot be read: never write
        this.path = dataPath(FILE);
        this._onChange = onChange;
        this._queue = Promise.resolve();
        this._stopped = false;
        this._reloadId = 0;
    }

    // Load, then watch for changes made by the other program.
    start() {
        GLib.mkdir_with_parents(GLib.path_get_dirname(this.path), 0o700);
        this._monitor = Gio.File.new_for_path(this.path).monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitorId = this._monitor.connect('changed', () => this._queueReload());
        return this.reload();
    }

    stop() {
        this._stopped = true;
        if (this._reloadId)
            GLib.source_remove(this._reloadId);
        this._reloadId = 0;
        if (this._monitor) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
            this._monitor = null;
        }
    }

    _queueReload() {
        if (this._reloadId || this._stopped)
            return;
        this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RELOAD_DELAY_MS, () => {
            this._reloadId = 0;
            this.reload();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _read() {
        const {text, error} = await readTextChecked(this.path);
        if (error)
            return {blocked: true};
        const {data, damaged} = parseChecked(text);
        return {blocked: false, data, damaged, text};
    }

    _set(data, blocked) {
        const changed = !this.loaded || blocked !== this.blocked ||
            JSON.stringify(data) !== JSON.stringify(this.data);
        this.data = data;
        this.blocked = blocked;
        this.loaded = true;
        if (changed && !this._stopped)
            this._onChange();
    }

    // Reads go through the same queue as writes, so a reload can never show
    // a state older than a change that is still being written.
    reload() {
        return this._enqueue(async () => {
            const read = await this._read();
            if (this._stopped)
                return;
            this._set(read.blocked ? this.data : read.data, read.blocked);
        });
    }

    // Apply one change: fn(data) -> new data. The file is re-read first, so a
    // change made by the other program in the meantime is kept. A file that
    // could not be fully understood is copied to habits.json.bak before it is
    // replaced. Shows the change at once, then confirms it from disk.
    update(fn) {
        if (!this.loaded || this.blocked)
            return Promise.resolve();
        this._set(fn(this.data), false);
        return this._enqueue(async () => {
            const read = await this._read();
            if (read.blocked) {
                this._set(this.data, true);
                return;
            }
            const next = fn(read.data);
            if (read.damaged)
                await writeText(`${this.path}.bak`, read.text);
            await writeText(this.path, `${JSON.stringify(next, null, 2)}\n`);
            this._set(next, false);
        });
    }

    _enqueue(job) {
        this._queue = this._queue.then(job).catch(e => console.error('desk-widgets: habits file', e));
        return this._queue;
    }
}
