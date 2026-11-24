import {eq} from './assert.js';
import * as N from '../lib/logic/notes.js';

// titles and previews
eq(N.noteTitle('Todo\n1. pushups'), 'Todo', 'first line is the title');
eq(N.noteTitle('\n\n  # Article ideas  \nGNOME'), 'Article ideas', 'skips blank lines and markdown heading marks');
eq(N.noteTitle(''), 'New note', 'empty note');
eq(N.noteTitle('   \n  '), 'New note', 'blank note');
eq(N.noteTitle('x'.repeat(100)).length, 60, 'long title cut to 60');
eq(N.noteTitle('x'.repeat(100)).endsWith('…'), true, 'cut title ends with an ellipsis');
eq(N.notePreview('Todo\n1. Do 20 pushups\n2. Finish writeup'), '1. Do 20 pushups 2. Finish writeup', 'preview is the text after the title, on one line');
eq(N.notePreview('Only a title'), '', 'no body');
eq(N.notePreview('T\n' + 'y'.repeat(200)).length, 80, 'preview cut to 80');

// ids: sortable, filesystem-safe, unique
eq(N.newNoteId(new Date(2026, 10, 24, 9, 5, 7), []), '20261124-090507', 'id from local time');
eq(N.newNoteId(new Date(2026, 10, 24, 9, 5, 7), ['20261124-090507']), '20261124-090507-2', 'collision gets a suffix');
eq(N.newNoteId(new Date(2026, 10, 24, 9, 5, 7), ['20261124-090507', '20261124-090507-2']), '20261124-090507-3', 'next suffix');
eq(N.isNoteFile('20261124-090507.md'), true, 'note file');
eq(N.isNoteFile('20261124-090507-2.md'), true, 'note file with suffix');
eq(N.isNoteFile('.goutputstream-ABC'), false, 'temp file ignored');
eq(N.isNoteFile('notes.md~'), false, 'backup ignored');
eq(N.idOf('20261124-090507.md'), '20261124-090507', 'id from file name');

// sorting and filtering
const L = [
    {id: 'a', text: 'Alpha\nbody', mtime: 100},
    {id: 'b', text: 'Beta\nlab viva', mtime: 300},
    {id: 'c', text: 'Gamma', mtime: 200},
];
eq(N.sortNotes(L, '').map(n => n.id), ['b', 'c', 'a'], 'newest edit first');
eq(N.sortNotes(L, 'a').map(n => n.id), ['a', 'b', 'c'], 'pinned note first');
eq(N.sortNotes(L, 'missing').map(n => n.id), ['b', 'c', 'a'], 'unknown pin ignored');
eq(L.map(n => n.id), ['a', 'b', 'c'], 'sort does not mutate');
eq(N.filterNotes(L, 'VIVA').map(n => n.id), ['b'], 'search body, case-insensitive');
eq(N.filterNotes(L, 'gam').map(n => n.id), ['c'], 'search title');
eq(N.filterNotes(L, '  ').map(n => n.id), ['a', 'b', 'c'], 'blank search shows all');

// which note the desktop card shows
eq(N.cardNote(L, 'c')?.id, 'c', 'the pinned note');
eq(N.cardNote(L, 'gone')?.id, 'b', 'pinned note deleted: most recently edited');
eq(N.cardNote(L, '')?.id, 'b', 'nothing pinned: most recently edited');
eq(N.cardNote([], ''), null, 'no notes');

// dates in the list
const now = new Date(2026, 10, 24, 15, 0).getTime();
eq(N.whenText(new Date(2026, 10, 24, 9, 5).getTime(), now), '09:05', 'today: time');
eq(N.whenText(new Date(2026, 10, 23, 22, 0).getTime(), now), 'Yesterday', 'yesterday');
eq(N.whenText(new Date(2026, 10, 20, 8, 0).getTime(), now), '20 Nov', 'this year: day and month');
eq(N.whenText(new Date(2025, 0, 3, 8, 0).getTime(), now), '3 Jan 2025', 'older: with year');
