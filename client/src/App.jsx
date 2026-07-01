import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import AchievementsPage from './pages/AchievementsPage';
import ActivityRecordsPage from './pages/ActivityRecordsPage';
import ActivityPlansPage from './pages/ActivityPlansPage';
import ExperiencesPage from './pages/ExperiencesPage';
import ResourcesPage from './pages/ResourcesPage';
import LoginPage from './pages/LoginPage';
import AdminPage from './pages/AdminPage';
import { useAuth } from './context/AuthContext';

function ProtectedRoute({ children }) {
    const { user, isAdmin, loading, logout } = useAuth();
    if (loading) return <div className="login-page"><div className="login-card">載入中…</div></div>;
    if (!user) return <Navigate to="/login" replace />;
    if (!isAdmin) return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-error">
                    此帳號（{user.email}）尚未被授權存取管理後台。<br />
                    請聯絡社長／顧問在「幹部與權限」頁面加入你的角色。
                    <button
                        className="btn"
                        style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
                        onClick={logout}
                    >
                        登出
                    </button>
                </div>
            </div>
        </div>
    );
    return children;
}

export default function App() {
    return (
        <>
            <Navbar />
            <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/achievements" element={<AchievementsPage />} />
                <Route path="/activities" element={<ActivityRecordsPage />} />
                <Route path="/plans" element={<ActivityPlansPage />} />
                <Route path="/experiences" element={<ExperiencesPage />} />
                <Route path="/resources" element={<ResourcesPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
            </Routes>
        </>
    );
}
