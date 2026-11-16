import {eq, ok} from './assert.js';
import * as D from '../lib/logic/dates.js';

eq(D.dayNumber(new Date(2026, 10, 16)), 20773, 'day number');
eq(D.dayNumber(new Date(2026, 10, 16, 23, 59)), 20773, 'same day late');
eq(D.dayNumber(new Date(2026, 10, 17, 0, 0)), 20774, 'next day'); // Review Focus 5
eq(D.isoDate(new Date(2026, 0, 5)), '2026-01-05', 'iso padded');

// Task 4: month grid, weeks start Monday
const g = D.monthGrid(new Date(2026, 10, 16));
eq(g.length, 6, 'Nov 2026 spans 6 weeks');
eq(g[0], [null, null, null, null, null, null, 1], 'starts Sunday');
eq(g[3], [16, 17, 18, 19, 20, 21, 22], 'week of the 16th');
eq(g[5], [30, null, null, null, null, null, null], 'last row');
eq(D.monthGrid(new Date(2027, 1, 1)).length, 4, 'Feb 2027 is exactly 4 weeks');
ok(D.monthGrid(new Date(2024, 1, 10)).flat().filter(Boolean).length === 29, 'leap February has 29 days');

// Task 7: daily pick
eq(D.pickDaily(['a', 'b', 'c'], new Date(2026, 10, 16)), 'b', '20773 % 3 == 1');
eq(D.pickDaily(['a', 'b', 'c'], new Date(2026, 10, 17)), 'c', 'next day, next item');
eq(D.pickDaily([], new Date(2026, 10, 16)), null, 'empty list');
eq(D.quoteKind('alternate', new Date(2026, 10, 16)), 'tip', 'odd day');
eq(D.quoteKind('alternate', new Date(2026, 10, 17)), 'quote', 'even day');
eq(D.quoteKind('quotes', new Date(2026, 10, 16)), 'quote', 'forced quotes');
eq(D.quoteKind('tips', new Date(2026, 10, 17)), 'tip', 'forced tips');
