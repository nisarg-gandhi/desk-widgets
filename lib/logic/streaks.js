// Habit history. Pure: no shell imports.
// Data shape: {[habitName]: string[]} where each string is a local ISO date.
import {isoDate} from './dates.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Coerce anything (hand-edited files included) into valid habit data.
export function sanitize(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        return {};
    const out = {};
    for (const [name, days] of Object.entries(raw)) {
        if (!Array.isArray(days))
            continue;
        out[name] = [...new Set(days.filter(d => typeof d === 'string' && ISO.test(d)))];
    }
    return out;
}

export function parse(text) {
    if (text === null || text === undefined)
        return {};
    try {
        return sanitize(JSON.parse(text));
    } catch {
        return {};
    }
}

// Like parse(), and also says whether overwriting the file would lose
// something: a syntax error, a wrong shape, or entries that had to be dropped.
export function parseChecked(text) {
    if (text === null || text === undefined)
        return {data: {}, damaged: false};
    let raw;
    try {
        raw = JSON.parse(text);
    } catch {
        return {data: {}, damaged: true};
    }
    const data = sanitize(raw);
    return {data, damaged: JSON.stringify(data) !== JSON.stringify(raw)};
}

export function toggle(data, habit, iso) {
    const days = data[habit] ?? [];
    return {
        ...data,
        [habit]: days.includes(iso) ? days.filter(d => d !== iso) : [...days, iso].sort(),
    };
}

function daysAgo(today, n) {
    return isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
}

// Oldest first, today last.
export function last7(data, habit, today) {
    const done = new Set(data[habit] ?? []);
    return Array.from({length: 7}, (_, i) => done.has(daysAgo(today, 6 - i)));
}

// Consecutive days ending today, or ending yesterday when today is not
// ticked yet (so a streak does not read 0 every morning).
export function streak(data, habit, today) {
    const done = new Set(data[habit] ?? []);
    let n = done.has(daysAgo(today, 0)) ? 0 : 1;
    let count = 0;
    while (done.has(daysAgo(today, n))) {
        count++;
        n++;
    }
    return count;
}

export function bestStreak(data, names, today) {
    return names.reduce((best, name) => Math.max(best, streak(data, name, today)), 0);
}
