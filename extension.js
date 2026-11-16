import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {WidgetLayer} from './lib/layer.js';
import {abortAll} from './lib/net.js';
import {CalendarWidget} from './lib/widgets/calendar.js';
import {ClipboardWidget} from './lib/widgets/clipboard.js';
import {HabitsWidget} from './lib/widgets/habits.js';
import {MarketsWidget} from './lib/widgets/markets.js';
import {NotesWidget} from './lib/widgets/notes.js';
import {QuoteWidget} from './lib/widgets/quote.js';
import {StatsWidget} from './lib/widgets/stats.js';

const WIDGETS = {
    calendar: CalendarWidget, stats: StatsWidget, quote: QuoteWidget,
    markets: MarketsWidget, habits: HabitsWidget, notes: NotesWidget, clipboard: ClipboardWidget,
};

export default class DeskWidgets extends Extension {
    enable() {
        try {
            this.layer = new WidgetLayer(this);
            for (const [id, cls] of Object.entries(WIDGETS))
                this.layer.register(id, cls);
            this.layer.enable();
        } catch (e) {
            this.disable();
            throw e;
        }

        const scenario = GLib.getenv('DW_SELFTEST');
        if (scenario)
            import('./lib/selftest.js').then(m => m.run(scenario, this)).catch(e => console.error(e));
    }

    disable() {
        this.layer?.disable();
        this.layer = null;
        abortAll();
    }
}
