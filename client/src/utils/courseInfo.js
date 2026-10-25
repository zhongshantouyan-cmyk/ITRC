const FIELDS = ['time', 'location', 'coordinators', 'email', 'ig', 'professor', 'registrationFormUrl'];

export function publicCourseInfo(content) {
    let parsed;
    try { parsed = typeof content === 'string' ? JSON.parse(content) : content; }
    catch { return {}; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
        .map(([key, value]) => [key === '入社報名' ? 'registrationFormUrl' : key, value])
        .filter(([key, value]) => {
        if (!FIELDS.includes(key) || typeof value !== 'string') return false;
        if (/(?:https?:\/\/)?docs\.google\.com\/spreadsheets\//i.test(value)) return false;
        if (key !== 'registrationFormUrl') return true;
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password && !url.port
                && ((url.hostname === 'docs.google.com' && /^\/forms\/d\/(?:e\/)?[^/]+\/viewform\/?$/.test(url.pathname))
                    || (url.hostname === 'forms.gle' && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)));
        } catch { return false; }
    }));
}
