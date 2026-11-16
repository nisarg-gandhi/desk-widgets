// Date helpers. Pure: no shell imports. All "days" are local calendar days.

export function dayNumber(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

export function isoDate(date) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// Weeks of the month containing `date`, Monday first. Each row has 7 entries:
// the day of the month, or null for days outside the month.
export function monthGrid(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const cells = [
        ...Array(lead).fill(null),
        ...Array.from({length: days}, (_, i) => i + 1),
    ];
    while (cells.length % 7)
        cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7)
        weeks.push(cells.slice(i, i + 7));
    return weeks;
}

// One item per local day, cycling through the list. null for an empty list.
export function pickDaily(list, date) {
    return list.length ? list[dayNumber(date) % list.length] : null;
}

// What the quote card shows today: 'quote' or 'tip'.
export function quoteKind(mode, date) {
    if (mode === 'quotes')
        return 'quote';
    if (mode === 'tips')
        return 'tip';
    return dayNumber(date) % 2 === 0 ? 'quote' : 'tip';
}
