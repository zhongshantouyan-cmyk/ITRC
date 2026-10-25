import axios from 'axios';
import { auth } from './firebase';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api',
});

// 工作台可單獨使用同來源代理；官網 CMS 仍沿用原本的 API 設定。
export const opsApi = axios.create({
    baseURL: import.meta.env.VITE_OPS_API_URL || import.meta.env.VITE_API_URL || '/api',
});

// 帶上 Firebase ID token；過渡期若尚未以 Firebase 登入，退回舊的 localStorage token。
const attachAuth = async (config) => {
    const current = auth.currentUser;
    if (current) {
        const token = await current.getIdToken();
        config.headers.Authorization = `Bearer ${token}`;
    } else {
        const legacy = localStorage.getItem('itrc_token');
        if (legacy) config.headers.Authorization = `Bearer ${legacy}`;
    }
    return config;
};

api.interceptors.request.use(attachAuth);
opsApi.interceptors.request.use(attachAuth);

export default api;
