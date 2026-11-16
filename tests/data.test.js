// The one test allowed to use gi://: it loads the bundled data files.
import GLib from 'gi://GLib';
import {eq, ok} from './assert.js';

const dir = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
const load = name => JSON.parse(new TextDecoder().decode(GLib.file_get_contents(`${dir}/data/${name}`)[1]));
const quotes = load('quotes.json');
const tips = load('tips.json');

ok(quotes.length >= 150 && tips.length >= 150, `counts (${quotes.length} quotes, ${tips.length} tips)`);
const tooLong = [...quotes, ...tips].filter(i => !(typeof i.text === 'string' && i.text.length > 0 && i.text.length <= 140));
eq(tooLong.map(i => i.text), [], 'every text fits the card (1..140 chars)');
eq(quotes.filter(q => !(q.author && q.author.length <= 40)).map(q => q.text), [], 'authors present and short');
eq(new Set(quotes.map(q => q.text)).size, quotes.length, 'no duplicate quotes');
eq(new Set(tips.map(t => t.text)).size, tips.length, 'no duplicate tips');
