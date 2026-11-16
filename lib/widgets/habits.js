import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Widget} from '../widget.js';
import {HabitFile} from '../habitFile.js';
import {isoDate} from '../logic/dates.js';
import {MAX_SHOWN, allHabits, setSlot} from '../logic/habitStats.js';
import {toggle, last7, bestStreak} from '../logic/streaks.js';

export const HabitsWidget = GObject.registerClass(
class HabitsWidget extends Widget {
    build() {
        this._todayButtons = {};
        this._nameButtons = [];
        this._rowMenus = [];
        this._rowMenuManager = new PopupMenu.PopupMenuManager(this);

        this._rows = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'dw-habits-rows', x_expand: true, y_expand: true,
        });
        this.body.add_child(this._rows);
        this._footer = new St.Label({style_class: 'dw-secondary dw-habits-footer', x_align: Clutter.ActorAlign.END});
        this.body.add_child(this._footer);

        this._menu.addAction(_('Open Habit Tracker'), () => this.layer.openHabitApp());

        // Shared with the Habit Tracker app; reloads when the app writes it.
        this._file = new HabitFile(() => {
            if (!this.destroyed)
                this.refresh();
        });
        this.connect('destroy', () => {
            this._file.stop();
            this._clearRowMenus();
        });
        this.track(this.layer.settings, 'changed::habit-names', () => this.refresh());
        this._file.start();
    }

    // The habits shown on the widget, in row order.
    get names() {
        const out = [];
        for (const raw of this.layer.settings.get_strv('habit-names')) {
            const name = raw.trim();
            if (name && !out.includes(name))
                out.push(name);
        }
        return out.slice(0, MAX_SHOWN);
    }

    _clearRowMenus() {
        for (const menu of this._rowMenus)
            menu.destroy();
        this._rowMenus = [];
    }

    // The menu behind a habit's name: put any habit in this row.
    _rowMenu(button, index, current) {
        const menu = new PopupMenu.PopupMenu(button, 0, St.Side.TOP);
        for (const name of allHabits(this._file.data, this.names)) {
            const item = menu.addAction(name, () => {
                this.layer.settings.set_strv('habit-names', setSlot(this.names, index, name));
            });
            item.setOrnament(name === current ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(_('New habit…'), () => this.layer.openHabitApp(['--new']));
        menu.addAction(_('Open Habit Tracker'), () => this.layer.openHabitApp());
        menu.actor.hide();
        Main.uiGroup.add_child(menu.actor);
        this._rowMenuManager.addMenu(menu);
        this._rowMenus.push(menu);
        button.connect('clicked', () => menu.toggle());
    }

    refresh() {
        const today = this.layer.now();
        const data = this._file.data;
        this._clearRowMenus();
        this._rows.destroy_all_children();
        this._todayButtons = {};
        this._nameButtons = [];

        const names = this.names;
        names.forEach((name, index) => {
            const row = new St.BoxLayout({style_class: 'dw-habits-row', x_expand: true});
            const nameButton = new St.Button({
                style_class: 'dw-habits-name', label: name,
                x_expand: true, x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER,
            });
            this._rowMenu(nameButton, index, name);
            this._nameButtons.push(nameButton);
            row.add_child(nameButton);
            last7(data, name, today).forEach((done, i) => {
                const isToday = i === 6;
                const cls = `dw-dot${done ? ' dw-dot-done' : ''}${isToday ? ' dw-dot-today' : ''}`;
                let dot;
                if (isToday) {
                    dot = new St.Button({style_class: cls, y_align: Clutter.ActorAlign.CENTER});
                    dot.connect('clicked', () => this._tick(name));
                    this._todayButtons[name] = dot;
                } else {
                    dot = new St.Widget({style_class: cls, y_align: Clutter.ActorAlign.CENTER});
                }
                row.add_child(dot);
            });
            this._rows.add_child(row);
        });

        if (names.length < MAX_SHOWN) {
            const add = new St.Button({
                style_class: 'dw-habits-name dw-secondary', label: _('+ Add a habit'),
                x_align: Clutter.ActorAlign.START,
            });
            this._rowMenu(add, names.length, null);
            this._addButton = add;
            this._rows.add_child(add);
        }

        if (this._file.blocked) {
            this._footer.text = _('habits.json cannot be read');
        } else {
            const best = bestStreak(data, names, today);
            this._footer.text = best > 0 ? _('%d-day streak').replace('%d', best) : '';
        }
    }

    // Writes happen only here (and in the app): never on load, so a
    // hand-edited file that fails to parse is left alone until a tick, and is
    // then copied to habits.json.bak first.
    _tick(name) {
        const iso = isoDate(this.layer.now());
        this._file.update(data => toggle(data, name, iso));
    }
});
