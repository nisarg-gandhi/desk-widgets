// Grid maths for widget placement. Pure: no shell imports.
// A cell is [colFromRight, row]: column 0 is flush with the right margin, so
// a layout survives a change of screen width. A medium widget's cell names
// its right-hand column; it also covers col + 1.

export const SIZES = {small: {w: 160, h: 160}, medium: {w: 336, h: 160}};
export const PITCH = 176;
export const MARGIN = 16;

export const DEFAULT_CELLS = {
    calendar: [3, 0], stats: [2, 0], quote: [0, 0],
    markets: [2, 1], habits: [0, 1],
    notes: [2, 2], clipboard: [0, 2],
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function maxCell(size, area) {
    const {w, h} = SIZES[size];
    return [
        Math.max(0, Math.floor((area.w - 2 * MARGIN - w) / PITCH)),
        Math.max(0, Math.floor((area.h - 2 * MARGIN - h) / PITCH)),
    ];
}

export function toPixels(size, [col, row], area) {
    return {
        x: area.w - MARGIN - col * PITCH - SIZES[size].w,
        y: MARGIN + row * PITCH,
    };
}

export function clampCell(size, [col, row], area) {
    const [maxCol, maxRow] = maxCell(size, area);
    return [clamp(col, 0, maxCol), clamp(row, 0, maxRow)];
}

export function snapToCell(size, {x, y}, area) {
    const col = Math.round((area.w - MARGIN - x - SIZES[size].w) / PITCH);
    const row = Math.round((y - MARGIN) / PITCH);
    return clampCell(size, [col, row], area);
}

function covered(size, [col, row]) {
    return size === 'medium' ? [[col, row], [col + 1, row]] : [[col, row]];
}

export function collides(size, cell, others) {
    const mine = covered(size, cell);
    return others.some(o => covered(o.size, o.cell).some(([c, r]) =>
        mine.some(([mc, mr]) => mc === c && mr === r)));
}

function fits(size, area) {
    const {w, h} = SIZES[size];
    return w + 2 * MARGIN <= area.w && h + 2 * MARGIN <= area.h;
}

// Cell for every widget that fits. A widget with no free cell left (small
// screens) is omitted from the result rather than stacked on another one.
export function resolveLayout(sizes, saved, area) {
    const order = [
        ...Object.keys(DEFAULT_CELLS).filter(id => id in sizes),
        ...Object.keys(sizes).filter(id => !(id in DEFAULT_CELLS)),
    ];
    const placed = [];
    const out = {};
    for (const id of order) {
        const size = sizes[id];
        if (!fits(size, area))
            continue;
        let cell = clampCell(size, saved[id] ?? DEFAULT_CELLS[id] ?? [0, 0], area);
        if (collides(size, cell, placed)) {
            const [maxCol, maxRow] = maxCell(size, area);
            cell = null;
            search:
            for (let row = 0; row <= maxRow; row++) {
                for (let col = 0; col <= maxCol; col++) {
                    if (!collides(size, [col, row], placed)) {
                        cell = [col, row];
                        break search;
                    }
                }
            }
        }
        if (cell === null)
            continue;
        placed.push({size, cell});
        out[id] = cell;
    }
    return out;
}
