import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Widget} from '../widget.js';
import {dataPath, readText, writeText} from '../store.js';

const FILE = 'notes.md';
const SAVE_DELAY_MS = 1000;

export const NotesWidget = GObject.registerClass(
class NotesWidget extends Widget {
    build() {
        this._loaded = false;
        this._saved = '';
        this._saveTimer = 0;

        this.body.add_child(new St.Label({text: _('Notes'), style_class: 'dw-caption'}));

        this._entry = new St.Entry({
            style_class: 'dw-notes-entry',
            hint_text: _('Click to write…'),
            can_focus: true,
            x_expand: true, y_align: Clutter.ActorAlign.START,
        });
        const ct = this._entry.clutter_text;
        ct.single_line_mode = false;
        ct.activatable = false;
        ct.line_wrap = true;
        ct.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

        const scroll = new St.ScrollView({
            style_class: 'dw-notes-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true, y_expand: true,
        });
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        box.add_child(this._entry);
        scroll.set_child(box);
        // The scroll area is reactive (wheel), so the card never sees clicks
        // on its empty part; forward them.
        scroll.reactive = true;
        scroll.connect('button-release-event', () => {
            this.onClick();
            return Clutter.EVENT_STOP;
        });
        this.body.add_child(scroll);

        ct.connect('text-changed', () => this._queueSave());
        ct.connect('key-focus-out', () => this._save());
        ct.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            global.stage.set_key_focus(null);
            return Clutter.EVENT_STOP;
        });
        this.connect('destroy', () => this._save());

        this._load();
    }

    async _load() {
        const text = await readText(dataPath(FILE)) ?? '';
        if (this.destroyed)
            return;
        this._saved = text;
        this._entry.set_text(text);
        this._loaded = true;
    }

    // A click on the empty part of the card starts writing at the end.
    onClick() {
        this._entry.grab_key_focus();
        this._entry.clutter_text.set_cursor_position(-1);
    }

    _queueSave() {
        if (!this._loaded)
            return;
        this.cancel(this._saveTimer);
        this._saveTimer = this.after(SAVE_DELAY_MS, () => this._save());
    }

    _save() {
        if (!this._loaded)
            return;
        this.cancel(this._saveTimer);
        this._saveTimer = 0;
        const text = this._entry.get_text();
        if (text === this._saved)
            return;
        this._saved = text;
        writeText(dataPath(FILE), text)
            .catch(e => console.error('desk-widgets: could not save notes', e));
    }
});
