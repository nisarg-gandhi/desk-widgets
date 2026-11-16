import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {dayNumber} from './logic/dates.js';
import {SIZES, collides, resolveLayout, snapToCell, toPixels} from './logic/grid.js';

// The only code that knows which shell group the widget layer lives in.
//
// Desktop Icons (DING) covers the wallpaper with a transparent window that
// swallows every click, so the layer cannot live in the background group.
// It lives in the window group, directly above the desktop-type windows and
// below every normal window. Mutter re-sorts the window group on each
// restack, so the position is re-applied on 'restacked'.

const _layers = new Set();
let _signals = [];
let _idleId = 0;

function isDesktopWindow(actor) {
    const win = actor.meta_window;
    if (!win)
        return false;
    return win.get_window_type() === Meta.WindowType.DESKTOP ||
        win.customJS_ding !== undefined ||
        (win.get_title() ?? '').startsWith('@!');
}

export function restack() {
    const group = global.window_group;
    let anchor = Main.layoutManager._backgroundGroup;
    if (anchor.get_parent() !== group)
        anchor = null;
    for (const child of group.get_children()) {
        if (isDesktopWindow(child))
            anchor = child;
    }
    for (const layer of _layers) {
        if (anchor)
            group.set_child_above_sibling(layer, anchor);
        else
            group.set_child_below_sibling(layer, null);
    }
}

// Mutter may finish its own sorting after the signal, so also re-apply on idle.
function queueRestack() {
    restack();
    if (_idleId)
        return;
    _idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        _idleId = 0;
        restack();
        return GLib.SOURCE_REMOVE;
    });
}

function connect(obj, signal) {
    _signals.push([obj, obj.connect(signal, queueRestack)]);
}

export function attachLayer(actor) {
    global.window_group.add_child(actor);
    _layers.add(actor);
    if (_signals.length === 0) {
        connect(global.display, 'restacked');
        connect(global.window_manager, 'map');
        connect(global.window_group, 'child-added');
    }
    restack();
}

export function detachLayer(actor) {
    _layers.delete(actor);
    actor.get_parent()?.remove_child(actor);
    if (_layers.size === 0) {
        for (const [obj, id] of _signals)
            obj.disconnect(id);
        _signals = [];
        if (_idleId) {
            GLib.source_remove(_idleId);
            _idleId = 0;
        }
    }
}

// ---------------------------------------------------------------------------

const COVER_DEBOUNCE_MS = 300;
const DAY_TICK_SECONDS = 60;

export class WidgetLayer {
    constructor(extension) {
        this.extension = extension;
        this._classes = new Map();
        this.widgets = new Map();
        this._cells = {};
        this.covered = false;
        this.area = {x: 0, y: 0, w: 0, h: 0};
        this.scale = 1;
        this._handlers = [];
        this._sources = new Set();
        this._failed = new Set();
    }

    register(id, WidgetClass) {
        this._classes.set(id, WidgetClass);
    }

    // If anything fails half way, undo what was set up: the shell does not
    // call disable() for an extension whose enable() threw.
    enable() {
        try {
            this._enable();
        } catch (e) {
            this.disable();
            throw e;
        }
    }

    _enable() {
        this.settings = this.extension.getSettings();
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._failed.clear();

        this.actor = new St.Widget({style_class: 'dw-layer', clip_to_allocation: true});
        attachLayer(this.actor);

        const on = (obj, signal, fn) => this._handlers.push([obj, obj.connect(signal, fn)]);
        on(Main.layoutManager, 'monitors-changed', () => this._sync());
        on(global.display, 'workareas-changed', () => this._sync());
        for (const key of ['positions', 'hidden', 'calendar-size'])
            on(this.settings, `changed::${key}`, () => this._sync());
        on(this._iface, 'changed::color-scheme', () => this._syncScheme());
        this._theme = St.ThemeContext.get_for_stage(global.stage);
        on(this._theme, 'notify::scale-factor', () => this._sync());
        for (const signal of ['map', 'destroy', 'minimize', 'unminimize', 'size-changed', 'switch-workspace'])
            on(global.window_manager, signal, () => this._queueCoverCheck());

        this._today = dayNumber(new Date());
        const tick = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, DAY_TICK_SECONDS, () => {
            try {
                this.checkDay();
            } catch (e) {
                console.error('desk-widgets: day check failed', e);
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._sources.add(tick);

        this._syncScheme();
        this._sync();
        this._queueCoverCheck();
    }

    disable() {
        for (const [obj, id] of this._handlers)
            obj.disconnect(id);
        this._handlers = [];
        for (const id of this._sources)
            GLib.source_remove(id);
        this._sources.clear();
        this._coverSource = 0;
        for (const widget of this.widgets.values())
            widget.destroy();
        this.widgets.clear();
        // Safe after a half-finished enable(): the actor may not exist yet.
        if (this.actor) {
            detachLayer(this.actor);
            this.actor.destroy();
        }
        this.actor = null;
        this.settings = null;
        this._iface = null;
        this._theme = null;
    }

    // Re-render everything when the local day changes. Runs on a 60 s tick so
    // a suspend across midnight or a clock change is picked up within a minute.
    checkDay(now = new Date()) {
        const today = dayNumber(now);
        if (today === this._today)
            return false;
        this._today = today;
        this._each(widget => widget.refresh(), 'refresh');
        return true;
    }

    // The current time. Widgets ask the layer so tests can pin the clock.
    now() {
        return this._fakeNow ? new Date(this._fakeNow) : new Date();
    }

    // Run fn on every widget; one widget failing must not stop the others.
    _each(fn, what) {
        for (const widget of this.widgets.values()) {
            try {
                fn(widget);
            } catch (e) {
                console.error(`desk-widgets: ${widget.id} ${what} failed`, e);
            }
        }
    }

    // Put a card back in its cell (after a cancelled drag).
    restoreWidget(widget) {
        if (this._cells[widget.id])
            this._place(widget);
    }

    hideWidget(id) {
        const hidden = this.settings.get_strv('hidden');
        if (!hidden.includes(id))
            this.settings.set_strv('hidden', [...hidden, id]);
    }

    openSettings() {
        this.extension.openPreferences();
    }

    // Start (or bring up) the Habit Tracker app that ships with the extension.
    openHabitApp(args = []) {
        try {
            Gio.Subprocess.new(['gjs', '-m', `${this.extension.path}/app/habits.js`, ...args],
                Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.error('desk-widgets: could not start the Habit Tracker', e);
        }
    }

    // x, y: where the card was dropped, in stage pixels relative to the layer.
    dropWidget(widget, {x, y}) {
        const cell = snapToCell(widget.sizeName, {x: x / this.scale, y: y / this.scale}, this.area);
        const others = [...this.widgets.values()]
            .filter(w => w !== widget && this._cells[w.id])
            .map(w => ({size: w.sizeName, cell: this._cells[w.id]}));
        if (!collides(widget.sizeName, cell, others)) {
            this._cells[widget.id] = cell;
            this._saving = true;
            this.settings.set_value('positions', new GLib.Variant('a{s(ii)}', this._cells));
            this._saving = false;
        }
        this._place(widget);
    }

    _place(widget) {
        const {x, y} = toPixels(widget.sizeName, this._cells[widget.id], this.area);
        const {w, h} = SIZES[widget.sizeName];
        widget.set_position(x * this.scale, y * this.scale);
        widget.set_size(w * this.scale, h * this.scale);
    }

    _syncScheme() {
        if (this._iface.get_string('color-scheme') === 'prefer-dark')
            this.actor.remove_style_class_name('dw-light');
        else
            this.actor.add_style_class_name('dw-light');
    }

    // Bring the set of widgets, their sizes and their positions in line with
    // settings and the current work area. Widgets that are unaffected are
    // kept, so their in-memory state survives.
    _sync() {
        if (this._saving)
            return;
        const wa = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        // Grid maths is in logical pixels; the stage may be scaled (HiDPI).
        this.scale = this._theme.scale_factor;
        this.area = {x: wa.x, y: wa.y, w: wa.width / this.scale, h: wa.height / this.scale};
        this.actor.set_position(wa.x, wa.y);
        this.actor.set_size(wa.width, wa.height);

        const hidden = new Set(this.settings.get_strv('hidden'));
        const sizes = {};
        for (const [id, cls] of this._classes) {
            if (!hidden.has(id) && !this._failed.has(id))
                sizes[id] = cls.sizeFor(this.settings);
        }

        const saved = this.settings.get_value('positions').deepUnpack();
        // Widgets that do not fit the work area get no cell and are not shown.
        this._cells = resolveLayout(sizes, saved, this.area);

        for (const [id, widget] of [...this.widgets]) {
            if (sizes[id] !== widget.sizeName || !this._cells[id]) {
                widget.destroy();
                this.widgets.delete(id);
            }
        }

        for (const id of Object.keys(this._cells)) {
            let widget = this.widgets.get(id);
            if (!widget) {
                widget = this._create(id, sizes[id]);
                if (!widget) {
                    // Lay out again without the widget that failed.
                    this._sync();
                    return;
                }
            }
            this._place(widget);
        }
    }

    // A built widget, or null if it threw. A widget that fails once is left
    // out until the extension is next enabled.
    _create(id, size) {
        let widget = null;
        try {
            const Cls = this._classes.get(id);
            widget = new Cls({id, size, layer: this});
            this.actor.add_child(widget);
            widget.build();
            widget.refresh();
            widget.onCoveredChanged(this.covered);
            this.widgets.set(id, widget);
            return widget;
        } catch (e) {
            console.error(`desk-widgets: ${id} failed to build`, e);
            this._failed.add(id);
            try {
                widget?.destroy();
            } catch {
                // already broken; nothing more to do
            }
            return null;
        }
    }

    _queueCoverCheck() {
        if (this._coverSource)
            return;
        this._coverSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, COVER_DEBOUNCE_MS, () => {
            this._sources.delete(this._coverSource);
            this._coverSource = 0;
            this._checkCovered();
            return GLib.SOURCE_REMOVE;
        });
        this._sources.add(this._coverSource);
    }

    _checkCovered() {
        const monitor = Main.layoutManager.primaryIndex;
        const workspace = global.workspace_manager.get_active_workspace();
        const covered = workspace.list_windows().some(w =>
            w.get_monitor() === monitor &&
            w.get_window_type() === Meta.WindowType.NORMAL &&
            !w.minimized &&
            (w.is_fullscreen() || w.is_maximized()));
        if (covered === this.covered)
            return;
        this.covered = covered;
        this._each(widget => widget.onCoveredChanged(covered), 'cover change');
    }
}
