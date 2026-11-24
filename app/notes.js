// Notes: the app that goes with the desktop Notes card.
// Run with: gjs -m app/notes.js [--note=<id>] [--new]
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import System from 'system';
import {loadSettings} from '../lib/appSettings.js';
import {filterNotes, notePreview, noteTitle, sortNotes, whenText} from '../lib/logic/notes.js';
import {
    NotesWatcher, deleteEmptyNote, freshId, listNotes, migrateOldNote, trashNote, writeNote,
} from '../lib/noteStore.js';

const APP_ID = 'io.github.nisarg_gandhi.DeskWidgetsNotes';
const SAVE_DELAY_MS = 700;

const CSS = `
.note-row { padding: 8px 6px; }
.note-title { font-weight: 700; }
.note-meta { font-size: 0.85em; opacity: 0.65; }
.note-text { font-size: 1.08em; }
`;

class NotesWindow {
    constructor(app) {
        this.settings = loadSettings();
        this.notes = [];
        this.current = null;        // id of the note in the editor
        this.saved = '';            // what is on disk for it
        this.query = '';
        this.created = new Set();   // notes made in this window (removed if left empty)

        this.window = new Adw.ApplicationWindow({
            application: app, title: 'Notes', default_width: 960, default_height: 640,
        });

        // --- sidebar -------------------------------------------------------
        this.list = new Gtk.ListBox({css_classes: ['navigation-sidebar']});
        this.list.connect('row-selected', (_l, row) => {
            if (row && !this.syncing)
                this.open(row._id);
        });
        const search = new Gtk.SearchEntry({placeholder_text: 'Search notes', margin_start: 8, margin_end: 8, margin_bottom: 6});
        search.connect('search-changed', () => {
            this.query = search.text;
            this.renderList();
        });
        this.search = search;
        const sideBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        sideBox.append(search);
        sideBox.append(new Gtk.ScrolledWindow({child: this.list, vexpand: true, hscrollbar_policy: Gtk.PolicyType.NEVER}));

        const add = new Gtk.Button({icon_name: 'list-add-symbolic', tooltip_text: 'New note (Ctrl+N)'});
        add.connect('clicked', () => this.newNote());
        const sideHeader = new Adw.HeaderBar({title_widget: new Adw.WindowTitle({title: 'Notes'})});
        sideHeader.pack_start(add);
        const sideView = new Adw.ToolbarView({content: sideBox});
        sideView.add_top_bar(sideHeader);

        // --- editor ----------------------------------------------------------
        this.buffer = new Gtk.TextBuffer();
        this.buffer.connect('changed', () => this.onEdit());
        this.text = new Gtk.TextView({
            buffer: this.buffer, wrap_mode: Gtk.WrapMode.WORD_CHAR,
            left_margin: 28, right_margin: 28, top_margin: 18, bottom_margin: 28,
            css_classes: ['note-text'], vexpand: true,
        });
        this.editorTitle = new Adw.WindowTitle({title: ''});
        this.pin = new Gtk.ToggleButton({icon_name: 'view-pin-symbolic', tooltip_text: 'Show on the desktop card', visible: !!this.settings});
        this.pin.connect('toggled', () => {
            if (this.syncing || !this.current)
                return;
            this.settings.set_string('pinned-note', this.pin.active ? this.current : '');
        });
        const del = new Gtk.Button({icon_name: 'user-trash-symbolic', tooltip_text: 'Move to Trash'});
        del.connect('clicked', () => this.askDelete());
        const editHeader = new Adw.HeaderBar({title_widget: this.editorTitle});
        editHeader.pack_end(del);
        editHeader.pack_end(this.pin);

        this.empty = new Adw.StatusPage({
            icon_name: 'document-edit-symbolic', title: 'No notes yet',
            description: 'Your notes are plain text files, also shown on the desktop card.',
        });
        const first = new Gtk.Button({label: 'New note', halign: Gtk.Align.CENTER, css_classes: ['pill', 'suggested-action']});
        first.connect('clicked', () => this.newNote());
        this.empty.set_child(first);
        this.editorStack = new Gtk.Stack();
        this.editorStack.add_named(new Gtk.ScrolledWindow({child: this.text}), 'editor');
        this.editorStack.add_named(this.empty, 'empty');
        const editView = new Adw.ToolbarView({content: this.editorStack});
        editView.add_top_bar(editHeader);
        this.del = del;

        this.split = new Adw.NavigationSplitView({
            sidebar: new Adw.NavigationPage({child: sideView, title: 'Notes'}),
            content: new Adw.NavigationPage({child: editView, title: 'Note'}),
            min_sidebar_width: 240, max_sidebar_width: 320,
        });
        this.window.set_content(this.split);

        const shortcut = (accel, fn) => {
            const c = new Gtk.ShortcutController({scope: Gtk.ShortcutScope.MANAGED});
            c.add_shortcut(new Gtk.Shortcut({
                trigger: Gtk.ShortcutTrigger.parse_string(accel),
                action: Gtk.CallbackAction.new(() => (fn(), true)),
            }));
            this.window.add_controller(c);
        };
        shortcut('<Control>n', () => this.newNote());
        shortcut('<Control>f', () => this.search.grab_focus());

        this.settings?.connect('changed::pinned-note', () => this.renderList());
        this.window.connect('close-request', () => {
            this.flush();
            this.dropIfEmpty(this.current);
            this.watcher?.stop();
            return false;
        });
        this.ready = migrateOldNote(this.settings)
            .catch(e => console.error(e))
            .then(() => {
                this.watcher = new NotesWatcher(() => this.reload());
                return this.reload();
            });
    }

    get pinned() {
        return this.settings?.get_string('pinned-note') ?? '';
    }

    get dirty() {
        return this.current !== null && this.textNow() !== this.saved;
    }

    textNow() {
        const [a, b] = this.buffer.get_bounds();
        return this.buffer.get_text(a, b, false);
    }

    // --- loading ----------------------------------------------------------------

    async reload() {
        const notes = await listNotes();
        // Keep the open note's unsaved text, so the list matches the editor.
        if (this.dirty) {
            const mine = notes.find(n => n.id === this.current);
            if (mine)
                mine.text = this.textNow();
        }
        this.notes = notes;
        const open = notes.find(n => n.id === this.current);
        if (this.current && !open) {
            this.current = null;        // deleted elsewhere
        } else if (open && !this.dirty && open.text !== this.saved) {
            this.setEditor(open);       // changed on the desktop card
        }
        if (!this.current && notes.length)
            this.setEditor(sortNotes(notes, this.pinned)[0]);
        this.renderList();
        this.renderEditorChrome();
    }

    renderList() {
        this.syncing = true;
        this.list.remove_all();
        const shown = filterNotes(sortNotes(this.notes, this.pinned), this.query);
        const now = Date.now();
        for (const note of shown) {
            const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, css_classes: ['note-row']});
            const top = new Gtk.Box({spacing: 6});
            if (note.id === this.pinned)
                top.append(new Gtk.Image({icon_name: 'view-pin-symbolic', pixel_size: 12, tooltip_text: 'On the desktop card'}));
            top.append(new Gtk.Label({
                label: noteTitle(note.text), xalign: 0, hexpand: true,
                ellipsize: Pango.EllipsizeMode.END, css_classes: ['note-title'],
            }));
            box.append(top);
            box.append(new Gtk.Label({
                label: `${whenText(note.mtime, now)}   ${notePreview(note.text) || 'No additional text'}`,
                xalign: 0, ellipsize: Pango.EllipsizeMode.END, css_classes: ['note-meta'],
            }));
            const row = new Gtk.ListBoxRow({child: box});
            row._id = note.id;
            this.list.append(row);
            if (note.id === this.current)
                this.list.select_row(row);
        }
        if (shown.length === 0 && this.notes.length > 0) {
            const row = new Gtk.ListBoxRow({selectable: false, activatable: false,
                child: new Gtk.Label({label: 'No matching notes', css_classes: ['dim-label'], margin_top: 18})});
            this.list.append(row);
        }
        this.syncing = false;
    }

    renderEditorChrome() {
        const note = this.notes.find(n => n.id === this.current);
        this.editorStack.set_visible_child_name(note ? 'editor' : 'empty');
        this.editorTitle.title = note ? noteTitle(this.textNow()) : '';
        this.del.sensitive = !!note;
        this.pin.sensitive = !!note;
        this.syncing = true;
        this.pin.active = !!note && note.id === this.pinned;
        this.syncing = false;
    }

    setEditor(note) {
        this.current = note.id;
        this.saved = note.text;
        this.loading = true;
        this.buffer.set_text(note.text, -1);
        this.loading = false;
        this.buffer.place_cursor(this.buffer.get_end_iter());
    }

    // --- editing ----------------------------------------------------------------

    open(id) {
        if (id === this.current)
            return;
        const leaving = this.current;
        this.flush();
        const note = this.notes.find(n => n.id === id);
        if (!note)
            return;
        this.setEditor(note);
        this.dropIfEmpty(leaving);
        this.renderEditorChrome();
        this.split.show_content = true;
    }

    onEdit() {
        if (this.loading || !this.current)
            return;
        const note = this.notes.find(n => n.id === this.current);
        if (note) {
            note.text = this.textNow();
            note.mtime = Date.now();
        }
        this.editorTitle.title = noteTitle(this.textNow());
        if (this.saveId)
            GLib.source_remove(this.saveId);
        this.saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
            this.saveId = 0;
            this.flush();
            this.renderList();
            return GLib.SOURCE_REMOVE;
        });
    }

    flush() {
        if (this.saveId) {
            GLib.source_remove(this.saveId);
            this.saveId = 0;
        }
        if (!this.dirty)
            return;
        const text = this.textNow();
        this.saved = text;
        writeNote(this.current, text).catch(e => console.error('Notes: could not save', e));
    }

    // A note made here and left empty is removed when you move away from it.
    dropIfEmpty(id) {
        if (!id || !this.created.has(id))
            return;
        const note = this.notes.find(n => n.id === id);
        if (note && !note.text.trim()) {
            this.created.delete(id);
            this.notes = this.notes.filter(n => n.id !== id);
            deleteEmptyNote(id).catch(e => console.error(e));
        }
    }

    async newNote() {
        await this.ready;
        this.flush();
        const leaving = this.current;
        const id = freshId(this.notes);
        await writeNote(id, '');
        this.created.add(id);
        const note = {id, text: '', mtime: Date.now()};
        this.notes = [...this.notes, note];
        this.setEditor(note);
        this.dropIfEmpty(leaving);
        this.query = '';
        this.search.text = '';
        this.renderList();
        this.renderEditorChrome();
        this.split.show_content = true;
        this.text.grab_focus();
    }

    async select(id) {
        await this.ready;
        if (this.notes.some(n => n.id === id)) {
            this.open(id);
            this.renderList();
        }
        this.text.grab_focus();
    }

    askDelete() {
        const id = this.current;
        const note = this.notes.find(n => n.id === id);
        if (!note)
            return;
        const dialog = new Adw.AlertDialog({
            heading: `Move “${noteTitle(note.text)}” to the Trash?`,
            body: 'You can restore it from the Trash in Files.',
            default_response: 'cancel', close_response: 'cancel',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('trash', 'Move to Trash');
        dialog.set_response_appearance('trash', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', async (_d, response) => {
            if (response !== 'trash')
                return;
            if (this.saveId) {
                GLib.source_remove(this.saveId);
                this.saveId = 0;
            }
            await writeNote(id, this.textNow()).catch(() => {});
            await trashNote(id).catch(e => console.error('Notes: could not move to Trash', e));
            if (this.pinned === id)
                this.settings?.set_string('pinned-note', '');
            this.current = null;
            this.saved = '';
            await this.reload();
        });
        dialog.present(this.window);
    }
}

const app = new Adw.Application({application_id: APP_ID, flags: Gio.ApplicationFlags.HANDLES_COMMAND_LINE});
let main = null;

app.connect('startup', () => {
    const provider = new Gtk.CssProvider();
    provider.load_from_string(CSS);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
});

// Also runs in the first instance when the app is started a second time.
app.connect('command-line', (_app, commandLine) => {
    const args = commandLine.get_arguments().filter(a => a.startsWith('--'));
    if (!main || !main.window.get_application())
        main = new NotesWindow(app);
    main.window.present();
    const id = args.find(a => a.startsWith('--note='))?.slice(7);
    if (args.includes('--new'))
        main.newNote();
    else if (id)
        main.select(id);
    return 0;
});

app.connect('window-removed', () => {
    main = null;
});

System.exit(app.run([System.programInvocationName, ...ARGV]));
