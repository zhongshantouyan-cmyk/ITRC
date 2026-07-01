import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
    const { user, isAdmin, loading, login, logout } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!loading && user && isAdmin) navigate('/admin');
    }, [loading, user, isAdmin, navigate]);

    return (
        <div className="login-page">
            <div className="login-card">
                <h2><span className="section-title-accent">管理員登入</span></h2>
                <p className="login-subtitle">ITRC Content Management System</p>

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
                        onClick={login}
                        disabled={loading}
                    >
                        {loading ? '載入中…' : '使用 Google 登入'}
                    </button>
                )}
            </div>
        </div>
    );
}
