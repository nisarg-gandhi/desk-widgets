// Parsing for /proc and sensor choice. Pure: no shell imports.

// First "cpu" line of /proc/stat -> jiffies. iowait counts as idle.
export function parseProcStat(text) {
    const line = (text ?? '').split('\n').find(l => l.startsWith('cpu '));
    if (!line)
        return null;
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    if (n.length < 4 || n.some(Number.isNaN))
        return null;
    const idle = n[3] + (n[4] ?? 0);
    const total = n.slice(0, 8).reduce((a, v) => a + v, 0);
    return {idle, total};
}

export function cpuPercent(prev, cur) {
    if (!prev || !cur)
        return 0;
    const total = cur.total - prev.total;
    if (total <= 0)
        return 0;
    const busy = total - (cur.idle - prev.idle);
    return Math.min(100, Math.max(0, Math.round(100 * busy / total)));
}

export function parseMeminfo(text) {
    const field = name => {
        const m = new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text ?? '');
        return m ? Number(m[1]) : null;
    };
    const total = field('MemTotal');
    const available = field('MemAvailable');
    if (!total || available === null)
        return null;
    return Math.round(100 * (total - available) / total);
}

const SENSORS = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal', 'acpitz'];

// Index into `names` (hwmon chip names) of the best CPU temperature source.
export function pickTempSensor(names) {
    for (const want of SENSORS) {
        const i = names.indexOf(want);
        if (i !== -1)
            return i;
    }
    return -1;
}
