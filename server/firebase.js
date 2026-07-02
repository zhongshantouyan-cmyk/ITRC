// Firebase Admin — 驗證前端送來的 Google ID token，並以工具站的 RTDB `roles`
// 名單做授權。與 itrc-tools 的 itrc-auth.js 共用同一個 Firebase 專案 (itrc-workspace)
// 與同一份角色名單，達成「單一登入」。
//
// 未設定 FIREBASE_SERVICE_ACCOUNT 時本檔為 no-op：initFirebase() 回傳 false、
// verifyFirebaseToken() 會拋錯，middleware 便退回舊的密碼 JWT（過渡期不斷線）。
const admin = require('firebase-admin');

const DB_URL = 'https://itrc-workspace-default-rtdb.asia-southeast1.firebasedatabase.app';

// 救命索：這些信箱永遠視為顧問級（全權），不受 roles 名單影響，避免換屆鎖死。
const SUPER_ADMINS = (process.env.SUPER_ADMINS || 'zhongshantouyan@gmail.com,hades60414@gmail.com')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

let initialized = false;
let rolesCache = {};
let rolesCacheAt = 0;
const ROLES_TTL_MS = 60 * 1000; // 角色名單快取 60 秒（serverless 冷啟動時即時抓一次）

function initFirebase() {
    if (initialized) return true;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        console.warn('[firebase] FIREBASE_SERVICE_ACCOUNT 未設定 — Firebase 登入停用，只接受舊 JWT');
        return false;
    }
    let serviceAccount;
    try {
        serviceAccount = JSON.parse(raw);
    } catch (e) {
        console.error('[firebase] FIREBASE_SERVICE_ACCOUNT 不是合法 JSON：', e.message);
        return false;
    }
    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: DB_URL,
        });
    } catch (e) {
        // 憑證欄位損壞（如 private_key 被截斷）時 cert() 會同步拋錯；
        // 降級為只接受舊 JWT，而不是讓整個後端 crash（守住 soft-no-op 承諾）。
        console.error('[firebase] admin 初始化失敗（服務帳號憑證無效？）：', e.message);
        return false;
    }
    initialized = true;
    console.log('[firebase] admin 已初始化，專案 =', serviceAccount.project_id);
    return true;
}

function isInitialized() {
    return initialized;
}

function isSuperAdmin(email) {
    return SUPER_ADMINS.includes((email || '').toLowerCase());
}

// 讀取 roles 名單，帶 60 秒 TTL 快取。serverless 冷啟動時第一次即時打一次 RTDB，
// 之後同一個溫實例的請求走快取。取代原本常駐的 .on('value') 監聽 —— 常駐監聽在
// 冷啟動可能還沒回來就被查詢，導致非 super-admin 誤判 403。
async function loadRoles() {
    const now = Date.now();
    if (rolesCacheAt && now - rolesCacheAt < ROLES_TTL_MS) return rolesCache;
    const snap = await admin.database().ref('roles').once('value');
    rolesCache = snap.val() || {};
    rolesCacheAt = now;
    return rolesCache;
}

// 以 email 比對 roles 名單，回傳角色字串（chair/advisor/treasurer/officer），
// 找不到或未授權回傳 ''。SUPER_ADMINS 先短路為 advisor。與 itrc-auth.js 邏輯一致。
async function resolveRole(email) {
    const e = (email || '').toLowerCase();
    if (!e) return '';
    if (SUPER_ADMINS.includes(e)) return 'advisor';
    const list = await loadRoles();
    let role = '';
    Object.keys(list).forEach((k) => {
        const r = list[k];
        if (r && r.email && String(r.email).toLowerCase() === e) role = r.role || '';
    });
    return role;
}

async function verifyFirebaseToken(token) {
    if (!initialized) throw new Error('firebase 未初始化');
    return admin.auth().verifyIdToken(token);
}

module.exports = { initFirebase, isInitialized, isSuperAdmin, resolveRole, verifyFirebaseToken };
