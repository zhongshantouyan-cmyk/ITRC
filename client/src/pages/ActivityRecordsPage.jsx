import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api';
import Footer from '../components/Footer';

// Helper: extract YouTube video ID from various URL formats
function getYouTubeId(url) {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// Parse markdown-style description to extract YouTube links, presentation links, and plain text
function parseDescription(description) {
    if (!description) return { text: '', youtubeLinks: [], slideLinks: [], otherLinks: [] };

    // Match markdown links: [label](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const youtubeLinks = [];
    const slideLinks = [];
    const otherLinks = [];
    let match;

    while ((match = linkRegex.exec(description)) !== null) {
        const label = match[1];
        const url = match[2];
        const ytId = getYouTubeId(url);

        if (ytId) {
            youtubeLinks.push({ label, url, videoId: ytId });
        } else if (
            label.includes('簡報') ||
            label.includes('企劃書') ||
            label.includes('投影片') ||
            label.includes('PPT') ||
            label.includes('slides')
        ) {
            slideLinks.push({ label, url });
        } else {
            otherLinks.push({ label, url });
        }
    }

    // Remove all markdown links from text to get the plain description
    const plainText = description
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '')
        .replace(/\s*\|\s*/g, '')  // remove pipe separators
        .replace(/\n{2,}/g, '\n')
        .trim();

    return { text: plainText, youtubeLinks, slideLinks, otherLinks };
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
                                {activities.map((activity, idx) => {
                                    const parsed = parseDescription(activity.description);
                                    // Also check the dedicated video_url field
                                    const dedicatedVideoId = getYouTubeId(activity.video_url);

                                    return (
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

                                                {/* Plain text description */}
                                                {parsed.text && <p>{parsed.text}</p>}

                                                {/* Action buttons row: slides + other links */}
                                                {(parsed.slideLinks.length > 0 || parsed.otherLinks.length > 0) && (
                                                    <div className="activity-links">
                                                        {parsed.slideLinks.map((link, i) => (
                                                            <a
                                                                key={`slide-${i}`}
                                                                href={link.url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="btn btn-slide"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M2 3h20v14H2z" />
                                                                    <path d="M12 17v4" />
                                                                    <path d="M8 21h8" />
                                                                </svg>
                                                                簡報
                                                            </a>
                                                        ))}
                                                        {parsed.otherLinks.map((link, i) => (
                                                            <a
                                                                key={`other-${i}`}
                                                                href={link.url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="btn btn-link-outline"
                                                            >
                                                                {link.label}
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Activity image */}
                                                {activity.image_url && (
                                                    <img src={activity.image_url} alt={activity.title}
                                                        style={{ width: '100%', borderRadius: 8, marginTop: 12, maxHeight: 300, objectFit: 'cover' }} />
                                                )}

                                                {/* YouTube Video Embeds from description */}
                                                {parsed.youtubeLinks.map((yt, i) => (
                                                    <div key={`yt-${i}`} className="video-embed">
                                                        <iframe
                                                            src={`https://www.youtube.com/embed/${yt.videoId}`}
                                                            title={yt.label || activity.title}
                                                            frameBorder="0"
                                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                            allowFullScreen
                                                        />
                                                    </div>
                                                ))}

                                                {/* Dedicated video_url embed (if not already shown from description) */}
                                                {dedicatedVideoId && !parsed.youtubeLinks.some(yt => yt.videoId === dedicatedVideoId) && (
                                                    <div className="video-embed">
                                                        <iframe
                                                            src={`https://www.youtube.com/embed/${dedicatedVideoId}`}
                                                            title={activity.title}
                                                            frameBorder="0"
                                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                                            allowFullScreen
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </motion.div>
                    </AnimatePresence>
                </div>
            </section>
            <Footer />
        </>
    );
}
