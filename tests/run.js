import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';
import {state} from './assert.js';

const dir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const names = [];
const en = Gio.File.new_for_path(dir).enumerate_children('standard::name', 0, null);
let info;
while ((info = en.next_file(null)))
    if (info.get_name().endsWith('.test.js')) names.push(info.get_name());
names.sort();

for (const name of names) {
    try {
        await import(`./${name}`);
    } catch (e) {
        state.failed++;
        print(`FAIL ${name} threw: ${e.message}`);
    }
}
print(`${state.passed} passed, ${state.failed} failed (${names.length} files)`);
System.exit(state.failed ? 1 : 0);
