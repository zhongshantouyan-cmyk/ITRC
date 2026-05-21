import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api';
import Footer from '../components/Footer';

// Helper: extract YouTube video ID from various URL formats
function getYouTubeId(url) {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

export default function ActivityRecordsPage() {
    const [activities, setActivities] = useState([]);
    const [semesters, setSemesters] = useState([]);
    const [activeSemester, setActiveSemester] = useState(null);
    const [loading, setLoading] = useState(true);

    // Fetch available semesters
    useEffect(() => {
        api.get('/activities/semesters', { params: { type: 'record' } }).then(res => {
            const sems = res.data.length > 0 ? res.data : ['114-1'];
            setSemesters(sems);
            setActiveSemester(sems[0]);
        }).catch(() => {
            setSemesters(['114-1']);
            setActiveSemester('114-1');
        });
    }, []);

    // Fetch activities when semester changes
    useEffect(() => {
        if (!activeSemester) return;
        setLoading(true);
        api.get('/activities', { params: { type: 'record', semester: activeSemester } }).then(res => {
            setActivities(res.data);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [activeSemester]);

    const semesterLabel = (sem) => {
        const [year, part] = sem.split('-');
        return `${year} 學年度 第${part === '1' ? '上' : '下'}學期`;
    };

    return (
        <>
            <div className="page-header">
                <div className="container">
                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6 }}
                    >
                        <span className="section-title-accent">活動紀錄</span>
                    </motion.h1>
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
                        社團活動的精彩回顧
                    </motion.p>
                </div>
            </div>

            <section className="section">
                <div className="container">
                    {/* Semester Tabs */}
                    {semesters.length > 0 && (
                        <div className="semester-tabs">
                            {semesters.map(sem => (
                                <button
                                    key={sem}
                                    className={`semester-tab ${activeSemester === sem ? 'active' : ''}`}
                                    onClick={() => setActiveSemester(sem)}
                                >
                                    {semesterLabel(sem)}
                                </button>
                            ))}
                        </div>
                    )}

                    {loading && <div className="loading-spinner" />}
                    {!loading && activities.length === 0 && (
                        <div className="empty-state">
                            <h3>尚無活動紀錄</h3>
                            <p>管理員可至後台新增活動紀錄</p>
                        </div>
                    )}

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeSemester}
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.3 }}
                        >
                            <div className="timeline">
                                {activities.map((activity, idx) => (
                                    <motion.div
                                        key={activity.id}
                                        className="timeline-item"
                                        initial={{ opacity: 0, x: -30 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.1 * idx }}
                                    >
                                        <div className="timeline-dot" />
                                        {activity.date && <div className="timeline-date">{activity.date}</div>}
                                        <div className="timeline-content">
                                            <h3>{activity.title}</h3>
                                            {activity.description && <p>{activity.description}</p>}
                                            {activity.image_url && (
                                                <img src={activity.image_url} alt={activity.title}
                                                    style={{ width: '100%', borderRadius: 8, marginTop: 12, maxHeight: 300, objectFit: 'cover' }} />
                                            )}
                                            {/* YouTube Video Embed */}
                                            {activity.video_url && getYouTubeId(activity.video_url) && (
                                                <div className="video-embed">
                                                    <iframe
                                                        src={`https://www.youtube.com/embed/${getYouTubeId(activity.video_url)}`}
                                                        title={activity.title}
                                                        frameBorder="0"
                                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                        allowFullScreen
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </motion.div>
                    </AnimatePresence>
                </div>
            </section>
            <Footer />
        </>
    );
}
