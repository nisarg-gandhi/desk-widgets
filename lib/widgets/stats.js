import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {Widget} from '../widget.js';
import {parseProcStat, cpuPercent, parseMeminfo, pickTempSensor} from '../logic/cpu.js';
import {readText, diskUsedPercent} from '../store.js';

const POLL_SECONDS = 3;
const DISK_EVERY = 10;      // polls
const MAX_HWMON = 16;
const STROKE_RATIO = 5 / 54;   // ring thickness relative to its size (set in CSS)

const Ring = GObject.registerClass(
class Ring extends St.Widget {
    constructor(caption) {
        super({layout_manager: new Clutter.BoxLayout({orientation: Clutter.Orientation.VERTICAL, spacing: 6}), x_expand: true});
        this._value = null;
        const dial = new St.Widget({layout_manager: new Clutter.BinLayout(), x_align: Clutter.ActorAlign.CENTER});
        this._area = new St.DrawingArea({style_class: 'dw-stats-ring'});
        this._area.connect('repaint', a => this._draw(a));
        this._label = new St.Label({
            text: '—', style_class: 'dw-stats-value',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        dial.add_child(this._area);
        dial.add_child(this._label);
        this.add_child(dial);
        this.add_child(new St.Label({text: caption, style_class: 'dw-caption', x_align: Clutter.ActorAlign.CENTER}));
    }

    get text() {
        return this._label.text;
    }

    set(value) {
        if (value === this._value)
            return;
        this._value = value;
        this._label.text = value === null ? '—' : `${value}%`;
        this._area.queue_repaint();
    }

    _draw(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const fg = area.get_theme_node().get_foreground_color();
        const rgba = alpha => cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, alpha);
        const stroke = Math.min(w, h) * STROKE_RATIO;
        const r = Math.min(w, h) / 2 - stroke / 2;
        cr.setLineWidth(stroke);
        cr.setLineCap(1); // round
        rgba(0.14);
        cr.arc(w / 2, h / 2, r, 0, 2 * Math.PI);
        cr.stroke();
        if (this._value) {
            rgba(0.92);
            const start = -Math.PI / 2;
            cr.arc(w / 2, h / 2, r, start, start + 2 * Math.PI * this._value / 100);
            cr.stroke();
        }
        cr.$dispose();
    }
});

export const StatsWidget = GObject.registerClass(
class StatsWidget extends Widget {
    static sizeFor() {
        return 'small';
    }

    build() {
        const rings = new St.BoxLayout({x_expand: true, y_expand: true});
        this._cpu = new Ring('CPU');
        this._ram = new Ring('RAM');
        rings.add_child(this._cpu);
        rings.add_child(this._ram);
        this.body.add_child(rings);
        this._footer = new St.Label({
            text: '', style_class: 'dw-secondary dw-stats-footer',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.body.add_child(this._footer);

        this._prev = null;
        this._polls = 0;
        this._timer = 0;
        this._busy = false;
        this._temp = null;
        this._disk = null;
        this._tempPath = undefined; // undefined = not looked up yet, null = none
    }

    onCoveredChanged(covered) {
        if (covered) {
            this.cancel(this._timer);
            this._timer = 0;
        } else if (!this._timer) {
            this._timer = this.every(POLL_SECONDS, () => this._poll());
            this._poll();
        }
    }

    async _findTempSensor() {
        const names = [];
        for (let i = 0; i < MAX_HWMON; i++) {
            const name = await readText(`/sys/class/hwmon/hwmon${i}/name`);
            if (name === null)
                break;
            names.push(name.trim());
        }
        const i = pickTempSensor(names);
        return i === -1 ? null : `/sys/class/hwmon/hwmon${i}/temp1_input`;
    }

    async _poll() {
        if (this._busy)
            return;
        this._busy = true;
        try {
            const [stat, mem] = await Promise.all([readText('/proc/stat'), readText('/proc/meminfo')]);
            if (this._tempPath === undefined)
                this._tempPath = await this._findTempSensor();
            if (this._tempPath) {
                const milli = Number(await readText(this._tempPath));
                this._temp = Number.isFinite(milli) && milli > 0 ? Math.round(milli / 1000) : null;
            }
            if (this._polls % DISK_EVERY === 0)
                this._disk = await diskUsedPercent('/');
            if (this.destroyed)
                return;
            this._polls++;

            const cur = parseProcStat(stat);
            this._cpu.set(cur && this._prev ? cpuPercent(this._prev, cur) : cur ? 0 : null);
            this._prev = cur ?? this._prev;
            this._ram.set(parseMeminfo(mem));
            const temp = this._temp === null ? '—' : `${this._temp}°C`;
            const disk = this._disk === null ? '—' : `${this._disk}%`;
            this._footer.text = `${temp} · SSD ${disk}`;
        } catch (e) {
            console.error('desk-widgets: stats poll failed', e);
        } finally {
            this._busy = false;
        }
    }
});
