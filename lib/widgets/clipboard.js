import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Widget} from '../widget.js';
import {push, oneLine} from '../logic/clipHistory.js';

const SHOWN = 4;
// Password managers set this hint so that history tools skip the copy.
const SECRET_HINT = 'x-kde-passwordManagerHint';

// History lives only in this object: never written to disk, never logged.
export const ClipboardWidget = GObject.registerClass(
class ClipboardWidget extends Widget {
    build() {
        this._items = [];
        this.body.add_child(new St.Label({text: _('Clipboard'), style_class: 'dw-caption'}));
        this._rows = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'dw-clip-rows', x_expand: true, y_expand: true,
        });
        this.body.add_child(this._rows);

        this._clipboard = St.Clipboard.get_default();
        this.track(global.display.get_selection(), 'owner-changed', (_sel, type, source) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._onCopied(source);
        });
        for (const key of ['clipboard-enabled', 'clipboard-clear']) {
            this.track(this.layer.settings, `changed::${key}`, () => {
                this._items = [];
                this.refresh();
            });
        }
    }

    get enabled() {
        return this.layer.settings.get_boolean('clipboard-enabled');
    }

    _onCopied(source) {
        if (!this.enabled || !source)
            return;
        if (source.get_mimetypes().includes(SECRET_HINT))
            return;
        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clip, text) => {
            if (this.destroyed || !this.enabled)
                return;
            const items = push(this._items, text);
            if (items === this._items)
                return;
            this._items = items;
            this.refresh();
        });
    }

    refresh() {
        this._rows.destroy_all_children();
        if (!this.enabled || this._items.length === 0) {
            this._rows.add_child(new St.Label({
                text: this.enabled ? _('Nothing copied yet') : _('Paused'),
                style_class: 'dw-secondary dw-clip-empty',
            }));
            return;
        }
        for (const text of this._items.slice(0, SHOWN)) {
            const label = new St.Label({text: oneLine(text, 80), x_expand: true});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            const row = new St.Button({
                style_class: 'dw-clip-row', child: label,
                x_expand: true, x_align: Clutter.ActorAlign.FILL,
            });
            row.connect('clicked', () => this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text));
            this._rows.add_child(row);
        }
    }
});
