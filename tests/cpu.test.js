import {eq} from './assert.js';
import {parseProcStat, cpuPercent, parseMeminfo, pickTempSensor} from '../lib/logic/cpu.js';

const a = parseProcStat('cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3\n');
eq(a, {idle: 800, total: 1000}, 'parse');
const b = parseProcStat('cpu  300 0 300 900 100 0 0 0 0 0\n');
eq(cpuPercent(a, b), 67, 'two thirds busy');
eq(cpuPercent(a, a), 0, 'no advance');
eq(cpuPercent(null, b), 0, 'no previous sample');
eq(parseProcStat('garbage'), null, 'bad input');
eq(parseProcStat(''), null, 'empty input');
eq(parseMeminfo('MemTotal: 16000 kB\nMemFree: 1 kB\nMemAvailable: 6240 kB\n'), 61, 'mem');
eq(parseMeminfo(''), null, 'empty');
eq(parseMeminfo('MemTotal: 0 kB\nMemAvailable: 0 kB\n'), null, 'zero total');
eq(pickTempSensor(['nvme', 'acpitz', 'coretemp']), 2, 'prefers coretemp');
eq(pickTempSensor(['nvme', 'acpitz']), 1, 'falls back to acpitz');
eq(pickTempSensor(['nvme']), -1, 'none');
