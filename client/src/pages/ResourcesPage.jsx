import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../api';

/* SVG icon components for online resources */
const IconChart = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
);
const IconTrendUp = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
);
const IconGlobe = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
);
const IconAward = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="7" /><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
    </svg>
);
const IconFileText = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
);

const ICON_MAP = {
    IconChart,
    IconTrendUp,
    IconGlobe,
    IconAward,
    IconFileText
};

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { staggerChildren: 0.1 }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
};

export default function ResourcesPage() {
    const [onlineResources, setOnlineResources] = useState([]);
    const [offlineResources, setOfflineResources] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchResources = async () => {
            try {
                const res = await api.get('/resources');
                setOnlineResources(res.data.online || []);
                setOfflineResources(res.data.offline || []);
            } catch (err) {
                console.error('Failed to fetch resources:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchResources();
    }, []);

    if (loading) {
        return (
            <div className="loading-spinner" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}></div>
        );
    }


    return (
        <>
            {/* Hero Banner */}
            <section className="resources-hero">
                <div className="resources-hero-overlay" />
                <motion.div
                    className="resources-hero-content"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                >
                    <h1>學習資源</h1>
                    <p>精選線上與線下資源，助你建構投資知識體系</p>
                </motion.div>
            </section>

            {/* Online Resources */}
            <section className="resources-section">
                <motion.div
                    className="resources-section-header"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6 }}
                >
                    <span className="resources-section-badge">ONLINE</span>
                    <h2>線上學習資源 <span className="resources-en">Online Resources</span></h2>
                    <p className="resources-section-desc">常用的投資研究與數據查詢平台</p>
                </motion.div>

                <motion.div
                    className="online-resources-grid"
                    variants={containerVariants}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                >
                    {onlineResources.map((resource, idx) => {
                        const IconComponent = ICON_MAP[resource.icon] || IconGlobe;
                        return (
                        <motion.a
                            key={resource.id || idx}
                            href={resource.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="online-resource-card"
                            variants={itemVariants}
                            whileHover={{ y: -6, boxShadow: '0 12px 40px rgba(0,0,0,0.12)' }}
                        >
                            <div className="online-resource-icon" style={{ background: (resource.color || '#1565c0') + '15', color: resource.color || '#1565c0' }}>
                                <IconComponent />
                            </div>
                            <div className="online-resource-body">
                                <h3>{resource.name}</h3>
                                <span className="online-resource-en">{resource.name_en || resource.nameEn}</span>
                                <p>{resource.description}</p>
                            </div>
                            <div className="online-resource-arrow">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                                </svg>
                            </div>
                        </motion.a>
                        );
                    })}
                </motion.div>
            </section>

            {/* Offline Resources */}
            <section className="resources-section resources-section-alt">
                <motion.div
                    className="resources-section-header"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6 }}
                >
                    <span className="resources-section-badge offline-badge">OFFLINE</span>
                    <h2>線下學習資源 <span className="resources-en">Offline Resources</span></h2>
                    <p className="resources-section-desc">社團推薦必讀的投資經典書籍</p>
                </motion.div>

                <motion.div
                    className="offline-resources-grid"
                    variants={containerVariants}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                >
                    {offlineResources.map((book, idx) => (
                        <motion.div
                            key={book.id || idx}
                            className="book-card"
                            variants={itemVariants}
                            whileHover={{ y: -8 }}
                        >
                            <div className="book-cover-wrapper">
                                <div className="book-cover-shadow" />
                                {book.cover_url ? (
                                    <img
                                        src={book.cover_url}
                                        alt={book.title}
                                        className="book-cover-img"
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.nextSibling.style.display = 'flex';
                                        }}
                                    />
                                ) : (
                                    <img src="" style={{display:'none'}} alt="" />
                                )}
                                <div className="book-cover-fallback" style={{ display: book.cover_url ? 'none' : 'flex' }}>
                                    <svg className="book-cover-fallback-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                                    </svg>
                                    <span className="book-cover-title">{book.title}</span>
                                </div>
                            </div>
                            <div className="book-info">
                                <h3 className="book-title">{book.title}</h3>
                                <span className="book-title-en">{book.title_en || book.titleEn}</span>
                                <span className="book-author">{book.author}</span>
                                <p className="book-desc">{book.description}</p>
                            </div>
                        </motion.div>
                    ))}
                </motion.div>
            </section>
        </>
    );
}
