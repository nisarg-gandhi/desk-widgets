import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Widget} from '../widget.js';
import {cardNote} from '../logic/notes.js';
import {NotesWatcher, freshId, listNotes, migrateOldNote, writeNote} from '../noteStore.js';

const SAVE_DELAY_MS = 1000;

// Shows the note pinned in the Notes app (or the most recently edited one)
// and edits it in place. Changes made in the app show up here.
export const NotesWidget = GObject.registerClass(
class NotesWidget extends Widget {
    build() {
        this._id = null;          // the note on the card; null = none yet
        this._loaded = false;
        this._saved = '';
        this._saveTimer = 0;
        this._loadSerial = 0;

        // The header sits on its own layer above the note, not in the body:
        // a scrolled note's content box moves up behind the header, and in
        // the same layer it would take the header's clicks.
        const head = new St.BoxLayout({
            style_class: 'dw-notes-head', reactive: true,
            x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.START,
        });
        this._caption = new St.Label({
            text: _('Notes'), style_class: 'dw-caption',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER,
        });
        head.add_child(this._caption);
        const open = new St.Button({style_class: 'dw-quote-swap', label: _('Open'), y_align: Clutter.ActorAlign.CENTER});
        open.connect('clicked', () => this._openApp());
        head.add_child(open);
        this._openButton = open;
        this.add_child(head);
        // Room for the header at the top of the body.
        this.body.add_child(new St.Widget({style_class: 'dw-notes-head-space'}));

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

        this._scroll = new St.ScrollView({
            style_class: 'dw-notes-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true, y_expand: true,
            // Clip clicks as well as drawing: scrolled-away text would
            // otherwise still catch clicks on the header above it.
            clip_to_allocation: true,
        });
        this._box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._box.add_child(this._entry);
        this._scroll.set_child(this._box);
        // The scroll area is reactive (wheel), so the card never sees clicks
        // on its empty part; forward them.
        this._scroll.reactive = true;
        this._scroll.connect('button-release-event', () => {
            this.onClick();
            return Clutter.EVENT_STOP;
        });
        this.body.add_child(this._scroll);

        ct.connect('text-changed', () => {
            this._queueSave();
            this._followCursor();
        });
        ct.connect('cursor-changed', () => this._followCursor());
        ct.connect('key-focus-out', () => {
            this._save();
            this._load();     // pick up anything the app changed meanwhile
        });
        ct.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            global.stage.set_key_focus(null);
            return Clutter.EVENT_STOP;
        });

        this._menu.addAction(_('Open Notes'), () => this._openApp());
        this.track(this.layer.settings, 'changed::pinned-note', () => this._load());
        this._watcher = new NotesWatcher(() => this._load());
        this.connect('destroy', () => {
            this._save();
            this._watcher.stop();
        });

        migrateOldNote(this.layer.settings)
            .catch(e => console.error('desk-widgets: notes migration failed', e))
            .finally(() => this._load());
    }

    get _focused() {
        return global.stage.get_key_focus() === this._entry.clutter_text;
    }

    _openApp() {
        this._save();
        this.layer.openNotesApp(this._id ? [`--note=${this._id}`] : []);
    }

    // Load the card's note from disk. Skipped while you are typing, so the
    // text never jumps under the cursor; it runs again on focus-out.
    async _load() {
        if (this.destroyed || this._focused || this._dirty)
            return;
        const serial = ++this._loadSerial;
        const notes = await listNotes();
        if (this.destroyed || serial !== this._loadSerial || this._focused || this._dirty)
            return;
        const note = cardNote(notes, this.layer.settings.get_string('pinned-note'));
        this._id = note?.id ?? null;
        this._saved = note?.text ?? '';
        if (this._entry.get_text() !== this._saved) {
            this._loading = true;
            this._entry.set_text(this._saved);
            this._loading = false;
        }
        this._loaded = true;
    }

    get _dirty() {
        return this._loaded && this._entry.get_text() !== this._saved;
    }

    // Keep the line with the cursor inside the visible part of the card.
    _followCursor() {
        this.cancel(this._followTimer);
        this._followTimer = this.after(20, () => {
            const ct = this._entry.clutter_text;
            const [ok, , y, lineHeight] = ct.position_to_coords(ct.cursor_position);
            if (!ok)
                return;
            const top = ct.get_transformed_position()[1] - this._box.get_transformed_position()[1] + y;
            const adj = this._scroll.vadjustment;
            if (top < adj.value)
                adj.value = top;
            else if (top + lineHeight > adj.value + adj.page_size)
                adj.value = top + lineHeight - adj.page_size;
        });
    }

    // A click on the empty part of the card starts writing at the end.
    onClick() {
        this._entry.grab_key_focus();
        this._entry.clutter_text.set_cursor_position(-1);
    }

    _queueSave() {
        if (!this._loaded || this._loading)
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
        (async () => {
            if (this._id === null) {
                if (!text.trim())
                    return;
                // First words typed on an empty card start a new pinned note.
                this._id = freshId(await listNotes());
                this.layer.settings.set_string('pinned-note', this._id);
            }
            await writeNote(this._id, text);
        })().catch(e => console.error('desk-widgets: could not save the note', e));
    }
});
