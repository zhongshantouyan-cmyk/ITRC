import axios from 'axios';
import { auth } from './firebase';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api',
});

// 帶上 Firebase ID token；過渡期若尚未以 Firebase 登入，退回舊的 localStorage token。
api.interceptors.request.use(async (config) => {
    const current = auth.currentUser;
    if (current) {
        const token = await current.getIdToken();
        config.headers.Authorization = `Bearer ${token}`;
    } else {
        const legacy = localStorage.getItem('itrc_token');
        if (legacy) config.headers.Authorization = `Bearer ${legacy}`;
    }
    return config;
});

export default api;
