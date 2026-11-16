import {eq} from './assert.js';
import {sanitize, parse, parseChecked, toggle, last7, streak, bestStreak} from '../lib/logic/streaks.js';

const T = new Date(2026, 10, 16);
const d = {Read: ['2026-11-14', '2026-11-15', '2026-11-16'], Code: ['2026-11-14', '2026-11-15']};
eq(streak(d, 'Read', T), 3, 'through today');
eq(streak(d, 'Code', T), 2, 'today not ticked yet keeps yesterday streak');
eq(streak(d, 'Nope', T), 0, 'unknown habit');
eq(streak({Read: ['2026-11-13']}, 'Read', T), 0, 'gap of a day breaks the streak');
eq(streak({Read: ['2026-10-31', '2026-11-01']}, 'Read', new Date(2026, 10, 1)), 2, 'across a month boundary');
eq(last7(d, 'Code', T), [false, false, false, false, true, true, false], 'last7');
eq(last7(d, 'Nope', T), [false, false, false, false, false, false, false], 'last7 unknown');
eq(toggle(d, 'Code', '2026-11-16').Code.length, 3, 'tick');
eq(toggle(d, 'Read', '2026-11-16').Read.length, 2, 'untick');
eq(toggle(d, 'New', '2026-11-16').New, ['2026-11-16'], 'first tick of a new habit');
eq(d.Code.length, 2, 'toggle does not mutate its input');
eq(bestStreak(d, ['Read', 'Code'], T), 3, 'best');
eq(bestStreak(d, [], T), 0, 'best of none');
// Review Focus 2
eq(parse('{not json'), {}, 'corrupt file');
eq(parse('[1,2,3]'), {}, 'wrong shape');
eq(parse('null'), {}, 'json null');
eq(parse('{"Read":"oops","Code":["2026-11-15", 7]}'), {Code: ['2026-11-15']}, 'bad entries dropped');
eq(parse(null), {}, 'missing file');
eq(sanitize({Read: ['2026-11-15', 'yesterday', '2026-13-99x']}), {Read: ['2026-11-15']}, 'non-dates dropped');

// Final review I4: know when the file on disk would lose information if overwritten
eq(parseChecked(null), {data: {}, damaged: false}, 'missing file is not damage');
eq(parseChecked('{"Read":["2026-11-15"]}'), {data: {Read: ['2026-11-15']}, damaged: false}, 'clean file');
eq(parseChecked('{bad'), {data: {}, damaged: true}, 'syntax error is damage');
eq(parseChecked('{"Read":["2026-11-15","oops"]}'), {data: {Read: ['2026-11-15']}, damaged: true}, 'dropped entries are damage');
eq(parseChecked('[1]').damaged, true, 'wrong shape is damage');
eq(parseChecked('').damaged, true, 'empty file is damage');
