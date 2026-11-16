import {eq, ok} from './assert.js';
import {SIZES, PITCH, MARGIN, DEFAULT_CELLS, toPixels, snapToCell, clampCell, collides, resolveLayout} from '../lib/logic/grid.js';

const A = {w: 1536, h: 912};
const ALL_SIZES = {calendar: 'small', stats: 'small', quote: 'medium', markets: 'medium', habits: 'medium', notes: 'medium', clipboard: 'medium'};

eq([SIZES.small, SIZES.medium, PITCH, MARGIN], [{w: 160, h: 160}, {w: 336, h: 160}, 176, 16], 'constants');
eq(toPixels('small', [3, 0], A), {x: 832, y: 16}, 'calendar default');
eq(toPixels('small', [2, 0], A), {x: 1008, y: 16}, 'stats default');
eq(toPixels('medium', [0, 0], A), {x: 1184, y: 16}, 'quote default');
eq(toPixels('medium', [2, 1], A), {x: 832, y: 192}, 'markets default');
eq(snapToCell('small', {x: 840, y: 30}, A), [3, 0], 'snaps to nearest');
eq(snapToCell('small', {x: -500, y: 5000}, A), clampCell('small', [99, 99], A), 'clamped');
eq(clampCell('small', [-3, -1], A), [0, 0], 'clamps negatives');
ok(collides('small', [1, 0], [{size: 'medium', cell: [0, 0]}]), 'small on medium left half');
ok(!collides('small', [2, 0], [{size: 'medium', cell: [0, 0]}]), 'adjacent is free');
ok(!collides('small', [1, 1], [{size: 'medium', cell: [0, 0]}]), 'other row is free');

function inside(layout, sizes, area) {
    return Object.entries(layout).every(([id, cell]) => {
        const {x, y} = toPixels(sizes[id], cell, area);
        const {w, h} = SIZES[sizes[id]];
        return x >= 0 && y >= 0 && x + w <= area.w && y + h <= area.h;
    });
}
function anyOverlap(layout, sizes) {
    const ids = Object.keys(layout);
    return ids.some((id, i) => collides(sizes[id], layout[id],
        ids.slice(i + 1).map(o => ({size: sizes[o], cell: layout[o]}))));
}

const def = resolveLayout(ALL_SIZES, {}, A);
eq(def, DEFAULT_CELLS, 'empty saved gives the default layout');
ok(!anyOverlap(def, ALL_SIZES), 'default layout has no overlap');
eq(resolveLayout(ALL_SIZES, {notes: [5, 4]}, A).notes, [5, 4], 'saved cell is kept');

// Review Focus 1: saved layout from a bigger screen
const narrow = {w: 736, h: 912}; // 4 columns x 5 rows
const out = resolveLayout(ALL_SIZES, {calendar: [9, 9], quote: [9, 9]}, narrow);
eq(Object.keys(out).length, 7, 'all widgets placed');
ok(inside(out, ALL_SIZES, narrow), 'every widget inside the narrow area');
ok(!anyOverlap(out, ALL_SIZES), 'no overlap in the narrow area');
// Final review I1: when the area cannot hold every widget, the ones that do
// not fit are left out rather than stacked on top of others.
for (const area of [{w: 400, h: 400}, {w: 960, h: 492}, {w: 683, h: 352}]) {
    const fit = resolveLayout(ALL_SIZES, {}, area);
    const label = `${area.w}x${area.h}`;
    ok(Object.keys(fit).length >= 1 && Object.keys(fit).length < 7, `${label}: some widgets placed, not all`);
    ok(inside(fit, ALL_SIZES, area), `${label}: placed widgets on screen`);
    ok(!anyOverlap(fit, ALL_SIZES), `${label}: no overlap`);
}
eq(Object.keys(resolveLayout(ALL_SIZES, {}, {w: 100, h: 100})), [], 'nothing fits a tiny area, and nothing throws');
