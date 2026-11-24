// Notes: titles, ids, sorting and search. Pure: no shell or GTK imports.
// A note is {id, text, mtime}; it is stored as <id>.md.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TITLE_MAX = 60;
const PREVIEW_MAX = 80;
const ID_FILE = /^(\d{8}-\d{6}(?:-\d+)?)\.md$/;

const cut = (text, max) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const lines = text => (text ?? '').split('\n');

// The first non-blank line, without leading markdown heading marks.
export function noteTitle(text) {
    const first = lines(text).find(l => l.trim()) ?? '';
    const title = first.replace(/^\s*#+\s*/, '').trim();
    return title ? cut(title, TITLE_MAX) : 'New note';
}

// The text after the title line, on one line.
export function notePreview(text) {
    const all = lines(text);
    const at = all.findIndex(l => l.trim());
    if (at === -1)
        return '';
    const body = all.slice(at + 1).join(' ').slice(0, PREVIEW_MAX * 4).replace(/\s+/g, ' ').trim();
    return cut(body, PREVIEW_MAX);
}

// A new id from local time, e.g. 20261124-090507; a suffix keeps it unique.
export function newNoteId(date, existing) {
    const p = n => String(n).padStart(2, '0');
    const base = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
        `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
    const taken = new Set(existing);
    if (!taken.has(base))
        return base;
    let n = 2;
    while (taken.has(`${base}-${n}`))
        n++;
    return `${base}-${n}`;
}

export function isNoteFile(name) {
    return ID_FILE.test(name);
}

export function idOf(name) {
    return ID_FILE.exec(name)?.[1] ?? null;
}

// Pinned note first, then the most recently edited.
export function sortNotes(notes, pinned) {
    return [...notes].sort((a, b) =>
        (b.id === pinned) - (a.id === pinned) || b.mtime - a.mtime || (a.id < b.id ? 1 : -1));
}

export function filterNotes(notes, query) {
    const q = query.trim().toLowerCase();
    return q ? notes.filter(n => n.text.toLowerCase().includes(q)) : notes;
}

// The note the desktop card shows: the pinned one, else the most recent.
export function cardNote(notes, pinned) {
    return notes.find(n => n.id === pinned) ?? sortNotes(notes, '')[0] ?? null;
}

export function whenText(mtimeMs, nowMs) {
    const d = new Date(mtimeMs);
    const now = new Date(nowMs);
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff === 0)
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (diff === 1)
        return 'Yesterday';
    if (d.getFullYear() === now.getFullYear())
        return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
