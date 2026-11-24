// The extension's settings, for the apps that ship inside the extension
// folder (they are not run by GNOME Shell, so they load the schema directly).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SCHEMA = 'org.gnome.shell.extensions.desk-widgets';

export function loadSettings() {
    const root = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
    try {
        const source = Gio.SettingsSchemaSource.new_from_directory(
            `${root}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup(SCHEMA, false);
        return schema ? new Gio.Settings({settings_schema: schema}) : null;
    } catch {
        return null;
    }
}
