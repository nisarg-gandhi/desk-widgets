// Market symbols: parsing, URLs, response parsing, formatting. Pure.
import {isoDate} from './dates.js';

const LABELS = {'^NSEI': 'NIFTY 50', '^BSESN': 'SENSEX'};
const FX = /^([A-Za-z]{3})\/([A-Za-z]{3})$/;
const safeKey = s => s.replace(/[^A-Za-z0-9]/g, '_');
const isNum = v => typeof v === 'number' && Number.isFinite(v);

// 'USD/INR' -> currency pair; anything else non-empty -> stock/index symbol.
export function parseSymbol(str) {
    const s = (str ?? '').trim().toUpperCase();
    if (!s)
        return null;
    const fx = FX.exec(s);
    if (fx)
        return {kind: 'fx', base: fx[1], quote: fx[2], label: s, key: safeKey(s)};
    return {kind: 'stock', symbol: s, label: LABELS[s] ?? s, key: safeKey(s)};
}

export function yahooUrl(symbol) {
    return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
}

export function parseYahoo(json) {
    const meta = json?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const prev = meta?.chartPreviousClose;
    if (!isNum(price) || !isNum(prev) || prev === 0)
        return null;
    return {price, changePct: 100 * (price - prev) / prev};
}

// A week of daily rates, so there are two trading days even after a holiday.
export function frankfurterUrl(base, quote, today) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
    return `https://api.frankfurter.dev/v1/${isoDate(start)}..?base=${base}&symbols=${quote}`;
}

export function parseFrankfurter(json, quote) {
    const rates = json?.rates;
    if (rates === null || typeof rates !== 'object')
        return null;
    const days = Object.keys(rates).sort();
    if (days.length < 2)
        return null;
    const price = rates[days.at(-1)]?.[quote];
    const prev = rates[days.at(-2)]?.[quote];
    if (!isNum(price) || !isNum(prev) || prev === 0)
        return null;
    return {price, changePct: 100 * (price - prev) / prev};
}

export function formatPrice(n, locale) {
    const digits = Math.abs(n) >= 1000 ? 0 : 2;
    return n.toLocaleString(locale, {minimumFractionDigits: digits, maximumFractionDigits: digits});
}

export function formatChange(pct) {
    const abs = Math.abs(pct).toFixed(1);
    if (abs === '0.0')
        return '0.0%';
    return `${pct > 0 ? '▲' : '▼'}${abs}%`;
}

export function ageText(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1)
        return 'just now';
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}
