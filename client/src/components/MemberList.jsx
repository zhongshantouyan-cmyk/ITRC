import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

export default function MemberList({ members = [] }) {
    const ref = useRef(null);
    const isInView = useInView(ref, { once: true, margin: '-100px' });

    return (
        <section className="section" id="members" ref={ref}>
            <div className="container">
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.8 }}
                >
                    <h2 className="section-title">
                        <span className="section-title-accent">社團幹部</span>
                    </h2>
                    <div className="section-divider" />
                </motion.div>

                {members.length === 0 ? (
                    <div className="empty-state">
                        <h3>尚無成員資料</h3>
                        <p>管理員可至後台新增成員</p>
                    </div>
                ) : (
                    <div className="member-grid">
                        {members.map((member, idx) => (
                            <motion.div
                                key={member.id}
                                className="card member-card"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={isInView ? { opacity: 1, scale: 1 } : {}}
                                transition={{ duration: 0.5, delay: 0.05 * idx }}
                                whileHover={{ scale: 1.05 }}
                            >
                                <div className="member-avatar">
                                    {member.avatar_url ? (
                                        <img src={member.avatar_url} alt={member.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                                    ) : (
                                        member.name.charAt(0)
                                    )}
                                </div>
                                <div className="member-name">{member.name}</div>
                                {member.role && <div className="member-role">{member.role}</div>}
                                {member.department && <div className="member-dept">{member.department}</div>}
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
