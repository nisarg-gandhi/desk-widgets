import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const DRAG_THRESHOLD = 8;

// A card on the desktop. Subclasses override build() / refresh() and may
// override onClick() and onCoveredChanged().
export const Widget = GObject.registerClass(
class Widget extends St.Widget {
    // Size this widget should have under the given settings.
    static sizeFor(_settings) {
        return 'medium';
    }

    constructor({id, size, layer}) {
        super({
            style_class: `dw-card dw-${id} dw-${size}`,
            reactive: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this.id = id;
        this.sizeName = size;
        this.layer = layer;
        this._timeouts = new Set();
        this._tracked = [];
        this._drag = null;

        this.body = new St.BoxLayout({
            style_class: 'dw-content',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
        });
        this.add_child(this.body);

        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
        this._menu.addAction(_('Hide'), () => this.layer.hideWidget(this.id));
        this._menu.addAction(_('Settings'), () => this.layer.openSettings());
        this._menu.actor.hide();
        Main.uiGroup.add_child(this._menu.actor);
        this._menuManager.addMenu(this._menu);

        // A drag whose button release never reaches the card (the overview or
        // another modal took over) must not keep its pointer grab.
        this.track(Main.overview, 'showing', () => this._cancelDrag());

        this.connect('destroy', () => this._cleanup());
    }

    // --- hooks -----------------------------------------------------------
    build() {}
    refresh() {}
    onClick() {}
    onCoveredChanged(_covered) {}

    // --- helpers, cleaned up automatically --------------------------------
    every(seconds, fn) {
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._guard(fn);
            return GLib.SOURCE_CONTINUE;
        });
        this._timeouts.add(id);
        return id;
    }

    after(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            this._guard(fn);
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        return id;
    }

    // A throwing callback must not kill its timer or escape into the shell.
    _guard(fn) {
        try {
            fn();
        } catch (e) {
            console.error(`desk-widgets: ${this.id} callback failed`, e);
        }
    }

    cancel(id) {
        if (id && this._timeouts.delete(id))
            GLib.source_remove(id);
    }

    track(obj, signal, fn) {
        this._tracked.push([obj, obj.connect(signal, fn)]);
    }

    get destroyed() {
        return this._destroyed === true;
    }

    _cleanup() {
        this._destroyed = true;
        this._drag = null;
        this._endGrab();
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        for (const [obj, id] of this._tracked)
            obj.disconnect(id);
        this._tracked = [];
        this._menu.destroy();
        this._menu = null;
        this._menuManager = null;
    }

    // --- drag, click, menu -------------------------------------------------
    vfunc_button_press_event(event) {
        const button = event.get_button();
        if (button === Clutter.BUTTON_SECONDARY) {
            this._menu.toggle();
            return Clutter.EVENT_STOP;
        }
        if (button !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        // A press on a button or text entry inside the card belongs to that
        // child. Grabbing here would cancel its click gesture.
        if (this._onInteractiveChild(event))
            return Clutter.EVENT_PROPAGATE;
        this._cancelDrag();     // an earlier drag whose release never arrived
        const [px, py] = event.get_coords();
        this._drag = {px, py, ax: this.x, ay: this.y, moved: false};
        this._grab = global.stage.grab(this);
        this._grabRevokedId = this._grab.connect('notify::revoked', grab => {
            if (grab.revoked)
                this._cancelDrag();
        });
        return Clutter.EVENT_STOP;
    }

    vfunc_motion_event(event) {
        if (!this._drag)
            return Clutter.EVENT_PROPAGATE;
        if (!(event.get_state() & Clutter.ModifierType.BUTTON1_MASK)) {
            this._cancelDrag();     // the button is no longer held
            return Clutter.EVENT_PROPAGATE;
        }
        const [px, py] = event.get_coords();
        const dx = px - this._drag.px;
        const dy = py - this._drag.py;
        if (!this._drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD)
            return Clutter.EVENT_STOP;
        if (!this._drag.moved) {
            this._drag.moved = true;
            this.get_parent().set_child_above_sibling(this, null);
            this.add_style_pseudo_class('active');
        }
        this.set_position(this._drag.ax + dx, this._drag.ay + dy);
        return Clutter.EVENT_STOP;
    }

    vfunc_button_release_event(event) {
        if (!this._drag || event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        const moved = this._drag.moved;
        this._drag = null;
        this._endGrab();
        this.remove_style_pseudo_class('active');
        if (moved)
            this.layer.dropWidget(this, {x: this.x, y: this.y});
        else
            this.onClick();
        return Clutter.EVENT_STOP;
    }

    _onInteractiveChild(event) {
        let actor = global.stage.get_event_actor(event);
        while (actor && actor !== this) {
            if (actor.reactive)
                return true;
            actor = actor.get_parent();
        }
        return false;
    }

    // Abandon a drag without dropping: the card returns to its cell.
    _cancelDrag() {
        if (!this._drag && !this._grab)
            return;
        const moved = this._drag?.moved;
        this._drag = null;
        this._endGrab();
        this.remove_style_pseudo_class('active');
        if (moved && !this._destroyed)
            this.layer.restoreWidget(this);
    }

    _endGrab() {
        const grab = this._grab;
        if (!grab)
            return;
        this._grab = null;
        if (this._grabRevokedId)
            grab.disconnect(this._grabRevokedId);
        this._grabRevokedId = 0;
        grab.dismiss();
    }
});
