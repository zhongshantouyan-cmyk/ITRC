import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import SearchModal from './SearchModal';

export default function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const { isAdmin, logout } = useAuth();

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 50);
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        setMenuOpen(false);
    }, [location]);

    const scrollToFooter = useCallback((e) => {
        e.preventDefault();
        if (location.pathname !== '/') {
            navigate('/');
            setTimeout(() => {
                document.querySelector('.footer')?.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        } else {
            document.querySelector('.footer')?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [location, navigate]);

    const isActive = (path) => location.pathname === path ? 'active' : '';
    const isOpsRoute = location.pathname === '/ops' || location.pathname === '/ops-demo';
    const usesLightNavbar = isOpsRoute || location.pathname === '/login';

    return (
        <>
            <nav className={`navbar ${scrolled || usesLightNavbar ? 'scrolled' : ''} ${usesLightNavbar ? 'navbar-ops' : ''}`}>
                <div className="navbar-inner">
                    <Link to="/" className="navbar-logo">
                        <span>ITRC</span>
                    </Link>

                    <button className="hamburger" aria-label={menuOpen ? '關閉主選單' : '開啟主選單'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
                        <span></span>
                        <span></span>
                        <span></span>
                    </button>

                    <ul className={`navbar-links ${menuOpen ? 'open' : ''}`}>
                        <li><Link to="/" className={isActive('/')}>首頁</Link></li>
                        <li><a href="#footer" onClick={scrollToFooter}>關於我們</a></li>
                        <li><Link to="/achievements" className={isActive('/achievements')}>成果發表</Link></li>
                        <li><Link to="/activities" className={isActive('/activities')}>活動紀錄</Link></li>
                        <li><Link to="/plans" className={isActive('/plans')}>活動規劃</Link></li>
                        <li><Link to="/resources" className={isActive('/resources')}>學習資源</Link></li>
                        <li><Link to="/experiences" className={isActive('/experiences')}>參與心得</Link></li>
                        {isAdmin && (
                            <>
                                <li><Link to="/ops" className={isActive('/ops')}>營運工作台</Link></li>
                                <li><Link to="/admin" className={isActive('/admin')}>管理後台</Link></li>
                                <li><button onClick={logout} style={{ color: usesLightNavbar ? '#9a4d43' : '#fc8181' }}>登出</button></li>
                            </>
                        )}

                        <li>
                            <button className="search-btn" onClick={() => setSearchOpen(true)}>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                </svg>
                            </button>
                        </li>
                    </ul>
                </div>
            </nav>

            {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
        </>
    );
}
