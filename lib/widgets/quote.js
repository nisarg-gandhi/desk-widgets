import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Widget} from '../widget.js';
import {pickDaily, quoteKind} from '../logic/dates.js';
import {readText} from '../store.js';

const COPIED_MS = 1500;

// `code` spans in tips are shown in monospace and copied without backticks.
function toMarkup(text) {
    return GLib.markup_escape_text(text, -1)
        .replace(/`([^`]+)`/g, '<span font_family="monospace">$1</span>');
}

const plain = text => text.replace(/`/g, '');

export const QuoteWidget = GObject.registerClass(
class QuoteWidget extends Widget {
    build() {
        this._lists = {quote: [], tip: []};
        this._current = null;

        this._text = new St.Label({style_class: 'dw-quote-text', x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.START});
        const ct = this._text.clutter_text;
        ct.line_wrap = true;
        ct.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        ct.ellipsize = Pango.EllipsizeMode.END;
        this.body.add_child(this._text);

        const footerRow = new St.BoxLayout({x_expand: true});
        this._footer = new St.Label({
            style_class: 'dw-secondary dw-quote-footer',
            x_expand: true, y_align: Clutter.ActorAlign.END,
        });
        footerRow.add_child(this._footer);
        // Flip between today's dev tip and today's quote; the choice sticks.
        this._swap = new St.Button({style_class: 'dw-quote-swap', y_align: Clutter.ActorAlign.END});
        this._swap.connect('clicked', () => this._swapKind());
        footerRow.add_child(this._swap);
        this.body.add_child(footerRow);

        this.track(this.layer.settings, 'changed::quote-mode', () => this.refresh());
        this._load();
    }

    async _load() {
        const dir = this.layer.extension.path;
        const read = async name => {
            try {
                const list = JSON.parse(await readText(`${dir}/data/${name}`));
                return Array.isArray(list) ? list.filter(i => typeof i?.text === 'string') : [];
            } catch {
                return [];
            }
        };
        const [quote, tip] = await Promise.all([read('quotes.json'), read('tips.json')]);
        if (this.destroyed)
            return;
        this._lists = {quote, tip};
        this.refresh();
    }

    refresh() {
        const now = this.layer.now();
        let kind = quoteKind(this.layer.settings.get_string('quote-mode'), now);
        if (this._lists[kind].length === 0)
            kind = kind === 'quote' ? 'tip' : 'quote';
        const item = pickDaily(this._lists[kind], now);
        this._current = item ? {kind, ...item} : null;
        this._render();
    }

    _swapKind() {
        if (!this._current)
            return;
        this.layer.settings.set_string('quote-mode', this._current.kind === 'tip' ? 'quotes' : 'tips');
    }

    _footerText() {
        if (!this._current)
            return '';
        return this._current.kind === 'tip' ? _('DEV TIP') : `— ${this._current.author ?? ''}`;
    }

    _render() {
        const item = this._current;
        const length = item ? item.text.length : 0;
        const size = length <= 70 ? 'l' : length <= 110 ? 'm' : 's';
        for (const s of ['l', 'm', 's'])
            this._text.remove_style_class_name(`dw-quote-${s}`);
        this._text.add_style_class_name(`dw-quote-${size}`);
        this._text.clutter_text.set_markup(item ? toMarkup(item.kind === 'quote' ? `“${item.text}”` : item.text) : '');
        this._footer.text = this._footerText();
        const other = item?.kind === 'tip' ? 'quote' : 'tip';
        this._swap.visible = !!item && this._lists[other].length > 0;
        this._swap.label = other === 'quote' ? _('Show quote') : _('Show tip');
        if (item?.kind === 'tip')
            this._footer.add_style_class_name('dw-caption');
        else
            this._footer.remove_style_class_name('dw-caption');
    }

    get copyText() {
        const item = this._current;
        if (!item)
            return '';
        return item.kind === 'quote' ? `${item.text} — ${item.author}` : plain(item.text);
    }

    onClick() {
        if (!this._current)
            return;
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this.copyText);
        this._footer.text = _('Copied');
        this.cancel(this._copiedTimer);
        this._copiedTimer = this.after(COPIED_MS, () => {
            this._footer.text = this._footerText();
        });
    }
});
