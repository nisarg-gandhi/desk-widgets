// Habit Tracker: the app that goes with the desktop Habits widget.
// Run with: gjs -m app/habits.js [--page=today|week|all] [--new]
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import System from 'system';
import {HabitFile} from '../lib/habitFile.js';
import * as H from '../lib/logic/habitStats.js';
import {streak} from '../lib/logic/streaks.js';

const APP_ID = 'io.github.nisarg_gandhi.DeskWidgetsHabits';
const SCHEMA = 'org.gnome.shell.extensions.desk-widgets';
const ACCENT = [1, 0.624, 0.039];      // #ff9f0a, the widget's habit colour
const CELL = 12;
const GAP = 3;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CSS = `
.day-dot { min-width: 30px; min-height: 30px; padding: 0; border-radius: 15px; }
.day-dot:checked { background-color: #ff9f0a; color: #1c1c1e; }
.day-today { box-shadow: inset 0 0 0 2px #ff9f0a; }
.stat-value { font-size: 28px; font-weight: 300; }
.stat-tile { padding: 14px 18px; border-radius: 14px; background-color: alpha(currentColor, 0.06); }
.week-head { font-size: 11px; font-weight: 600; opacity: 0.6; }
.week-name { font-weight: 600; }
`;

const ERRORS = {
    empty: 'Type a name.',
    long: `Keep it to ${H.MAX_NAME} characters or fewer.`,
    duplicate: 'You already have a habit with that name.',
};

// The extension's settings live in its own folder, next to this app.
function loadSettings() {
    const root = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
    try {
        const source = Gio.SettingsSchemaSource.new_from_directory(
            `${root}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup(SCHEMA, false);
        return schema ? new Gio.Settings({settings_schema: schema}) : null;
    } catch {
        return null;
    }
}

class HabitWindow {
    constructor(app) {
        this.settings = loadSettings();
        this.weekDate = new Date();
        this.selected = null;           // habit shown on the All time page
        this.file = new HabitFile(() => this.renderSoon());

        this.window = new Adw.ApplicationWindow({
            application: app, title: 'Habit Tracker',
            default_width: 920, default_height: 640,
        });

        this.stack = new Adw.ViewStack();
        this.pages = {};
        for (const [name, title, icon] of [
            ['today', 'Today', 'object-select-symbolic'],
            ['week', 'Week', 'x-office-calendar-symbolic'],
            ['all', 'All time', 'view-grid-symbolic'],
        ]) {
            const scroll = new Gtk.ScrolledWindow({hscrollbar_policy: Gtk.PolicyType.AUTOMATIC, vexpand: true});
            this.pages[name] = scroll;
            this.stack.add_titled_with_icon(scroll, name, title, icon);
        }

        const header = new Adw.HeaderBar({
            title_widget: new Adw.ViewSwitcher({stack: this.stack, policy: Adw.ViewSwitcherPolicy.WIDE}),
        });
        const add = new Gtk.Button({icon_name: 'list-add-symbolic', tooltip_text: 'New habit'});
        add.connect('clicked', () => this.askName(null));
        header.pack_start(add);

        this.toasts = new Adw.ToastOverlay({child: this.stack});
        const view = new Adw.ToolbarView({content: this.toasts});
        view.add_top_bar(header);
        this.window.set_content(view);

        this.settings?.connect('changed::habit-names', () => this.renderSoon());
        this.window.connect('close-request', () => {
            if (this._renderId)
                GLib.source_remove(this._renderId);
            this._renderId = 0;
            this.file.stop();
            return false;
        });
        this.file.start();
    }

    // --- data -------------------------------------------------------------

    get shown() {
        return (this.settings?.get_strv('habit-names') ?? []).map(n => n.trim()).filter(Boolean);
    }

    set shown(names) {
        this.settings?.set_strv('habit-names', names);
    }

    get habits() {
        return H.allHabits(this.file.data, this.shown);
    }

    toast(text) {
        this.toasts.add_toast(new Adw.Toast({title: text, timeout: 3}));
    }

    setDay(habit, iso, done) {
        this.file.update(data => H.setDay(data, habit, iso, done));
    }

    // --- rendering ----------------------------------------------------------

    // Rebuild on idle: changes often arrive from inside a button's own click
    // handler, and several can arrive together.
    renderSoon() {
        if (this._renderId)
            return;
        this._renderId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._renderId = 0;
            this.render();
            return GLib.SOURCE_REMOVE;
        });
    }

    render() {
        if (!this.file.loaded)
            return;
        const habits = this.habits;
        if (!habits.includes(this.selected))
            this.selected = habits[0] ?? null;
        const today = new Date();
        if (this.file.blocked) {
            const page = () => new Adw.StatusPage({
                icon_name: 'dialog-warning-symbolic', title: 'Cannot read your habits',
                description: `${this.file.path} exists but could not be read. Nothing will be changed until it can.`,
            });
            for (const scroll of Object.values(this.pages))
                scroll.set_child(page());
            return;
        }
        if (habits.length === 0) {
            for (const scroll of Object.values(this.pages))
                scroll.set_child(this.emptyPage());
            return;
        }
        this.pages.today.set_child(this.todayPage(habits, today));
        this.pages.week.set_child(this.weekPage(habits, today));
        this.pages.all.set_child(this.allPage(habits, today));
    }

    emptyPage() {
        const page = new Adw.StatusPage({
            icon_name: 'object-select-symbolic', title: 'No habits yet',
            description: 'Add one to start tracking it.',
        });
        const button = new Gtk.Button({label: 'New habit', halign: Gtk.Align.CENTER, css_classes: ['pill', 'suggested-action']});
        button.connect('clicked', () => this.askName(null));
        page.set_child(button);
        return page;
    }

    todayPage(habits, today) {
        const iso = H.isoDate(today);
        const group = new Adw.PreferencesGroup({
            title: today.toLocaleDateString(undefined, {weekday: 'long', day: 'numeric', month: 'long'}),
            description: 'Starred habits are shown on the desktop widget.',
        });
        const shown = this.shown;
        for (const habit of habits) {
            const done = (this.file.data[habit] ?? []).includes(iso);
            const run = streak(this.file.data, habit, today);
            const row = new Adw.ActionRow({
                title: GLib.markup_escape_text(habit, -1),
                subtitle: run > 0 ? `${run}-day streak` : H.lastDoneText(H.lastDone(this.file.data, habit, today)),
            });

            const check = new Gtk.CheckButton({active: done, valign: Gtk.Align.CENTER});
            check.connect('toggled', () => this.setDay(habit, iso, check.active));
            row.add_prefix(check);
            row.activatable_widget = check;

            const starred = shown.includes(habit);
            const star = new Gtk.Button({
                icon_name: starred ? 'starred-symbolic' : 'non-starred-symbolic',
                tooltip_text: starred ? 'Remove from the desktop widget' : 'Show on the desktop widget',
                valign: Gtk.Align.CENTER, css_classes: ['flat'],
            });
            star.connect('clicked', () => this.toggleStar(habit));
            row.add_suffix(star);

            const rename = new Gtk.Button({label: 'Rename', css_classes: ['flat']});
            const remove = new Gtk.Button({label: 'Delete…', css_classes: ['flat', 'destructive-action']});
            const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2});
            box.append(rename);
            box.append(remove);
            const popover = new Gtk.Popover({child: box});
            rename.connect('clicked', () => { popover.popdown(); this.askName(habit); });
            remove.connect('clicked', () => { popover.popdown(); this.askDelete(habit); });
            row.add_suffix(new Gtk.MenuButton({
                icon_name: 'view-more-symbolic', tooltip_text: 'More',
                valign: Gtk.Align.CENTER, css_classes: ['flat'], popover,
            }));
            group.add(row);
        }
        const page = new Adw.PreferencesPage();
        page.add(group);
        return page;
    }

    weekPage(habits, today) {
        const todayIso = H.isoDate(today);
        const days = H.weekDays(this.weekDate);
        const isCurrent = days.includes(todayIso);

        const nav = new Gtk.Box({spacing: 8, halign: Gtk.Align.CENTER});
        const prev = new Gtk.Button({icon_name: 'go-previous-symbolic', tooltip_text: 'Previous week', css_classes: ['flat']});
        const next = new Gtk.Button({icon_name: 'go-next-symbolic', tooltip_text: 'Next week', css_classes: ['flat'], sensitive: !isCurrent});
        const label = new Gtk.Label({label: H.weekLabel(this.weekDate), css_classes: ['title-3'], width_chars: 26});
        const now = new Gtk.Button({label: 'This week', sensitive: !isCurrent});
        const go = date => { this.weekDate = date; this.renderSoon(); };
        prev.connect('clicked', () => go(H.shiftWeek(this.weekDate, -1)));
        next.connect('clicked', () => go(H.shiftWeek(this.weekDate, 1)));
        now.connect('clicked', () => go(new Date()));
        for (const w of [prev, label, next, now])
            nav.append(w);

        const grid = new Gtk.Grid({column_spacing: 10, row_spacing: 10, halign: Gtk.Align.CENTER});
        days.forEach((iso, col) => {
            const head = new Gtk.Label({
                label: `${WEEKDAYS[col]}\n${Number(iso.slice(8))}`, justify: Gtk.Justification.CENTER,
                css_classes: ['week-head'],
            });
            grid.attach(head, col + 1, 0, 1, 1);
        });
        habits.forEach((habit, r) => {
            const done = new Set(this.file.data[habit] ?? []);
            grid.attach(new Gtk.Label({
                label: habit, xalign: 0, css_classes: ['week-name'],
                ellipsize: Pango.EllipsizeMode.END, max_width_chars: 22, width_chars: 14,
            }), 0, r + 1, 1, 1);
            days.forEach((iso, col) => {
                const future = iso > todayIso;
                const dot = new Gtk.ToggleButton({
                    active: done.has(iso), sensitive: !future,
                    tooltip_text: future ? 'Not yet' : iso,
                    halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER,
                    css_classes: iso === todayIso ? ['day-dot', 'day-today'] : ['day-dot'],
                });
                dot.connect('toggled', () => this.setDay(habit, iso, dot.active));
                grid.attach(dot, col + 1, r + 1, 1, 1);
            });
            grid.attach(new Gtk.Label({
                label: `${H.weekCount(this.file.data, habit, this.weekDate)}/7`,
                css_classes: ['dim-label', 'numeric'], xalign: 1, width_chars: 4,
            }), 8, r + 1, 1, 1);
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 24,
            margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24,
        });
        box.append(nav);
        box.append(grid);
        box.append(new Gtk.Label({
            label: 'Click any day up to today to tick or untick it.',
            css_classes: ['dim-label', 'caption'],
        }));
        return box;
    }

    allPage(habits, today) {
        const habit = this.selected;
        const data = this.file.data;

        const picker = new Gtk.DropDown({
            model: Gtk.StringList.new(habits), selected: habits.indexOf(habit),
            halign: Gtk.Align.CENTER,
        });
        picker.connect('notify::selected', () => {
            const choice = habits[picker.selected];
            if (choice && choice !== this.selected) {
                this.selected = choice;
                this.renderSoon();
            }
        });

        const tiles = new Gtk.Box({spacing: 12, halign: Gtk.Align.CENTER, homogeneous: true});
        const tile = (value, caption) => {
            const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, css_classes: ['stat-tile']});
            box.append(new Gtk.Label({label: String(value), css_classes: ['stat-value', 'numeric'], xalign: 0}));
            box.append(new Gtk.Label({label: caption, css_classes: ['dim-label', 'caption'], xalign: 0}));
            tiles.append(box);
        };
        tile(H.totalDays(data, habit), 'Total days');
        tile(streak(data, habit, today), 'Current streak');
        tile(H.longestStreak(data, habit), 'Best streak');
        tile(`${H.monthPercent(data, habit, today)}%`, 'This month');

        const weeks = H.yearGrid(data, habit, today);
        const left = 30;
        const top = 18;
        const area = new Gtk.DrawingArea({
            content_width: left + weeks.length * (CELL + GAP),
            content_height: top + 7 * (CELL + GAP),
            halign: Gtk.Align.CENTER,
        });
        area.set_draw_func((widget, cr) => {
            const fg = widget.get_color();
            const ink = alpha => cr.setSourceRGBA(fg.red, fg.green, fg.blue, alpha);
            cr.setFontSize(10);
            ink(0.55);
            [[0, 'Mon'], [2, 'Wed'], [4, 'Fri']].forEach(([rowIndex, text]) => {
                cr.moveTo(0, top + rowIndex * (CELL + GAP) + CELL - 2);
                cr.showText(text);
            });
            let lastMonth = -1;
            weeks.forEach((week, w) => {
                const x = left + w * (CELL + GAP);
                const month = Number(week[0].iso.slice(5, 7)) - 1;
                if (month !== lastMonth && Number(week[0].iso.slice(8)) <= 7) {
                    ink(0.55);
                    cr.moveTo(x, 10);
                    cr.showText(MONTHS[month]);
                }
                lastMonth = month;
                week.forEach((cell, d) => {
                    if (cell.future)
                        return;
                    const y = top + d * (CELL + GAP);
                    if (cell.done)
                        cr.setSourceRGBA(...ACCENT, 1);
                    else
                        ink(0.1);
                    cr.rectangle(x, y, CELL, CELL);
                    cr.fill();
                });
            });
            cr.$dispose();
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 24,
            margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24,
        });
        box.append(picker);
        box.append(tiles);
        box.append(area);
        box.append(new Gtk.Label({
            label: 'The last 53 weeks, one square per day. To change a past day, use the Week view.',
            css_classes: ['dim-label', 'caption'],
        }));
        return box;
    }

    // --- actions --------------------------------------------------------------

    toggleStar(habit) {
        if (!this.settings) {
            this.toast('The desktop widget settings are not available.');
            return;
        }
        const {names, ok} = H.toggleStar(this.shown, habit);
        if (!ok) {
            this.toast(`The widget shows ${H.MAX_SHOWN} habits. Unstar one first.`);
            return;
        }
        this.shown = names;
    }

    // New habit (renaming === null) or rename an existing one.
    askName(renaming) {
        const entry = new Gtk.Entry({text: renaming ?? '', activates_default: true, max_length: H.MAX_NAME + 10});
        const hint = new Gtk.Label({label: '', xalign: 0, css_classes: ['caption', 'error']});
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        box.append(entry);
        box.append(hint);
        const dialog = new Adw.AlertDialog({
            heading: renaming ? `Rename “${renaming}”` : 'New habit',
            body: renaming ? 'Its history is kept.' : 'What do you want to track?',
            extra_child: box, default_response: 'save', close_response: 'cancel',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('save', renaming ? 'Rename' : 'Add');
        dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
        const check = () => {
            const error = H.nameError(this.file.data, this.shown, entry.text, renaming);
            dialog.set_response_enabled('save', error === null);
            hint.label = error && entry.text.trim() ? ERRORS[error] : '';
        };
        entry.connect('changed', check);
        check();
        dialog.connect('response', (_d, response) => {
            if (response !== 'save')
                return;
            const name = entry.text.trim();
            if (H.nameError(this.file.data, this.shown, name, renaming) !== null)
                return;
            if (renaming) {
                if (name === renaming)
                    return;
                this.file.update(data => H.renameHabit(data, renaming, name));
                if (this.selected === renaming)
                    this.selected = name;
                this.renderSoon();
                if (this.shown.includes(renaming))
                    this.shown = H.renameIn(this.shown, renaming, name);
            } else {
                this.file.update(data => H.addHabit(data, name));
                this.selected = name;
                // Put it on the widget too while there is room.
                if (this.settings && this.shown.length < H.MAX_SHOWN)
                    this.shown = [...this.shown, name];
            }
        });
        dialog.present(this.window);
        entry.grab_focus();
    }

    askDelete(habit) {
        const total = H.totalDays(this.file.data, habit);
        const dialog = new Adw.AlertDialog({
            heading: `Delete “${habit}”?`,
            body: total > 0
                ? `Its history of ${total} ${total === 1 ? 'day' : 'days'} will be removed. This cannot be undone.`
                : 'It has no history yet.',
            default_response: 'cancel', close_response: 'cancel',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('delete', 'Delete');
        dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_d, response) => {
            if (response !== 'delete')
                return;
            this.file.update(data => H.deleteHabit(data, habit));
            if (this.shown.includes(habit))
                this.shown = this.shown.filter(n => n !== habit);
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
        main = new HabitWindow(app);
    main.window.present();
    const page = args.find(a => a.startsWith('--page='))?.slice(7);
    if (page && main.pages[page])
        main.stack.set_visible_child_name(page);
    if (args.includes('--new'))
        main.askName(null);
    return 0;
});

app.connect('window-removed', () => {
    main = null;
});

System.exit(app.run([System.programInvocationName, ...ARGV]));
