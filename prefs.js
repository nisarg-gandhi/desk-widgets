import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const WIDGETS = [
    ['calendar', 'Calendar'],
    ['stats', 'System Stats'],
    ['quote', 'Quote / Dev Tip'],
    ['markets', 'Markets'],
    ['habits', 'Habits'],
    ['notes', 'Quick Notes'],
    ['clipboard', 'Clipboard'],
];
const MAX_ROWS = 4;

function buttonRow(title, subtitle, label, onClick) {
    const row = new Adw.ActionRow({title, subtitle});
    const button = new Gtk.Button({label, valign: Gtk.Align.CENTER});
    button.connect('clicked', onClick);
    row.add_suffix(button);
    row.activatable_widget = button;
    return row;
}

// A combo row bound to a string setting with fixed choices.
function choiceRow(settings, key, title, choices) {
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(choices.map(([, label]) => label)),
    });
    const sync = () => {
        const i = choices.findIndex(([value]) => value === settings.get_string(key));
        if (i !== -1 && row.selected !== i)
            row.selected = i;
    };
    sync();
    row.connect('notify::selected', () => {
        const value = choices[row.selected]?.[0];
        if (value && value !== settings.get_string(key))
            settings.set_string(key, value);
    });
    settings.connect(`changed::${key}`, sync);
    return row;
}

// A few text rows backed by a string-list setting. Empty rows are
// dropped when saved; Enter or the tick button saves.
function listGroup(settings, key, {title, description, rowTitle, max = MAX_ROWS}) {
    const group = new Adw.PreferencesGroup({title, description});
    const rows = [];
    const save = () => {
        const values = rows.map(r => r.text.trim()).filter(Boolean);
        settings.set_strv(key, values);
        fill();
    };
    const fill = () => {
        const values = settings.get_strv(key);
        rows.forEach((row, i) => {
            const text = values[i] ?? '';
            if (row.text !== text)
                row.text = text;
        });
    };
    for (let i = 0; i < max; i++) {
        const row = new Adw.EntryRow({title: `${rowTitle} ${i + 1}`, show_apply_button: true});
        row.connect('apply', save);
        rows.push(row);
        group.add(row);
    }
    fill();
    settings.connect(`changed::${key}`, fill);
    return group;
}

export default class DeskWidgetsPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        // Widgets
        const widgets = new Adw.PreferencesGroup({
            title: _('Widgets'),
            description: _('Drag a widget on the desktop to move it. Right-click it to hide it.'),
        });
        const switches = new Map();
        const syncHidden = () => {
            const hidden = settings.get_strv('hidden');
            for (const [id, row] of switches) {
                const active = !hidden.includes(id);
                if (row.active !== active)
                    row.active = active;
            }
        };
        for (const [id, title] of WIDGETS) {
            const row = new Adw.SwitchRow({title: _(title)});
            row.connect('notify::active', () => {
                const hidden = new Set(settings.get_strv('hidden'));
                if (row.active === !hidden.has(id))
                    return;
                if (row.active)
                    hidden.delete(id);
                else
                    hidden.add(id);
                settings.set_strv('hidden', [...hidden]);
            });
            switches.set(id, row);
            widgets.add(row);
        }
        syncHidden();
        settings.connect('changed::hidden', syncHidden);
        widgets.add(buttonRow(_('Layout'), _('Put every widget back in its default place'),
            _('Reset layout'), () => settings.reset('positions')));
        page.add(widgets);

        // Calendar and quote
        const display = new Adw.PreferencesGroup({title: _('Calendar and quote')});
        display.add(choiceRow(settings, 'calendar-size', _('Calendar size'),
            [['small', _('Small')], ['medium', _('Medium, with month')]]));
        display.add(choiceRow(settings, 'quote-mode', _('Daily card shows'),
            [['quotes', _('Quotes')], ['tips', _('Dev tips')], ['alternate', _('Alternate days')]]));
        page.add(display);

        // Markets
        page.add(listGroup(settings, 'market-symbols', {
            title: _('Markets'),
            description: _('Stock symbol (AAPL, ^NSEI) or currency pair (USD/INR). Press Enter to save.'),
            rowTitle: _('Row'),
        }));

        // Habits
        const habits = listGroup(settings, 'habit-names', {
            title: _('Habits on the widget'),
            description: _('The three habits shown on the desktop. Press Enter to save. Add, rename and review habits in the Habit Tracker.'),
            rowTitle: _('Row'),
            max: 3,
        });
        habits.add(buttonRow(_('Habit Tracker'), _('All habits, weekly view and history'),
            _('Open'), () => {
                try {
                    Gio.Subprocess.new(['gjs', '-m', `${this.path}/app/habits.js`], Gio.SubprocessFlags.NONE);
                } catch (e) {
                    console.error(e);
                }
            }));
        page.add(habits);

        // Clipboard
        const clipboard = new Adw.PreferencesGroup({
            title: _('Clipboard'),
            description: _('History is kept in memory only and is never saved to disk.'),
        });
        const keep = new Adw.SwitchRow({title: _('Keep clipboard history')});
        settings.bind('clipboard-enabled', keep, 'active', Gio.SettingsBindFlags.DEFAULT);
        clipboard.add(keep);
        clipboard.add(buttonRow(_('History'), _('Forget everything copied so far'),
            _('Clear history'), () => settings.set_int('clipboard-clear', settings.get_int('clipboard-clear') + 1)));
        page.add(clipboard);
    }
}
