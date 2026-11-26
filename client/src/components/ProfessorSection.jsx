import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

export default function ProfessorSection() {
    const ref = useRef(null);
    const isInView = useInView(ref, { once: true, margin: '-100px' });

    return (
        <section className="section section-alt" id="professor" ref={ref}>
            <div className="container">
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.8 }}
                >
                    <h2 className="section-title">
                        <span className="section-title-accent">指導教授</span>
                    </h2>
                    <div className="section-divider" />
                </motion.div>

                <motion.div
                    className="professor-card"
                    initial={{ opacity: 0, y: 30 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.6, delay: 0.2 }}
                >
                    <div className="professor-photo">
                        <img src="https://finance.nsysu.edu.tw/files/member/cache.1505bc44606cf4e57c4fc20ef4028bf1.jpg.w334_h500.jpg" alt="封之遠 副教授" loading="lazy" referrerPolicy="no-referrer" />
                    </div>
                    <div className="professor-info">
                        <h3 className="professor-name">
                            <a href="https://finance.nsysu.edu.tw/front/FACULTY_MEMBERS/member.php?ID=ad7df3427d693df9827a9c47b86d6a15cfb359d7e96f2641ff793f8d6561be69&PID=15" target="_blank" rel="noopener noreferrer">
                                封之遠 副教授
                            </a>
                        </h3>
                        <div className="professor-affiliation">
                            國立中山大學 管理學院 財務管理學系
                        </div>

                        <div className="professor-details">
                            <div className="professor-detail-group">
                                <div className="professor-detail-item">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="18" height="18">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                                    </svg>
                                    <a href="mailto:andy_fong0920@msn.com">andy_fong0920@msn.com</a>
                                </div>
                                <div className="professor-detail-item">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="18" height="18">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                                    </svg>
                                    <span>07-525-2000 ext. 4819</span>
                                </div>
                            </div>

                            <div className="professor-detail-group">
                                <h4>學歷</h4>
                                <p>國立成功大學 財務金融研究所 博士</p>
                            </div>

                            <div className="professor-detail-group">
                                <h4>研究領域</h4>
                                <div className="professor-tags">
                                    <span className="professor-tag">企業社會責任</span>
                                    <span className="professor-tag">碳排放與碳權交易</span>
                                    <span className="professor-tag">氣候風險</span>
                                    <span className="professor-tag">永續報告準則</span>
                                    <span className="professor-tag">財報與審計品質</span>
                                </div>
                            </div>

                            <div className="professor-detail-group">
                                <h4>經歷</h4>
                                <ul className="professor-experience">
                                    <li>國立中山大學 財務管理學系 副教授（2023 年至今）</li>
                                    <li>國立中山大學 財務管理學系 助理教授（2020–2023 年）</li>
                                    <li>研究室：管理學院 CM4111</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}
