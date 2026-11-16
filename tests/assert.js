export const state = {passed: 0, failed: 0};

export function ok(cond, label) {
    if (cond) {
        state.passed++;
    } else {
        state.failed++;
        print(`FAIL ${label}`);
    }
}

export function eq(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        state.passed++;
    } else {
        state.failed++;
        print(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
    }
}
