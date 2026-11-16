import {eq, ok} from './assert.js';
import * as H from '../lib/logic/habitStats.js';

const T = new Date(2026, 10, 16); // a Monday
const d = {Read: ['2026-11-14', '2026-11-15', '2026-11-16'], Code: ['2026-11-14', '2026-11-15'], Walk: []};

// weeks
eq(H.weekDays(T), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'], 'week of a Monday');
eq(H.weekDays(new Date(2026, 10, 22)), H.weekDays(T), 'Sunday belongs to the same week');
eq(H.weekDays(new Date(2026, 10, 15))[0], '2026-11-09', 'previous week');
eq(H.weekDays(new Date(2026, 11, 31))[6], '2027-01-03', 'week across a year boundary');
eq(H.isoDate(H.shiftWeek(T, -1)), '2026-11-09', 'shift back a week');
eq(H.isoDate(H.shiftWeek(T, 1)), '2026-11-23', 'shift forward a week');
eq(H.weekCount(d, 'Read', T), 1, 'ticks in this week');
eq(H.weekCount(d, 'Read', new Date(2026, 10, 15)), 2, 'ticks in last week');
eq(H.weekCount(d, 'Nope', T), 0, 'unknown habit week count');
eq(H.weekLabel(T), '16 – 22 Nov 2026', 'week label');
eq(H.weekLabel(new Date(2026, 11, 31)), '28 Dec 2026 – 3 Jan 2027', 'week label across years');
eq(H.weekLabel(new Date(2026, 10, 30)), '30 Nov – 6 Dec 2026', 'week label across months');

// stats
eq(H.totalDays(d, 'Read'), 3, 'total');
eq(H.totalDays(d, 'Nope'), 0, 'total unknown');
eq(H.longestStreak({R: ['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-06']}, 'R'), 3, 'longest run');
eq(H.longestStreak({R: ['2026-01-01', '2025-12-31', '2025-12-30']}, 'R'), 3, 'unsorted, across a year boundary');
eq(H.longestStreak({R: ['2026-03-01', '2026-02-28']}, 'R'), 2, 'across a month boundary');
eq(H.longestStreak(d, 'Walk'), 0, 'no ticks');
eq(H.longestStreak({R: ['2026-01-01', '2026-01-01']}, 'R'), 1, 'duplicates count once');
eq(H.monthPercent(d, 'Read', T), 19, '3 of 16 days so far this month');
eq(H.monthPercent({R: ['2026-11-01']}, 'R', new Date(2026, 10, 1)), 100, 'first of the month');
eq(H.monthPercent({R: ['2026-10-31']}, 'R', T), 0, 'other months do not count');
eq(H.lastDone(d, 'Read', T), 0, 'done today');
eq(H.lastDone(d, 'Code', T), 1, 'done yesterday');
eq(H.lastDone(d, 'Walk', T), null, 'never done');
eq(H.lastDone({R: ['2026-11-20', '2026-11-10']}, 'R', T), 6, 'future ticks ignored');
eq(H.lastDoneText(0), 'done today', 'text today');
eq(H.lastDoneText(1), 'last done yesterday', 'text yesterday');
eq(H.lastDoneText(5), 'last done 5 days ago', 'text days');
eq(H.lastDoneText(null), 'not done yet', 'text never');

// year grid
const g = H.yearGrid(d, 'Read', T, 2);
eq(g.length, 2, 'two week columns');
eq(g[1][0], {iso: '2026-11-16', done: true, future: false}, 'today');
eq(g[1][1], {iso: '2026-11-17', done: false, future: true}, 'tomorrow is future');
eq([g[0][5].done, g[0][6].done, g[0][4].done], [true, true, false], 'last weekend ticked');
eq(H.yearGrid(d, 'Read', T).length, 53, 'default is 53 weeks');

// names
eq(H.nameError({Read: []}, [], 'Walk'), null, 'valid name');
eq(H.nameError({Read: []}, [], '   '), 'empty', 'blank');
eq(H.nameError({Read: []}, [], ' read '), 'duplicate', 'case-insensitive duplicate in file');
eq(H.nameError({}, ['Gym'], 'gym'), 'duplicate', 'duplicate of a widget-only habit');
eq(H.nameError({}, [], 'x'.repeat(31)), 'long', 'too long');
eq(H.nameError({Read: []}, [], 'Read', 'Read'), null, 'renaming to itself is fine');
eq(H.allHabits({Read: [], Code: []}, ['Code', 'Gym']), ['Read', 'Code', 'Gym'], 'file order, then widget-only names');
eq(H.allHabits({}, [' ', 'Gym', 'Gym']), ['Gym'], 'blank and repeated names dropped');

// editing
eq(H.addHabit(d, ' Yoga ').Yoga, [], 'add trims');
eq(Object.keys(H.addHabit(d, 'Yoga')), ['Read', 'Code', 'Walk', 'Yoga'], 'add appends');
eq(H.addHabit(d, 'Read').Read.length, 3, 'adding an existing habit keeps its history');
const r = H.renameHabit(d, 'Code', 'Coding');
eq(Object.keys(r), ['Read', 'Coding', 'Walk'], 'rename keeps position');
eq(r.Coding, ['2026-11-14', '2026-11-15'], 'rename keeps history');
eq(H.renameHabit(d, 'Nope', 'X'), {...d, X: []}, 'renaming a widget-only habit creates it');
eq(Object.keys(H.deleteHabit(d, 'Code')), ['Read', 'Walk'], 'delete');
eq(Object.keys(d), ['Read', 'Code', 'Walk'], 'edits do not mutate their input');
eq(H.setDay(d, 'Walk', '2026-11-10', true).Walk, ['2026-11-10'], 'set a past day');
eq(H.setDay(d, 'Read', '2026-11-15', false).Read, ['2026-11-14', '2026-11-16'], 'clear a past day');
eq(H.setDay(d, 'Read', '2026-11-15', true).Read.length, 3, 'setting a ticked day changes nothing');

// widget slots
const N = ['Read', 'Workout', 'Code'];
eq(H.setSlot(N, 0, 'Walk'), ['Walk', 'Workout', 'Code'], 'put a new habit in a row');
eq(H.setSlot(N, 0, 'Code'), ['Code', 'Workout', 'Read'], 'picking one already shown swaps rows');
eq(H.setSlot(['Read'], 2, 'Walk'), ['Read', 'Walk'], 'row past the end appends');
eq(H.setSlot(N, 1, 'Workout'), N, 'same habit, same row: no change');
eq(H.toggleStar(N, 'Workout'), {names: ['Read', 'Code'], ok: true}, 'unstar');
eq(H.toggleStar(['Read'], 'Walk'), {names: ['Read', 'Walk'], ok: true}, 'star');
eq(H.toggleStar(N, 'Walk'), {names: N, ok: false}, 'cannot star a fourth');
eq(H.renameIn(N, 'Code', 'Coding'), ['Read', 'Workout', 'Coding'], 'rename in slots');
eq(H.renameIn(N, 'Nope', 'X'), N, 'rename of an unshown habit leaves slots');
eq(H.MAX_SHOWN, 3, 'widget shows three');
