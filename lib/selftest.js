// Scripted checks, only loaded when DW_SELFTEST is set (see tests/shell/run.sh).
// `make install` leaves this file out; only the test harness installs it.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const OUT = GLib.getenv('DW_SELFTEST_OUT') ?? GLib.get_tmp_dir();

export const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => (r(), GLib.SOURCE_REMOVE)));
const now = () => GLib.get_monotonic_time();

let _ptr, _kbd;
function devices() {
    const seat = Clutter.get_default_backend().get_default_seat();
    _ptr ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    _kbd ??= seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
}

export async function moveTo(x, y) {
    devices();
    _ptr.notify_absolute_motion(now(), x, y);
    await sleep(80);
}

export async function button(pressed, btn = Clutter.BUTTON_PRIMARY) {
    devices();
    _ptr.notify_button(now(), btn, pressed ? Clutter.ButtonState.PRESSED : Clutter.ButtonState.RELEASED);
    await sleep(80);
}

export async function click(x, y, btn = Clutter.BUTTON_PRIMARY) {
    await moveTo(x, y);
    await button(true, btn);
    await button(false, btn);
}

export async function drag(x1, y1, x2, y2) {
    await moveTo(x1, y1);
    await button(true);
    for (let i = 1; i <= 6; i++)
        await moveTo(x1 + (x2 - x1) * i / 6, y1 + (y2 - y1) * i / 6);
    await button(false);
}

export async function type(text) {
    devices();
    for (const ch of text) {
        const kv = Clutter.unicode_to_keysym(ch.codePointAt(0));
        _kbd.notify_keyval(now(), kv, Clutter.KeyState.PRESSED);
        _kbd.notify_keyval(now(), kv, Clutter.KeyState.RELEASED);
        await sleep(40);
    }
}

export function center(actor) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [Math.round(x + w / 2), Math.round(y + h / 2)];
}

export async function screenshot(name) {
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await new Promise((resolve, reject) => shooter.screenshot(false, stream, (o, res) => {
        try { o.screenshot_finish(res); resolve(); } catch (e) { reject(e); }
    }));
    stream.close(null);
}

export function windows() {
    return global.get_window_actors().map(a => ({
        title: a.meta_window.get_title(),
        type: a.meta_window.get_window_type(),
        desktop: a.meta_window.get_window_type() === Meta.WindowType.DESKTOP,
    }));
}

function finish(result) {
    GLib.file_set_contents(`${OUT}/result.json`, JSON.stringify(result, null, 2));
    global.context.terminate();
}

function rect(actor) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [x, y, w, h].map(Math.round);
}

function savedPositions(layer) {
    return layer.settings.get_value('positions').deepUnpack();
}

async function launch(argv) {
    const before = new Set(global.display.list_all_windows());
    Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    for (let i = 0; i < 50; i++) {
        await sleep(200);
        const win = global.display.list_all_windows().find(w =>
            !before.has(w) && w.get_window_type() === Meta.WindowType.NORMAL);
        if (win) { await sleep(2500); return win; }
    }
    return null;
}

function clipboardText() {
    return new Promise(resolve => St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_c, text) => resolve(text)));
}

function readFile(path) {
    try { return new TextDecoder().decode(GLib.file_get_contents(path)[1]); } catch { return null; }
}

async function key(keyval) {
    devices();
    _kbd.notify_keyval(now(), keyval, Clutter.KeyState.PRESSED);
    _kbd.notify_keyval(now(), keyval, Clutter.KeyState.RELEASED);
    await sleep(60);
}

// Every visible element of every card must have a real size and lie inside
// its card. Catches rows that exist but are drawn with zero or bogus geometry.
function badGeometry(layer) {
    const bad = [];
    for (const [id, card] of layer.widgets) {
        const [cx, cy, cw, ch] = rect(card);
        const walk = actor => {
            for (const child of actor.get_children()) {
                if (!child.visible || child.constructor.name === 'St_ScrollBar')
                    continue;
                const [x, y, w, h] = rect(child);
                const label = child.text ?? child.label ?? child.style_class ?? child.constructor.name;
                if (w <= 0 || h <= 0 || x < cx - 1 || y < cy - 1 || x + w > cx + cw + 1 || y + h > cy + ch + 1)
                    bad.push(`${id}: "${String(label).slice(0, 24)}" at ${x},${y} ${w}x${h}`);
                else
                    walk(child);
            }
        };
        walk(card);
    }
    return bad;
}

const scenarios = {
    // Which way of focusing the note card leaves the next click stuck on it?
    async clickafterfocus(ext) {
        const r = {};
        const L = ext.layer;
        const w = L.widgets.get('notes');
        const q = L.widgets.get('quote');
        let swaps = 0;
        const orig = q._swapKind.bind(q);
        q._swapKind = () => { swaps++; orig(); };
        const tryClick = async label => {
            const before = swaps;
            await click(...center(q._swap));
            await sleep(300);
            r[label] = swaps - before;
            global.stage.set_key_focus(null);
            await sleep(200);
        };
        await tryClick('baseline');
        w.onClick(); await sleep(200);                       // focus in code
        await tryClick('afterCodeFocus');
        const [nx, ny] = center(w);
        await click(nx, ny + 40); await sleep(200);          // focus by clicking empty area
        await tryClick('afterClickFocus');
        await click(nx, ny + 40); await sleep(200);
        await type('abc');
        await tryClick('afterClickFocusAndType');
        const ct = w._entry.clutter_text;                    // focus by clicking on the text itself
        await click(...center(ct)); await sleep(200);
        await tryClick('afterTextClick');

        await click(nx, ny + 40); await sleep(200);
        devices();
        _kbd.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        await key(Clutter.KEY_End);
        _kbd.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        await sleep(200);
        await tryClick('afterCtrlEnd');

        await click(nx, ny + 40); await sleep(200);
        for (let i = 1; i <= 8; i++) { await key(Clutter.KEY_Return); await type(`l${i}`); }
        await sleep(400);
        r.scrolledBy = Math.round(w._scroll.vadjustment.value);
        await tryClick('afterScrollTyping');

        let opens = 0;
        L.openNotesApp = () => { opens++; };
        const openBtn = w._openButton;
        const tryOpen = async label => {
            const before = opens;
            await click(...center(openBtn));
            await sleep(300);
            r[label] = opens - before;
            global.stage.set_key_focus(null);
            await sleep(200);
        };
        await tryOpen('openUnfocused');
        w.onClick(); await sleep(200);
        await tryOpen('openAfterCodeFocus');
        await click(nx, ny + 40); await sleep(200);
        await tryOpen('openAfterClickFocus');
        await click(nx, ny + 40); await sleep(200);
        await type('x');
        await tryOpen('openAfterClickFocusType');
        r.openRect = rect(openBtn);
        r.card = rect(w);
        await screenshot('notes-card-final');
        return r;
    },

    // Notes card + Notes app. Run with DW_SETUP writing an old notes.md.
    async notesapp(ext) {
        const r = {};
        const L = ext.layer;
        const base = GLib.build_filenamev([GLib.get_user_data_dir(), 'desk-widgets']);
        const dirFiles = () => { try { const out = []; const en = Gio.File.new_for_path(`${base}/notes`).enumerate_children('standard::name', 0, null); let i; while ((i = en.next_file(null))) out.push(i.get_name()); return out.sort(); } catch { return null; } };
        let w = L.widgets.get('notes');
        await sleep(800);

        // migration of the old single note
        r.files = dirFiles();
        r.pinned = L.settings.get_string('pinned-note');
        r.oldGone = readFile(`${base}/notes.md`) === null;
        r.bakKept = readFile(`${base}/notes.md.bak`)?.startsWith('Todo') ?? false;
        r.cardText = w._entry.get_text().split('\n')[0];

        // typing past the bottom of the card keeps the cursor in view
        const [nx, ny] = center(w);
        await click(nx, ny + 40);
        await key(Clutter.KEY_End);
        devices();
        _kbd.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        await key(Clutter.KEY_End);
        _kbd.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
        for (let i = 1; i <= 8; i++) {
            await key(Clutter.KEY_Return);
            await type(`line ${i}`);
        }
        await sleep(300);
        const ct = w._entry.clutter_text;
        const [, , cy, lh] = ct.position_to_coords(ct.cursor_position);
        const caretTop = ct.get_transformed_position()[1] + cy;
        const [, sy, , sh] = rect(w._scroll);
        r.caretVisible = caretTop >= sy - 1 && caretTop + lh <= sy + sh + 1;
        r.scrolled = Math.round(w._scroll.vadjustment.value);
        await screenshot('notes-card-typing');
        await sleep(1300);
        r.savedToPinned = readFile(`${base}/notes/${r.pinned}.md`)?.endsWith('line 8') ?? false;
        r.focusedBeforeOpen = global.stage.get_key_focus() === ct;

        // the app opens from the card's Open button, on the pinned note
        const before = new Set(global.display.list_all_windows());
        const openBtn = w._openButton;
        let opened = 0;
        const origOpen = L.openNotesApp.bind(L);
        L.openNotesApp = args => { opened++; r.openArgs = args; origOpen(args); };
        await click(...center(openBtn));
        await sleep(300);
        r.openCalls = opened;

        let win = null;
        for (let i = 0; i < 100 && !win; i++) {
            await sleep(250);
            win = global.display.list_all_windows().find(x => !before.has(x) && x.get_window_type() !== Meta.WindowType.DESKTOP);
        }
        r.appOpened = win?.get_title() ?? null;
        if (!win)
            return r;
        await sleep(2500);
        await screenshot('notes-app');

        // a new note typed in the app is saved as its own file
        L.openNotesApp(['--new']);
        await sleep(1500);
        await type('Shopping');
        await key(Clutter.KEY_Return);
        await type('milk and eggs');
        await sleep(1500);
        r.filesAfterNew = dirFiles();
        const newId = r.filesAfterNew.map(f => f.slice(0, -3)).find(id => id !== r.pinned);
        r.newNoteText = newId ? readFile(`${base}/notes/${newId}.md`) : null;
        r.pinnedTextAfterNew = readFile(`${base}/notes/${r.pinned}.md`);
        await screenshot('notes-app-new');

        // pinning the new note switches the card; app edits reach the card
        L.settings.set_string('pinned-note', newId);
        await sleep(800);
        w = L.widgets.get('notes');
        r.cardAfterPin = w._entry.get_text();
        await type(', bread');
        await sleep(1800);
        r.cardAfterAppEdit = w._entry.get_text();

        // an edit on the card reaches the app's file, and the app keeps it
        await click(...center(w));
        await type('!');
        await key(Clutter.KEY_Escape);
        await sleep(1800);
        r.fileAfterCardEdit = readFile(`${base}/notes/${newId}.md`);
        await screenshot('notes-sync');
        return r;
    },

    // Everything that should be on screen really is, with every card filled.
    // Run with DW_SETUP='python3 tests/shell/seed.py'.
    async visible(ext) {
        const r = {};
        const L = ext.layer;
        for (const text of ['first copy', 'second copy', 'a third, rather longer copy that will need to be cut off at the edge of the card']) {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
            await sleep(350);
        }
        const n = L.widgets.get('notes');
        await click(...center(n));
        await type('note line');
        await key(Clutter.KEY_Escape);
        await sleep(6000);          // markets rows
        r.clipRows = L.widgets.get('clipboard')._rows.get_children().map(c => rect(c).join(','));
        r.bad = badGeometry(L);
        await screenshot('visible-dark');
        L.settings.set_string('calendar-size', 'medium');
        L.settings.set_strv('habit-names', ['Read']);
        L.settings.set_boolean('clipboard-enabled', false);
        await sleep(500);
        r.badAlt = badGeometry(L);
        return r;
    },

    // Habit Tracker app + the widget's row menu + the quote swap button.
    // Run with DW_SETUP='python3 tests/shell/seed.py'.
    async habitapp(ext) {
        const r = {};
        const L = ext.layer;
        const w = L.widgets.get('habits');
        const path = GLib.build_filenamev([GLib.get_user_data_dir(), 'desk-widgets', 'habits.json']);
        const today = new Date();
        const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const ticked = name => (JSON.parse(readFile(path))[name] ?? []).includes(iso);
        const rowNames = () => w._nameButtons.map(b => b.label);

        const dbg = () => ({n: w._rows.get_n_children(), rowsBox: rect(w._rows), kids: w._rows.get_children().map(c => `${c.constructor.name}:${rect(c).join(',')}:${c.visible}:${c.get_n_children()}`), first: w._nameButtons[0] ? rect(w._nameButtons[0]) : null});
        // quote card swap button
        const q = L.widgets.get('quote');
        r.swapLabelBefore = q._swap.label;
        const kindBefore = q._current.kind;
        await click(...center(q._swap));
        await sleep(400);
        r.swapFlipped = q._current.kind !== kindBefore;
        r.swapMode = L.settings.get_string('quote-mode');
        r.swapLabelAfter = q._swap.label;
        await click(...center(q._swap));
        await sleep(400);
        r.swapBack = q._current.kind === kindBefore;

        // widget: three rows, name menu lists all habits, picking swaps rows
        r.rows = rowNames();
        r.footer = w._footer.text;
        await click(...center(w._nameButtons[0]));
        await sleep(400);
        const menu = w._rowMenus[0];
        r.menuOpen = menu.isOpen;
        r.menuItems = menu._getMenuItems().map(i => i.label?.text ?? '---');
        await screenshot('habit-menu');
        menu._getMenuItems().find(i => i.label?.text === 'Meditate').activate(Clutter.get_current_event());
        await sleep(400);
        r.rowsAfterPick = rowNames();
        w._rowMenus[1]._getMenuItems().find(i => i.label?.text === 'Code').activate(Clutter.get_current_event());
        await sleep(400);
        r.rowsAfterSwap = rowNames();
        L.settings.set_strv('habit-names', ['Read', 'Workout', 'Code']);
        await sleep(300);

        // the app
        const before = new Set(global.display.list_all_windows());
        L.openHabitApp(['--page=today']);
        let win = null;
        for (let i = 0; i < 100 && !win; i++) {
            await sleep(250);
            win = global.display.list_all_windows().find(x => !before.has(x) && x.get_window_type() !== Meta.WindowType.DESKTOP);
        }
        r.appOpened = !!win;
        if (!win)
            return r;
        await sleep(2500);
        r.appTitle = win.get_title();
        const f = win.get_frame_rect();
        r.frame = [f.x, f.y, f.width, f.height];
        await screenshot('app-today');
        const steps = (GLib.getenv('DW_APP_STEPS') ?? '').split(';').filter(Boolean);
        for (const step of steps) {
            const parts = step.split(',');
            if (parts[0] === 'page') { L.openHabitApp([`--page=${parts[1]}`]); await sleep(1500); }
            else if (parts[0] === 'new') { L.openHabitApp(['--new']); await sleep(1500); }
            else if (parts[0] === 't') { await type(parts[1]); await key(Clutter.KEY_Return); }
            else if (parts[0] === 'shot') await screenshot(parts[1]);
            else if (parts[0] === 'note') r[parts[1]] = {readToday: ticked('Read'), walkToday: ticked('Walk'), keys: Object.keys(JSON.parse(readFile(path))), rows: rowNames(), dots: Object.fromEntries(Object.entries(w._todayButtons).map(([n, b]) => [n, b.has_style_class_name('dw-dot-done')]))};
            else if (parts[0] === 'tickwidget') { await click(...center(w._todayButtons[parts[1]])); }
            else await click(f.x + Number(parts[0]), f.y + Number(parts[1]));
            await sleep(900);
        }
        r.windows = global.display.list_all_windows().filter(x => x.get_window_type() !== Meta.WindowType.DESKTOP).length;
        return r;
    },

    // Final review C1, I2, I3: interrupted drags, throwing callbacks, failed enable.
    async faults(ext) {
        const r = {};
        let L = ext.layer;
        const cal = () => ext.layer.widgets.get('calendar');
        const home = rect(cal());

        // C1a: a modal takes over mid-drag and swallows the release
        let [cx, cy] = center(cal());
        await moveTo(cx, cy);
        await button(true);
        await moveTo(cx - 60, cy + 30);
        const dummy = new St.Widget({reactive: true});
        Main.uiGroup.add_child(dummy);
        const grab = Main.pushModal(dummy);
        await button(false);
        Main.popModal(grab);
        dummy.destroy();
        await moveTo(cx - 300, cy + 200);
        await moveTo(cx - 320, cy + 220);
        await sleep(200);
        r.c1a_followsPointer = JSON.stringify(rect(cal())) !== JSON.stringify(home);
        r.c1a_dragCleared = cal()._drag === null && !cal()._grab;
        // a normal click afterwards must not leave a grab behind either
        await click(...center(cal()));
        r.c1a_grabAfterClick = !!cal()._grab;

        // C1b: the overview opens mid-drag
        [cx, cy] = center(cal());
        await moveTo(cx, cy);
        await button(true);
        await moveTo(cx - 60, cy + 30);
        Main.overview.show();
        await sleep(1200);
        r.c1b_dragCleared = cal()._drag === null && !cal()._grab;
        await button(false);
        Main.overview.hide();
        await sleep(1200);
        r.c1b_home = JSON.stringify(rect(cal())) === JSON.stringify(home);

        // I2: one widget throwing must not stop the others or the timers
        let refreshed = 0;
        for (const [id, w] of L.widgets) {
            if (id === 'quote') w.refresh = () => { throw new Error('boom'); };
            else { const orig = w.refresh.bind(w); w.refresh = () => { refreshed++; orig(); }; }
        }
        try { r.i2_checkDay = L.checkDay(new Date(Date.now() + 86400000)); } catch (e) { r.i2_checkDayThrew = e.message; }
        r.i2_othersRefreshed = refreshed;
        let ticks = 0;
        cal().every(1, () => { ticks++; throw new Error('tick boom'); });
        await sleep(3400);
        r.i2_ticksAfterThrow = ticks;

        // I3: enable() that fails half way cleans up after itself
        const {WidgetLayer} = await import('./layer.js');
        ext.disable();
        const orig = WidgetLayer.prototype._queueCoverCheck;
        WidgetLayer.prototype._queueCoverCheck = function () { throw new Error('enable boom'); };
        try { ext.enable(); r.i3_enableThrew = false; } catch (e) { r.i3_enableThrew = e.message; }
        WidgetLayer.prototype._queueCoverCheck = orig;
        r.i3_layersLeft = global.window_group.get_children().filter(c => c.has_style_class_name?.('dw-layer')).length;
        r.i3_menusLeft = Main.uiGroup.get_children().filter(c => c._delegate?.sourceActor?.has_style_class_name?.('dw-card')).length;
        r.i3_layerNull = ext.layer === null || ext.layer === undefined;
        ext.enable();
        await sleep(500);
        r.i3_reenabled = ext.layer.widgets.size;

        // I3b: a widget whose constructor throws is skipped, the rest load
        ext.disable();
        const BadCtor = class { static sizeFor() { return 'small'; } constructor() { throw new Error('ctor boom'); } };
        const origEnable = WidgetLayer.prototype.enable;
        WidgetLayer.prototype.enable = function () { this.register('bad', BadCtor); return origEnable.call(this); };
        try { ext.enable(); r.i3b_threw = false; } catch (e) { r.i3b_threw = e.message; }
        WidgetLayer.prototype.enable = origEnable;
        r.i3b_widgets = ext.layer ? ext.layer.widgets.size : -1;
        r.i3b_hasBad = ext.layer?.widgets.has('bad');
        return r;
    },

    // Task 11: HiDPI. Run with DW_MONITOR=3072x1920; forces scale factor 2.
    async scale(ext) {
        const r = {};
        const L = ext.layer;
        const rects = () => Object.fromEntries([...L.widgets].map(([id, w]) => [id, rect(w)]));
        r.scale1 = {scale: L.scale, area: L.area, calendar: rects().calendar, quote: rects().quote};
        St.ThemeContext.get_for_stage(global.stage).scale_factor = 2;
        await sleep(1500);
        r.scale2 = {scale: L.scale, area: L.area, calendar: rects().calendar, quote: rects().quote};
        const [cx, cy] = center(L.widgets.get('calendar'));
        await drag(cx, cy, cx - 352, cy + 10);          // one logical cell left = 352 stage px
        r.dragCell = L._cells.calendar;
        r.dragRect = rect(L.widgets.get('calendar'));
        L.settings.reset('positions');
        await sleep(6000);
        await screenshot('scale2');
        return r;
    },

    // Task 11: repeated disable/enable leaves exactly one layer and seven cards.
    async leak(ext) {
        const r = {};
        for (let i = 0; i < 10; i++) {
            ext.disable();
            await sleep(120);
            ext.enable();
            await sleep(250);
        }
        await sleep(1500);
        const layers = global.window_group.get_children().filter(c => c.has_style_class_name?.('dw-layer'));
        r.layers = layers.length;
        r.cards = layers[0]?.get_children().length;
        r.menus = Main.uiGroup.get_children().filter(c => c._delegate?.sourceActor?.has_style_class_name?.('dw-card')).length;
        const stats = ext.layer.widgets.get('stats');
        const p0 = stats._polls;
        await sleep(9500);
        r.pollsIn9s = stats._polls - p0;
        return r;
    },

    // Task 10: the settings window opens, and its controls drive the desktop.
    async prefs(ext) {
        const r = {};
        const L = ext.layer;
        L.settings.set_value('positions', new GLib.Variant('a{s(ii)}', {calendar: [5, 3]}));
        const before = new Set(global.display.list_all_windows());
        L.widgets.get('stats')._menu._getMenuItems()[1].activate(Clutter.get_current_event());
        let win = null;
        for (let i = 0; i < 100 && !win; i++) {
            await sleep(250);
            win = global.display.list_all_windows().find(w => !before.has(w) && w.get_window_type() !== Meta.WindowType.DESKTOP);
        }
        r.allWindows = global.display.list_all_windows().map(w => `${w.get_title()}|${w.get_window_type()}`);
        r.opened = !!win;
        if (!win)
            return r;
        await sleep(2500);
        r.title = win.get_title();
        const f = win.get_frame_rect();
        r.frame = [f.x, f.y, f.width, f.height];
        await screenshot('prefs');
        const steps = (GLib.getenv('DW_PREFS_CLICKS') ?? '').split(';').filter(Boolean);
        for (const step of steps) {
            const parts = step.split(',');
            if (parts[0] === 's') {            // s,x,y,notches : scroll down
                await moveTo(f.x + Number(parts[1]), f.y + Number(parts[2]));
                for (let i = 0; i < Number(parts[3]); i++) {
                    _ptr.notify_discrete_scroll(now(), Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL);
                    await sleep(60);
                }
            } else if (parts[0] === 't') {     // t,text : type, then Enter
                await type(parts[1]);
                await key(Clutter.KEY_Return);
            } else if (parts[0] === 'shot') {
                await screenshot(parts[1]);
            } else {
                await click(f.x + Number(parts[0]), f.y + Number(parts[1]));
            }
            await sleep(700);
        }
        if (steps.length)
            await screenshot('prefs-after');
        r.hidden = L.settings.get_strv('hidden');
        r.positions = L.settings.get_value('positions').deepUnpack();
        r.calendarSize = L.settings.get_string('calendar-size');
        r.clipboardEnabled = L.settings.get_boolean('clipboard-enabled');
        r.clear = L.settings.get_int('clipboard-clear');
        r.quoteMode = L.settings.get_string('quote-mode');
        r.symbols = L.settings.get_strv('market-symbols');
        r.habits = L.settings.get_strv('habit-names');
        r.widgets = [...L.widgets.keys()];
        return r;
    },

    // Task 9: live rows, unknown symbol, offline -> cached and faded.
    async markets(ext) {
        const r = {};
        const L = ext.layer;
        const w = L.widgets.get('markets');
        const rows = () => w._rows.get_children().map(row => {
            const [name, price, change] = row.get_children();
            return `${name.text}|${price.text}|${change.text}|${row.opacity}`;
        });
        const settle = async () => { for (let i = 0; i < 40 && rows().some(x => x.includes('|—|')); i++) await sleep(300); await sleep(300); };
        await settle();
        r.live = rows();
        r.footerLive = w._footer.text;
        await screenshot('markets-live');
        L.settings.set_strv('market-symbols', ['^NSEI', 'NOPE123ZZ', '', 'usd/inr', 'AAPL', 'MSFT']);
        await sleep(6000);
        r.withUnknown = rows();
        const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'desk-widgets']);
        r.cacheFiles = [];
        const en = Gio.File.new_for_path(cacheDir).enumerate_children('standard::name', 0, null);
        let info; while ((info = en.next_file(null))) r.cacheFiles.push(info.get_name());
        r.cacheFiles.sort();
        // offline: values come from the cache, faded, with an age line
        w._online = () => false;
        w.refresh();
        await sleep(1500);
        r.offline = rows();
        r.footerOffline = w._footer.text;
        await screenshot('markets-offline');
        // online again but the server answers with an error: cache is used
        const net = await import('./net.js');
        r.badUrlNoCache = await net.cachedFetch('T_none', 'https://api.frankfurter.dev/v1/definitely-not-a-route');
        const good = await net.cachedFetch('T_x', 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR');
        const bad = await net.cachedFetch('T_x', 'https://api.frankfurter.dev/v1/definitely-not-a-route');
        r.fallback = {goodStale: good?.stale, badStale: bad?.stale, sameData: JSON.stringify(good?.data) === JSON.stringify(bad?.data)};
        const rejected = await net.cachedFetch('T_x', 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR', () => false);
        r.invalidKeepsCache = rejected?.stale === true;
        return r;
    },

    // Task 8: clipboard history, re-copy on click, pause, nothing on disk.
    async clipboard(ext) {
        const r = {};
        const L = ext.layer;
        const w = L.widgets.get('clipboard');
        const rows = () => w._rows.get_children().map(c => c.child ? c.child.text : `(${c.text})`);
        const copy = async text => { St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text); await sleep(350); };
        r.empty = rows();
        await copy('alpha-SECRETMARK');
        await copy('beta');
        await copy('gamma  two\n\tlines');
        await copy('   ');
        r.afterThree = rows();
        await copy('z'.repeat(3_000_000));
        r.hugeStored = w._items[0].length;
        r.hugeRow = rows()[0].length;
        await copy('five');
        r.shownMax = rows().length;
        r.stored = w._items.length;
        await screenshot('clipboard');
        const last = w._rows.get_children()[3];
        r.clickedRow = last.child.text;
        await click(...center(last));
        await sleep(400);
        r.clipboardAfterClick = (await clipboardText()).slice(0, 30);
        r.topAfterClick = rows()[0];
        L.settings.set_boolean('clipboard-enabled', false);
        await sleep(200);
        r.paused = rows();
        await copy('while paused');
        r.pausedItems = w._items.length;
        L.settings.set_boolean('clipboard-enabled', true);
        await sleep(200);
        r.resumed = rows();
        await copy('alpha-SECRETMARK');
        return r;
    },

    // Task 7: quote/tip of the day, copy on click; notes autosave and reload.
    async quotenotes(ext) {
        const r = {};
        let L = ext.layer;
        const q = L.widgets.get('quote');
        const data = name => JSON.parse(readFile(`${ext.path}/data/${name}`));
        const tips = data('tips.json'), quotes = data('quotes.json');
        L._fakeNow = new Date(2026, 10, 16, 9).getTime();   // day 20773, odd -> tip
        q.refresh();
        r.tipShown = q._current?.text === tips[20773 % tips.length].text;
        r.tipFooter = q._footer.text;
        r.tipText = q._text.text;
        L.settings.set_string('quote-mode', 'quotes');
        await sleep(200);
        r.quoteShown = q._current?.text === quotes[20773 % quotes.length].text;
        r.quoteFooter = q._footer.text;
        await click(...center(q));
        await sleep(300);
        r.copiedLabel = q._footer.text;
        r.clipboard = await clipboardText();
        r.clipboardOk = r.clipboard === q.copyText;
        await sleep(1700);
        r.footerRestored = q._footer.text === r.quoteFooter;
        L.settings.set_string('quote-mode', 'tips');
        await sleep(200);
        await screenshot('quote-tip');

        const n = L.widgets.get('notes');
        const notePathNow = () => GLib.build_filenamev([GLib.get_user_data_dir(), 'desk-widgets', 'notes', `${L.settings.get_string('pinned-note')}.md`]);
        r.notesFileAtStart = L.settings.get_string('pinned-note') || null;
        const [nx, ny] = center(n);
        await click(nx, ny + 40);                 // empty part of the card
        r.focusAfterClick = global.stage.get_key_focus() === n._entry.clutter_text;
        await type('buy milk');
        await key(Clutter.KEY_Return);
        await type('call lab');
        r.entryText = n._entry.get_text();
        r.fileBeforeDelay = (L.settings.get_string('pinned-note') ? readFile(notePathNow()) : null);
        await sleep(1600);
        r.fileAfterDelay = (L.settings.get_string('pinned-note') ? readFile(notePathNow()) : null);
        await type('!');
        await key(Clutter.KEY_Escape);
        await sleep(400);
        r.focusAfterEscape = global.stage.get_key_focus() !== n._entry.clutter_text;
        r.fileAfterEscape = (L.settings.get_string('pinned-note') ? readFile(notePathNow()) : null);
        await screenshot('notes');
        ext.disable();
        await sleep(300);
        ext.enable();
        await sleep(800);
        r.restored = ext.layer.widgets.get('notes')._entry.get_text();
        return r;
    },

    // Task 6: a corrupt habits file is tolerated and only replaced on a tick.
    async habits(ext) {
        const r = {};
        const L = ext.layer;
        const w = L.widgets.get('habits');
        const path = GLib.build_filenamev([GLib.get_user_data_dir(), 'desk-widgets', 'habits.json']);
        const file = () => { try { return new TextDecoder().decode(GLib.file_get_contents(path)[1]); } catch { return null; } };
        const dots = name => w._rows.get_children().find(row => row.get_first_child().label === name)
            ?.get_children().slice(1).map(d => d.has_style_class_name('dw-dot-done') ? 1 : 0).join('');
        r.fileAtStart = file();
        r.loaded = w._loaded;
        r.rows = w._rows.get_children().map(row => row.get_first_child().label);
        r.dotsAtStart = dots('Read');
        r.footerAtStart = w._footer.text;
        r.btn = rect(w._todayButtons.Read);
        await click(...center(w._todayButtons.Read));
        await sleep(500);
        r.dotsAfterTick = dots('Read');
        r.fileAfterTick = file();
        r.backup = readFile(`${path}.bak`);
        r.footerAfterTick = w._footer.text;
        await screenshot('habits');
        await click(...center(w._todayButtons.Read));
        await sleep(500);
        r.dotsAfterUntick = dots('Read');
        r.fileAfterUntick = file();
        L.settings.set_strv('habit-names', ['Read', 'Meditate', '', 'Code', 'Walk', 'Extra']);
        await sleep(300);
        r.rowsAfterRename = w._rows.get_children().map(row => row.get_first_child().label);
        return r;
    },

    // Task 5: stats show real numbers, and polling pauses while covered.
    async stats(ext) {
        const r = {};
        const w = ext.layer.widgets.get('stats');
        await sleep(7500);
        r.cpu = w._cpu.text; r.ram = w._ram.text; r.footer = w._footer.text;
        r.pollsWhileVisible = w._polls;
        await screenshot('stats');
        const win = await launch(['gnome-calculator']);
        win.maximize();
        await sleep(1500);
        r.covered = ext.layer.covered;
        r.timerWhileCovered = w._timer;
        const p0 = w._polls;
        await sleep(7000);
        r.pollsWhileCovered = w._polls - p0;
        win.unmaximize();
        await sleep(4500);
        r.pollsAfterUncover = w._polls - p0;
        r.timerAfter = w._timer !== 0;
        win.delete(global.get_current_time());
        await sleep(500);
        return r;
    },

    // Screenshots of the current build in dark, light and calendar-medium.
    async look(ext) {
        const L = ext.layer;
        await sleep(Number(GLib.getenv('DW_LOOK_WAIT') ?? 1500));
        await screenshot('look-dark');
        L._iface.set_string('color-scheme', 'default');
        L.settings.set_string('calendar-size', 'medium');
        await sleep(800);
        await screenshot('look-light');
        return {widgets: [...L.widgets.keys()], sizes: [...L.widgets.values()].map(w => w.sizeName)};
    },

    // Task 3: layout, drag/snap, bounce, click, menu, light mode, day change,
    // stacking under real windows, covered detection, clean disable.
    async layout(ext) {
        const r = {};
        const L = ext.layer;
        const W = id => L.widgets.get(id);
        r.area = L.area;
        r.rects = Object.fromEntries([...L.widgets].map(([id, w]) => [id, rect(w)]));
        await screenshot('layout-dark');

        // drag calendar one cell left -> snaps to [4,0] and is saved
        let [cx, cy] = center(W('calendar'));
        await drag(cx, cy, cx - 170, cy + 20);
        r.dragCell = L._cells.calendar;
        r.dragSaved = savedPositions(L).calendar;
        r.dragRect = rect(W('calendar'));

        // drop on top of stats -> bounces back
        [cx, cy] = center(W('calendar'));
        const [sx, sy] = center(W('stats'));
        await drag(cx, cy, sx, sy);
        r.bounceCell = L._cells.calendar;

        // plain click reaches onClick, and does not move the card
        let clicks = 0;
        W('quote').onClick = () => clicks++;
        const before = rect(W('quote'));
        await click(...center(W('quote')));
        r.clicks = clicks;
        r.clickMoved = JSON.stringify(before) !== JSON.stringify(rect(W('quote')));

        // right-click menu -> Hide
        await click(...center(W('stats')), Clutter.BUTTON_SECONDARY);
        r.menuOpen = W('stats')._menu.isOpen;
        r.menuItems = W('stats')._menu._getMenuItems().map(i => i.label.text);
        W('stats')._menu._getMenuItems()[0].activate(Clutter.get_current_event());
        await sleep(400);
        r.hidden = L.settings.get_strv('hidden');
        r.statsGone = !L.widgets.has('stats');
        r.widgetCount = L.widgets.size;
        L.settings.set_strv('hidden', []);
        await sleep(200);
        r.widgetCountAfterUnhide = L.widgets.size;

        // calendar size switch keeps other widget objects
        const quoteObj = W('quote');
        L.settings.set_string('calendar-size', 'medium');
        await sleep(200);
        r.calendarMedium = W('calendar').sizeName;
        r.quoteKept = W('quote') === quoteObj;
        r.overlapAfterResize = false;
        const ids = [...L.widgets.keys()];
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const [ax, ay, aw, ah] = rect(W(ids[i]));
                const [bx, by, bw, bh] = rect(W(ids[j]));
                if (ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah)
                    r.overlapAfterResize = `${ids[i]}/${ids[j]}`;
            }
        }
        L.settings.set_string('calendar-size', 'small');
        await sleep(200);

        // Review Focus 1: nonsense saved position is clamped on screen
        L.settings.set_value('positions', new GLib.Variant('a{s(ii)}', {calendar: [40, 40]}));
        await sleep(200);
        const [kx, ky, kw, kh] = rect(W('calendar'));
        r.clamped = kx >= L.area.x && ky >= L.area.y &&
            kx + kw <= L.area.x + L.area.w && ky + kh <= L.area.y + L.area.h;
        L.settings.reset('positions');
        await sleep(200);
        r.resetRects = Object.keys(r.rects).every(id => JSON.stringify(rect(W(id))) === JSON.stringify(r.rects[id]));

        // Review Focus 5: day change re-renders every widget once
        let refreshes = 0;
        for (const w of L.widgets.values()) { const orig = w.refresh.bind(w); w.refresh = () => { refreshes++; orig(); }; }
        r.sameDay = L.checkDay(new Date());
        r.nextDay = L.checkDay(new Date(Date.now() + 86400000));
        r.refreshes = refreshes;
        L.checkDay(new Date());

        // light mode
        L._iface.set_string('color-scheme', 'default');
        await sleep(600);
        r.light = L.actor.has_style_class_name('dw-light');
        await screenshot('layout-light');
        L._iface.set_string('color-scheme', 'prefer-dark');
        await sleep(300);
        r.darkAgain = !L.actor.has_style_class_name('dw-light');

        // a real window sits above the layer; maximizing it marks us covered
        const win = await launch(['gnome-calculator']);
        r.windowOpened = !!win;
        if (win) {
            const kids = global.window_group.get_children();
            const li = kids.indexOf(L.actor);
            const wi = kids.indexOf(win.get_compositor_private());
            const di = kids.findIndex(c => c.meta_window?.get_window_type() === Meta.WindowType.DESKTOP);
            r.stack = {desktopIcons: di, layer: li, window: wi};
            r.stackTitles = kids.map(c => c === L.actor ? 'LAYER' : (c.meta_window ? `${c.meta_window.get_title()}|type${c.meta_window.get_window_type()}` : c.constructor.name));
            r.layerBetween = di < li && li < wi;
            await screenshot('layout-window');
            r.coveredBefore = L.covered;
            win.maximize();
            await sleep(1200);
            r.coveredMax = L.covered;
            win.unmaximize();
            await sleep(1200);
            r.coveredAfter = L.covered;
            win.delete(global.get_current_time());
            await sleep(800);
        }

        // disable leaves nothing behind; enable brings it back
        const layerActor = L.actor;
        ext.disable();
        await sleep(300);
        r.layerRemoved = !global.window_group.get_children().includes(layerActor);
        r.menusLeft = Main.uiGroup.get_children().filter(c => c.has_style_class_name?.('popup-menu') && c._delegate?.sourceActor?.has_style_class_name?.('dw-card')).length;
        ext.enable();
        await sleep(300);
        r.reenabled = ext.layer.widgets.size;
        return r;
    },
};

let _started = false;

export async function run(name, ext) {
    if (_started)
        return;         // enable() runs again when a scenario re-enables the extension
    _started = true;
    const result = {scenario: name};
    try {
        await sleep(6000); // let the shell and Desktop Icons finish starting
        if (Main.overview.visible) { Main.overview.hide(); await sleep(1500); }
        Object.assign(result, await scenarios[name](ext));
    } catch (e) {
        result.error = `${e.message} @ ${(e.stack ?? '').split('\n')[0].replace(/.*desk-widgets@nisarg-gandhi.github.io\//, '')}`;
    }
    finish(result);
}

export function register(name, fn) { scenarios[name] = fn; }
