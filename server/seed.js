const db = require('./db');

console.log('Seeding database...');
async function seed() {
    console.log('Waiting for database to initialize...');
    // Give initDB a moment to run from db.js (in a real app, we'd export a ready promise, but this simple delay works for the seed script)
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
        console.log('Starting seed process...');

        // Default Sections
        const existingSections = await db.execute('SELECT COUNT(*) as count FROM sections');
        if (existingSections.rows[0].count === 0) {
            const sections = [
                {
                    key: 'hero_title',
                    title: '首頁大標題',
                    content: '中山投研'
                },
                {
                    key: 'hero_subtitle',
                    title: '首頁副標題',
                    content: 'NSYSU Investment & Trading Research Club - 系統化課程規劃與實戰操作'
                },
                {
                    key: 'course_intro',
                    title: '課程簡介',
                    content: '中山投研社透過系統化課程、案例討論與期末競賽，結合理論與市場實務，提升成員投資研究與理財規劃能力，並藉由師資指導、資源共享與團隊合作，培養金融領域核心競爭力。'
                },
                {
                    key: 'course_info',
                    title: '課程資訊 Info.',
                    content: JSON.stringify({
                        time: '每週五 18:00 - 21:00',
                        location: '管理學院 CM1037',
                        coordinators: '張大恒、李沁彤、許筠采',
                        email: 'zhongshantouyan@gmail.com',
                        ig: 'nsysu_itrc'
                    })
                }
            ];

            for (const s of sections) {
                await db.execute({
                    sql: 'INSERT INTO sections (key, title, content) VALUES (?, ?, ?)',
                    args: [s.key, s.title, s.content]
                });
            }
            console.log('✓ Default sections seeded');
        } else {
            console.log('⊘ Sections already exist');
        }

        // Default Achievements
        const existingAchievements = await db.execute('SELECT COUNT(*) as count FROM achievements');
        if (existingAchievements.rows[0].count === 0) {
            await db.execute({
                sql: "INSERT INTO achievements (semester, title, category, order_num) VALUES ('113-1', '全國投資競賽 第一名', '比賽', 1)",
                args: []
            });
            console.log('✓ Default achievements seeded');
        } else {
            console.log('⊘ Achievements already exist');
        }

        // Team Members
        const existingMembers = await db.execute('SELECT COUNT(*) as count FROM members');
        if (existingMembers.rows[0].count === 0) {
            const members = [
                { name: '張大恒', role: '社長', department: '機電系大四' },
                { name: '李沁彤', role: '副社長', department: '財管系大四' },
                { name: '許筠采', role: '副社長', department: '財管系大四' },
                { name: '盧威宇', role: '公關長', department: '財管系大三' },
                { name: '吳品霆', role: '總務長', department: '財管系大三' },
                { name: '楊紫翎', role: '行銷長', department: '行傳所碩一' }
            ];

            for (const [index, m] of members.entries()) {
                await db.execute({
                    sql: 'INSERT INTO members (name, role, department, order_num) VALUES (?, ?, ?, ?)',
                    args: [m.name, m.role, m.department, index + 1]
                });
            }
            console.log('✓ Default members seeded');
        } else {
            console.log('⊘ Members already exist');
        }

        // Activity Plans (from screenshot)
        const activityPlans = [
            { type: 'plan', semester: '114-1', date: '114年09月26日(五)', title: '社課介紹+破冰遊戲', speaker: '張大恒 社長' },
            { type: 'plan', semester: '114-1', date: '114年10月03日(五)', title: '投資與交易的本質', speaker: '張大恒 社長' },
            { type: 'plan', semester: '114-1', date: '114年10月10日 (五)', title: '國慶放假', speaker: '', description: '國慶放假' },
            { type: 'plan', semester: '114-1', date: '114年10月17日(五)', title: '總體經濟指標', speaker: '黃泓睿 學長' },
            { type: 'plan', semester: '114-1', date: '114年10月24日(五)', title: '產業分析入門與實務', speaker: '黃鑠恩 講師' },
            { type: 'plan', semester: '114-1', date: '114年10月31日(五)', title: '財務報表分析入門與實務', speaker: '張大恒 社長' },
            { type: 'plan', semester: '114-1', date: '114年11月07日(五)', title: '期中考週停課一次', speaker: '', description: '期中考週' },
            { type: 'plan', semester: '114-1', date: '114年11月14日(五)', title: '技術分析入門與實務', speaker: '林家佑 學長' },
            { type: 'plan', semester: '114-1', date: '114年11月21日(五)', title: '期末報告準備', speaker: '全體幹部' },
            { type: 'plan', semester: '114-1', date: '114年11月28日(五)', title: '期末報告發表暨結業式', speaker: '全體幹部' },
            { type: 'plan', semester: '114-1', date: '114年12月05日(五)', title: '企業參訪', speaker: '群益金鼎證券' }
        ];

        const existingActivities = await db.execute('SELECT COUNT(*) as count FROM activities');
        if (existingActivities.rows[0].count === 0) {
            for (const a of activityPlans) {
                await db.execute({
                    sql: 'INSERT INTO activities (type, semester, date, title, speaker, description) VALUES (?, ?, ?, ?, ?, ?)',
                    args: [a.type, a.semester, a.date, a.title, a.speaker || null, a.description || null]
                });
            }
            console.log('✓ Activity plans seeded');
        } else {
            console.log('⊘ Activities already exist');
        }

        console.log('--- Seed completed ---');
        process.exit(0);
    } catch (err) {
        console.error('Seed Error:', err);
        process.exit(1);
    }
}

seed();
