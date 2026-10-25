import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
    const { user, isAdmin, loading, login, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [signingIn, setSigningIn] = useState(false);
    const [loginError, setLoginError] = useState('');
    const requestedPath = location.state?.from;
    const destination = typeof requestedPath === 'string' && /^\/(ops|admin)(\?|$)/.test(requestedPath)
        ? requestedPath : '/admin';

    useEffect(() => {
        if (!loading && user && isAdmin) navigate(destination, { replace: true });
    }, [loading, user, isAdmin, navigate, destination]);

    const handleLogin = async () => {
        setLoginError('');
        setSigningIn(true);
        try {
            await login();
        } catch (error) {
            if (error?.code === 'auth/unauthorized-domain') {
                setLoginError('這個網址尚未完成 Google 登入設定，請聯絡管理員完成設定後再試。');
            } else if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') {
                setLoginError('登入尚未完成。請再按一次「使用 Google 登入」並完成登入流程。');
            } else {
                setLoginError('Google 登入未完成，請稍後再試；若仍無法登入，請聯絡管理員。');
            }
        } finally {
            setSigningIn(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-card">
                <h2><span className="section-title-accent">管理員登入</span></h2>
                <p className="login-subtitle">ITRC Content Management System</p>

                {loginError && <p className="login-error" role="alert">{loginError}</p>}

                {user && !isAdmin ? (
                    <div className="login-error">
                        此帳號（{user.email}）尚未被授權。<br />
                        請聯絡社長／顧問在「幹部與權限」頁面加入你的角色後再登入。
                        <button
                            className="btn"
                            style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
                            onClick={logout}
                        >
                            登出
                        </button>
                    </div>
                ) : (
                    <button
                        className="btn btn-primary"
                        style={{ width: '100%', justifyContent: 'center' }}
                        onClick={handleLogin}
                        disabled={loading || signingIn}
                    >
                        {loading ? '載入中…' : signingIn ? '登入中…' : '使用 Google 登入'}
                    </button>
                )}
            </div>
        </div>
    );
}
