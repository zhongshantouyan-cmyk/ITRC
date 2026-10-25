// Firebase Admin — 驗證前端送來的 Google ID token，並以工具站的 RTDB `roles`
// 名單做授權。與 itrc-tools 的 itrc-auth.js 共用同一個 Firebase 專案 (itrc-workspace)
// 與同一份角色名單，達成「單一登入」。
//
// 未設定 FIREBASE_SERVICE_ACCOUNT 時本檔為 no-op：initFirebase() 回傳 false、
// verifyFirebaseToken() 會拋錯，middleware 便退回舊的密碼 JWT（過渡期不斷線）。
const admin = require('firebase-admin');

const DB_URL = 'https://itrc-workspace-default-rtdb.asia-southeast1.firebasedatabase.app';

// 救命索：這些信箱永遠視為顧問級（全權），不受 roles 名單影響，避免換屆鎖死。
const SUPER_ADMINS = (process.env.SUPER_ADMINS || 'zhongshantouyan@gmail.com')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

let initialized = false;
let rolesCache = {};
let rolesCacheAt = 0;
let rolesLoading;
const { roleFromRecords } = require('./role-policy');
const ROLES_TTL_MS = 30_000;

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

// A cold serverless instance must await the role source. Never serve a stale role
// after a refresh failure; the shared club recovery identity remains unchanged.
async function loadRoles() {
    if (rolesCacheAt && Date.now() - rolesCacheAt < ROLES_TTL_MS) return rolesCache;
    if (!rolesLoading) {
        rolesLoading = admin.database().ref('roles').once('value').then(snap => {
            rolesCache = snap.val() || {};
            rolesCacheAt = Date.now();
            return rolesCache;
        }).finally(() => { rolesLoading = undefined; });
    }
    return rolesLoading;
}

async function resolveRole(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return '';
    if (SUPER_ADMINS.includes(e)) return 'advisor';
    return roleFromRecords(await loadRoles(), e);
}

async function verifyFirebaseToken(token) {
    if (!initialized) throw new Error('firebase 未初始化');
    return admin.auth().verifyIdToken(token, true);
}

module.exports = { initFirebase, isInitialized, isSuperAdmin, resolveRole, verifyFirebaseToken };
