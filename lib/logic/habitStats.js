// Statistics and editing for the habit tracker. Pure: no shell or GTK imports.
// Data shape (shared with streaks.js): {[habitName]: string[]} of local ISO dates.
import {dayNumber, isoDate} from './dates.js';

export {isoDate};

export const MAX_SHOWN = 3;      // rows on the desktop widget
export const MAX_NAME = 30;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const monday = date => addDays(date, -((date.getDay() + 6) % 7));
const isoToDayNumber = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
};

// --- weeks -------------------------------------------------------------------

// ISO dates Monday..Sunday of the week containing `date`.
export function weekDays(date) {
    const start = monday(date);
    return Array.from({length: 7}, (_, i) => isoDate(addDays(start, i)));
}

export function shiftWeek(date, weeks) {
    return addDays(monday(date), 7 * weeks);
}

export function weekCount(data, habit, date) {
    const done = new Set(data[habit] ?? []);
    return weekDays(date).filter(iso => done.has(iso)).length;
}

export function weekLabel(date) {
    const a = monday(date);
    const b = addDays(a, 6);
    const end = `${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
    if (a.getFullYear() !== b.getFullYear())
        return `${a.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()} – ${end}`;
    if (a.getMonth() !== b.getMonth())
        return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${end}`;
    return `${a.getDate()} – ${end}`;
}

// --- statistics --------------------------------------------------------------

export function totalDays(data, habit) {
    return new Set(data[habit] ?? []).size;
}

// The longest run of consecutive days ever.
export function longestStreak(data, habit) {
    const days = [...new Set(data[habit] ?? [])].map(isoToDayNumber).sort((a, b) => a - b);
    let best = 0;
    let run = 0;
    days.forEach((day, i) => {
        run = i > 0 && day === days[i - 1] + 1 ? run + 1 : 1;
        best = Math.max(best, run);
    });
    return best;
}

// Share of this month's days so far (1st..today) that are ticked, 0..100.
export function monthPercent(data, habit, today) {
    const prefix = isoDate(today).slice(0, 8);
    const upTo = isoDate(today);
    const done = new Set(data[habit] ?? []);
    const ticked = [...done].filter(iso => iso.startsWith(prefix) && iso <= upTo).length;
    return Math.round(100 * ticked / today.getDate());
}

// Days since the habit was last done (0 = today), ignoring future ticks; null = never.
export function lastDone(data, habit, today) {
    const now = dayNumber(today);
    const past = (data[habit] ?? []).map(isoToDayNumber).filter(n => n <= now);
    return past.length ? now - Math.max(...past) : null;
}

export function lastDoneText(days) {
    if (days === null)
        return 'not done yet';
    if (days === 0)
        return 'done today';
    if (days === 1)
        return 'last done yesterday';
    return `last done ${days} days ago`;
}

// Columns of weeks (oldest first, the last is the current week), each with 7
// cells Monday..Sunday: {iso, done, future}.
export function yearGrid(data, habit, today, weeks = 53) {
    const done = new Set(data[habit] ?? []);
    const todayIso = isoDate(today);
    const first = shiftWeek(today, -(weeks - 1));
    return Array.from({length: weeks}, (_, w) => Array.from({length: 7}, (_d, i) => {
        const iso = isoDate(addDays(first, 7 * w + i));
        return {iso, done: done.has(iso), future: iso > todayIso};
    }));
}

// --- names -------------------------------------------------------------------

// Every habit: those in the file (file order), then widget-only names.
export function allHabits(data, names) {
    const out = [];
    for (const name of [...Object.keys(data), ...names.map(n => n.trim())]) {
        if (name && !out.includes(name))
            out.push(name);
    }
    return out;
}

// Why `name` cannot be used: 'empty' | 'long' | 'duplicate', or null if it can.
// `renaming` is the habit being renamed, which may keep its own name.
export function nameError(data, names, name, renaming = null) {
    const clean = name.trim();
    if (!clean)
        return 'empty';
    if (clean.length > MAX_NAME)
        return 'long';
    const taken = allHabits(data, names)
        .filter(n => n !== renaming)
        .map(n => n.toLowerCase());
    return taken.includes(clean.toLowerCase()) ? 'duplicate' : null;
}

// --- editing (all return new objects) ------------------------------------------

export function addHabit(data, name) {
    const clean = name.trim();
    return clean in data ? data : {...data, [clean]: []};
}

export function renameHabit(data, from, to) {
    const clean = to.trim();
    if (!(from in data))
        return {...data, [clean]: data[clean] ?? []};
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k === from ? clean : k, v]));
}

export function deleteHabit(data, name) {
    return Object.fromEntries(Object.entries(data).filter(([k]) => k !== name));
}

export function setDay(data, habit, iso, done) {
    const days = new Set(data[habit] ?? []);
    if (done)
        days.add(iso);
    else
        days.delete(iso);
    return {...data, [habit]: [...days].sort()};
}

// --- the widget's rows -----------------------------------------------------------

// Put `name` in row `index`. If it is already in another row, the two swap.
export function setSlot(names, index, name) {
    const out = [...names];
    const at = out.indexOf(name);
    if (index >= out.length) {
        if (at === -1)
            out.push(name);
        return out;
    }
    if (at !== -1)
        out[at] = out[index];
    out[index] = name;
    return out;
}

// Show or stop showing a habit on the widget. ok is false when it is full.
export function toggleStar(names, name, max = MAX_SHOWN) {
    if (names.includes(name))
        return {names: names.filter(n => n !== name), ok: true};
    if (names.length >= max)
        return {names, ok: false};
    return {names: [...names, name], ok: true};
}

export function renameIn(names, from, to) {
    return names.map(n => n === from ? to.trim() : n);
}
