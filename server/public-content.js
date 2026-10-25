// Public CMS data has a deliberately smaller schema than internal operations.
const COURSE_INFO_FIELDS = Object.freeze([
    'time', 'location', 'coordinators', 'email', 'ig', 'professor', 'registrationFormUrl',
]);
const PUBLIC_MEMBER_COLUMNS = Object.freeze([
    'id', 'name', 'role', 'department', 'year', 'avatar_url', 'order_num',
]);
const WITHDRAWN_RESPONSE_SHEET_ID = '1V-wopC1i-6GFNLFsWs2jSKiBggqvZQ0HiK9bORPIRBE';

function isRegistrationFormUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
        return (url.hostname === 'docs.google.com' && /^\/forms\/d\/(?:e\/)?[^/]+\/viewform\/?$/.test(url.pathname))
            || (url.hostname === 'forms.gle' && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname));
    } catch { return false; }
}

function hasSpreadsheetLink(value) {
    return /(?:https?:\/\/)?docs\.google\.com\/spreadsheets\//i.test(value)
        || value.includes(WITHDRAWN_RESPONSE_SHEET_ID);
}

function cleanCourseInfo(content, { strict = false } = {}) {
    let data;
    try { data = typeof content === 'string' ? JSON.parse(content) : content; }
    catch { if (strict) throw new Error('課程資訊必須是有效的 JSON 物件。'); return {}; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        if (strict) throw new Error('課程資訊必須是 JSON 物件。');
        return {};
    }
    const clean = {};
    for (const [sourceKey, value] of Object.entries(data)) {
        const key = sourceKey === '入社報名' ? 'registrationFormUrl' : sourceKey;
        if (!COURSE_INFO_FIELDS.includes(key)) {
            if (strict) throw new Error(`課程資訊不接受「${key}」欄位；報名入口請使用 registrationFormUrl，內部名單請保留在工作台。`);
            continue;
        }
        if (typeof value !== 'string' || hasSpreadsheetLink(value)) {
            if (strict) throw new Error(`「${key}」必須是公開文字，不可放入回覆試算表連結。`);
            continue;
        }
        if (key === 'registrationFormUrl' && !isRegistrationFormUrl(value)) {
            if (strict) throw new Error('報名入口必須是 Google Forms 的填寫網址，不能使用編輯頁或回覆試算表。');
            continue;
        }
        clean[key] = value;
    }
    return clean;
}

function redactWithdrawnResponseUrl(value) {
    return String(value ?? '')
        .replace(new RegExp(`https?:\\/\\/[^\\s"'<>]*${WITHDRAWN_RESPONSE_SHEET_ID}[^\\s"'<>]*`, 'gi'), '')
        .replaceAll(WITHDRAWN_RESPONSE_SHEET_ID, '');
}

function publicSection(row) {
    if (!row) return row;
    return {
        id: row.id, key: row.key, title: redactWithdrawnResponseUrl(row.title),
        content: row.key === 'course_info'
            ? JSON.stringify(cleanCourseInfo(row.content))
            : redactWithdrawnResponseUrl(row.content),
        updated_at: row.updated_at,
    };
}

function publicSectionSearchRows(rows, query) {
    const needle = String(query).toLocaleLowerCase();
    return rows.map(row => {
        const section = publicSection({ key: row.id, title: row.title, content: row.snippet });
        return { type: 'section', id: row.id, title: section.title, snippet: section.content };
    }).filter(row => `${row.title} ${row.snippet}`.toLocaleLowerCase().includes(needle));
}

function validateSectionContent(key, content) {
    if (typeof content !== 'string') throw new Error('頁面內容必須是文字。');
    if (content.includes(WITHDRAWN_RESPONSE_SHEET_ID)) throw new Error('這個社員回覆表不能放在公開頁面；請改用表單填寫網址。');
    return key === 'course_info' ? JSON.stringify(cleanCourseInfo(content, { strict: true })) : content;
}

module.exports = { COURSE_INFO_FIELDS, PUBLIC_MEMBER_COLUMNS, cleanCourseInfo, isRegistrationFormUrl,
    publicSection, publicSectionSearchRows, validateSectionContent };
