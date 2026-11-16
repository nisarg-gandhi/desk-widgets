import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {Widget} from '../widget.js';
import {monthGrid} from '../logic/dates.js';

export const CalendarWidget = GObject.registerClass(
class CalendarWidget extends Widget {
    static sizeFor(settings) {
        return settings.get_string('calendar-size') === 'medium' ? 'medium' : 'small';
    }

    build() {
        const row = new St.BoxLayout({x_expand: true, y_expand: true});
        this.body.add_child(row);

        const left = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
        });
        this._weekday = new St.Label({style_class: 'dw-cal-weekday'});
        this._day = new St.Label({style_class: 'dw-cal-day', y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._month = new St.Label({style_class: 'dw-secondary dw-cal-month'});
        left.add_child(this._weekday);
        left.add_child(this._day);
        left.add_child(this._month);
        row.add_child(left);

        if (this.sizeName === 'medium') {
            this._gridLayout = new Clutter.GridLayout({column_homogeneous: true, row_homogeneous: true});
            this._grid = new St.Widget({
                style_class: 'dw-cal-grid', layout_manager: this._gridLayout,
                x_expand: true, y_expand: true,
            });
            row.add_child(this._grid);
        }
    }

    refresh() {
        const now = this.layer.now();
        this._weekday.text = now.toLocaleDateString(undefined, {weekday: 'long'}).toUpperCase();
        this._day.text = String(now.getDate());
        this._month.text = now.toLocaleDateString(undefined, {month: 'long'});
        if (this._grid)
            this._fillGrid(now);
    }

    _fillGrid(now) {
        this._grid.destroy_all_children();
        const cell = (text, cls) => new St.Label({
            text, style_class: cls,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        // 2024-01-01 was a Monday; use it to get localized weekday initials.
        for (let col = 0; col < 7; col++) {
            const name = new Date(2024, 0, 1 + col).toLocaleDateString(undefined, {weekday: 'narrow'});
            this._gridLayout.attach(cell(name, 'dw-cal-head'), col, 0, 1, 1);
        }
        monthGrid(now).forEach((week, r) => week.forEach((day, col) => {
            if (day === null)
                return;
            const cls = day === now.getDate() ? 'dw-cal-cell dw-cal-today' : 'dw-cal-cell';
            this._gridLayout.attach(cell(String(day), cls), col, r + 1, 1, 1);
        }));
    }
});
