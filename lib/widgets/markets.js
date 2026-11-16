import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Widget} from '../widget.js';
import {cachedFetch, readCache} from '../net.js';
import {
    parseSymbol, yahooUrl, parseYahoo, frankfurterUrl, parseFrankfurter,
    formatPrice, formatChange, ageText,
} from '../logic/symbols.js';

const MAX_ROWS = 4;
const REFRESH_SECONDS = 600;
const STALE_OPACITY = 140; // 55%

export const MarketsWidget = GObject.registerClass(
class MarketsWidget extends Widget {
    build() {
        this._values = new Map();   // key -> {price, changePct, fetchedAt, stale}
        this._generation = 0;
        this._rows = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'dw-markets-rows', x_expand: true, y_expand: true,
        });
        this.body.add_child(this._rows);
        this._footer = new St.Label({style_class: 'dw-secondary dw-markets-footer', x_align: Clutter.ActorAlign.END});
        this.body.add_child(this._footer);

        this._monitor = Gio.NetworkMonitor.get_default();
        this.track(this._monitor, 'network-changed', (_m, available) => {
            if (available)
                this.refresh();
        });
        this.track(this.layer.settings, 'changed::market-symbols', () => this.refresh());
        this.every(REFRESH_SECONDS, () => this.refresh());
    }

    get symbols() {
        return this.layer.settings.get_strv('market-symbols')
            .map(parseSymbol).filter(Boolean).slice(0, MAX_ROWS);
    }

    _online() {
        return this._monitor.network_available;
    }

    refresh() {
        this._render();
        this._reload().catch(e => console.error('desk-widgets: markets refresh failed', e));
    }

    // One row's value: {price, changePct, fetchedAt, stale} or null. Never throws.
    async _fetchOne(sym, online) {
        const parse = sym.kind === 'fx'
            ? json => parseFrankfurter(json, sym.quote)
            : parseYahoo;
        const url = sym.kind === 'fx'
            ? frankfurterUrl(sym.base, sym.quote, this.layer.now())
            : yahooUrl(sym.symbol);
        const res = online
            ? await cachedFetch(sym.key, url, json => parse(json) !== null)
            : await readCache(sym.key);
        const value = res ? parse(res.data) : null;
        return value ? {...value, fetchedAt: res.fetchedAt, stale: res.stale} : null;
    }

    async _reload() {
        const generation = ++this._generation;
        const symbols = this.symbols;
        const online = this._online();
        const results = await Promise.allSettled(symbols.map(s => this._fetchOne(s, online)));
        if (this.destroyed || generation !== this._generation)
            return;
        this._values = new Map();
        symbols.forEach((sym, i) => {
            const result = results[i];
            if (result.status === 'fulfilled' && result.value)
                this._values.set(sym.key, result.value);
        });
        this._render();
    }

    _render() {
        this._rows.destroy_all_children();
        const symbols = this.symbols;
        if (symbols.length === 0)
            this._rows.add_child(new St.Label({text: _('Add symbols in Settings'), style_class: 'dw-secondary'}));

        let oldestStale = null;
        for (const sym of symbols) {
            const value = this._values.get(sym.key);
            const row = new St.BoxLayout({style_class: 'dw-markets-row', x_expand: true});
            row.add_child(new St.Label({text: sym.label, style_class: 'dw-markets-name', x_expand: true}));
            row.add_child(new St.Label({
                text: value ? formatPrice(value.price) : '—',
                style_class: 'dw-markets-price',
            }));
            const change = new St.Label({
                text: value ? formatChange(value.changePct) : '',
                style_class: 'dw-markets-change',
            });
            if (value) {
                const text = change.text;
                if (text.startsWith('▲'))
                    change.add_style_class_name('dw-gain');
                else if (text.startsWith('▼'))
                    change.add_style_class_name('dw-loss');
                if (value.stale) {
                    row.opacity = STALE_OPACITY;
                    oldestStale = Math.min(oldestStale ?? value.fetchedAt, value.fetchedAt);
                }
            }
            row.add_child(change);
            this._rows.add_child(row);
        }
        this._footer.text = oldestStale === null
            ? ''
            : _('updated %s').replace('%s', ageText(Date.now() - oldestStale));
    }
});
