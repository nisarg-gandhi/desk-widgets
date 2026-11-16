// Clipboard history list. Pure: no shell imports. Newest item first.

export const MAX_ITEMS = 20;
export const MAX_CHARS = 10000;

export function push(list, text) {
    if (typeof text !== 'string' || text.trim() === '')
        return list;
    const item = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
    return [item, ...list.filter(t => t !== item)].slice(0, MAX_ITEMS);
}

// A single display line: whitespace runs collapsed, trimmed, cut with an ellipsis.
export function oneLine(text, max = 60) {
    const line = text.slice(0, max * 8).replace(/\s+/g, ' ').trim();
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
