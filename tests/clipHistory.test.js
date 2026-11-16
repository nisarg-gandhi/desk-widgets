import {eq} from './assert.js';
import {MAX_ITEMS, MAX_CHARS, push, oneLine} from '../lib/logic/clipHistory.js';

eq([MAX_ITEMS, MAX_CHARS], [20, 10000], 'limits');
eq(push([], 'a'), ['a'], 'first');
eq(push(['a'], 'b'), ['b', 'a'], 'newest first');
eq(push(['a', 'b'], 'b'), ['b', 'a'], 'dedupe moves to front');
eq(push(['a'], '   \n'), ['a'], 'ignores blank');
eq(push(['a'], null), ['a'], 'ignores null');
eq(push(['a'], undefined), ['a'], 'ignores undefined');
const full = Array.from({length: 20}, (_, i) => `x${i}`);
eq(push(full, 'new').length, 20, 'capped');
eq(push(full, 'new')[0], 'new', 'newest kept when capped');
eq(push(full, 'new').includes('x19'), false, 'oldest dropped when capped');
eq(full.length, 20, 'push does not mutate its input');
// Review Focus 4
eq(push([], 'z'.repeat(5_000_000))[0].length, 10000, 'huge copy truncated');
eq(oneLine('git  rebase\n\t-i HEAD~3'), 'git rebase -i HEAD~3', 'one line');
eq(oneLine('a'.repeat(100), 10), 'aaaaaaaaa…', 'ellipsized');
eq(oneLine('  short  '), 'short', 'trimmed');
