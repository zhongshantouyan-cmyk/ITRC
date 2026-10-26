import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, resolveRole, googleLogin, logout as fbLogout } from '../firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);   // { uid, email, name, role }；role='' 代表已登入未授權
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let revision = 0;
        let active = true;
        const unsub = onAuthStateChanged(auth, async (u) => {
            const currentRevision = ++revision;
            setLoading(true);
            if (!u) {
                setUser(null);
                setLoading(false);
                return;
            }
            let role = '';
            try { role = u.emailVerified ? await resolveRole(u.email) : ''; } catch { /* An unavailable role source grants no access. */ }
            if (!active || currentRevision !== revision || auth.currentUser?.uid !== u.uid) return;
            setUser({
                uid: u.uid,
                email: u.email,
                name: u.displayName || u.email,
                role,
            });
            setLoading(false);
        });
        return () => { active = false; revision++; unsub(); };
    }, []);

    const login = () => googleLogin();
    const logout = () => fbLogout();
    const role = user?.role || '';

    return (
        <AuthContext.Provider value={{ user, role, loading, login, logout, isAdmin: !!role }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
