// 與工具站 itrc-tools 的 itrc-auth.js 共用同一個 Firebase 專案 (itrc-workspace)
// 與同一份 RTDB `roles` 角色名單，達成「單一登入」。
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getDatabase, ref, get } from 'firebase/database';

// 皆為公開的用戶端設定（非機密），與 itrc-auth.js 的 CFG 相同。
const firebaseConfig = {
    apiKey: 'AIzaSyBG41luYP0eyt9UUeuS0lybKTqWYi1GpLc',
    authDomain: 'itrc-workspace.firebaseapp.com',
    databaseURL: 'https://itrc-workspace-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'itrc-workspace',
    storageBucket: 'itrc-workspace.firebasestorage.app',
    messagingSenderId: '462903407211',
    appId: '1:462903407211:web:9cc9217dcef3c97cf2372e',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// 救命索：這些信箱一律視為顧問級，不受 roles 名單影響（與 itrc-auth.js 一致）。
const SUPER_ADMINS = ['zhongshantouyan@gmail.com', 'hades60414@gmail.com'];

// 以 email 比對 roles 名單，回傳角色（chair/advisor/treasurer/officer），未授權回 ''。
export async function resolveRole(email) {
    const e = (email || '').toLowerCase();
    if (!e) return '';
    if (SUPER_ADMINS.includes(e)) return 'advisor';
    try {
        const snap = await get(ref(db, 'roles'));
        const list = snap.val() || {};
        let role = '';
        Object.keys(list).forEach((k) => {
            const r = list[k];
            if (r && r.email && String(r.email).toLowerCase() === e) role = r.role || '';
        });
        return role;
    } catch {
        return '';
    }
}

export function googleLogin() {
    return signInWithPopup(auth, new GoogleAuthProvider());
}

export function logout() {
    return signOut(auth);
}
