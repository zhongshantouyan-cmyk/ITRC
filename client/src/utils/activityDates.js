/** ITRC: chronological ordering for ROC, Gregorian and month/day date formats. */
export function activityDateTimestamp(activity) {
    const raw = String(activity?.date ?? '').normalize('NFKC').trim();
    const semester = String(activity?.semester ?? '');
    let year, month, day;
    let match = raw.match(/^(\d{3,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    if (!match) match = raw.match(/^(\d{3,4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/);
    if (match) {
        year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
        if (year < 1912) year += 1911;
    } else {
        match = raw.match(/^(\d{1,2})[./-](\d{1,2})(?!\d)/);
        if (!match) return Number.POSITIVE_INFINITY;
        month = Number(match[1]); day = Number(match[2]);
        const academic = semester.match(/^(\d{3})-([12])$/);
        if (!academic) return Number.POSITIVE_INFINITY;
        year = Number(academic[1]) + 1911;
        if (academic[2] === '2' && month <= 7) year += 1;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return Number.POSITIVE_INFINITY;
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return Number.POSITIVE_INFINITY;
    return timestamp;
}

export function sortActivitiesByDate(activities) {
    return [...activities].sort((a,b) => activityDateTimestamp(a) - activityDateTimestamp(b));
}
