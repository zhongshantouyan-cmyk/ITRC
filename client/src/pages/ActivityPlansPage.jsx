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

export default function ActivityPlansPage() {
    const [activities, setActivities] = useState([]);
    const [semesters, setSemesters] = useState([]);
    const [activeSemester, setActiveSemester] = useState(null);
    const [loading, setLoading] = useState(true);

    // Fetch available semesters
    useEffect(() => {
        api.get('/activities/semesters', { params: { type: 'plan' } }).then(res => {
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
        api.get('/activities', { params: { type: 'plan', semester: activeSemester } }).then(res => {
            setActivities(res.data);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, [activeSemester]);

    const semesterLabel = (sem) => {
        const [year, part] = sem.split('-');
        return `${year} 學年度 第${part === '1' ? '一' : '二'}學期`;
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
                        <span className="section-title-accent">活動規劃</span>
                    </motion.h1>
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
                        本學期活動與課程安排
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
                            <h3>目前沒有規劃中的活動</h3>
                            <p>管理員可至後台新增活動規劃</p>
                        </div>
                    )}

                    <AnimatePresence mode="wait">
                        {!loading && activities.length > 0 && (
                            <motion.div
                                key={activeSemester}
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -15 }}
                                transition={{ duration: 0.3 }}
                            >
                                <div className="plans-table-wrapper">
                                    <table className="plans-table">
                                        <thead>
                                            <tr>
                                                <th>日期</th>
                                                <th>主題</th>
                                                <th>主講人</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {activities.map((activity, idx) => (
                                                <motion.tr
                                                    key={activity.id}
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    transition={{ delay: 0.03 * idx }}
                                                >
                                                    <td className="plans-date">{activity.date || ''}</td>
                                                    <td className="plans-title">
                                                        {activity.title}
                                                        {activity.description && (
                                                            <span className="plans-desc">{activity.description}</span>
                                                        )}
                                                        {/* YouTube Video Embed */}
                                                        {activity.video_url && getYouTubeId(activity.video_url) && (
                                                            <div className="video-embed video-embed-sm">
                                                                <iframe
                                                                    src={`https://www.youtube.com/embed/${getYouTubeId(activity.video_url)}`}
                                                                    title={activity.title}
                                                                    frameBorder="0"
                                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                                    allowFullScreen
                                                                />
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="plans-speaker">{activity.speaker || ''}</td>
                                                </motion.tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </section>
            <Footer />
        </>
    );
}
