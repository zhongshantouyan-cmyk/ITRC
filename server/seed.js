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

        // 115-1 11/04 新百王講座：更正官網將星期三誤寫為星期五、缺少課程大綱的舊資料。
        // 僅更新日期／標題吻合的單筆舊活動，不碰其他課程或已由管理員填寫的說明。
        const nov4Title = '新百王證券合作講座：2026 年末台股展望 × 2027 投資布局';
        const nov4Outline = [
            'Part 1｜台股展望與投資布局：2026–2027 年總經趨勢、台積電 GAA／A16／CoWoS 先進封裝、GPU 與 ASIC 算力布局、實體 AI 與機器人、估值與風險管理。',
            'Part 2｜進場策略與實際操作：以歷史股票案例解讀週線、日線訊號與支撐位，規劃進場與停損，並檢視成交明細。',
            'Part 3｜「慧眼獨具」看盤小遊戲：手機掃 QR Code 觀察走勢並答題，前三名獎金依序為 1,500／1,000／500 元。',
            '時間：11/04（三）16:00–18:00｜地點：CM1037。',
            '社員免費；非社員校內 100 元／堂、校外 300 元／堂。'
        ].join('\n');
        const nov4Rows = await db.execute({
            sql: `SELECT id, date, title, description FROM activities
                  WHERE type = ? AND semester = ?
                    AND title IN (?, ?)
                    AND date IN (?, ?)`,
            args: [
                'plan', '115-1',
                '台股展望與投資布局講座', nov4Title,
                '2026年11月4日(五)', '2026年11月4日(三)'
            ]
        });
        if (nov4Rows.rows.length === 1) {
            const old = nov4Rows.rows[0];
            const newDate = '2026年11月4日(三)';
            const newDescription = String(old.description || '').trim() ? old.description : nov4Outline;
            if (old.date !== newDate || old.title !== nov4Title || old.description !== newDescription) {
                await db.execute({
                    sql: 'UPDATE activities SET date = ?, title = ?, description = ? WHERE id = ? AND type = ? AND semester = ? AND date = ? AND title = ?',
                    args: [newDate, nov4Title, newDescription, old.id, 'plan', '115-1', old.date, old.title]
                });
                console.log('✓ 已校正 115-1 11/04 課程日期與大綱');
            }
        } else if (nov4Rows.rows.length > 1) {
            console.warn('⊘ 115-1 11/04 課程有多筆符合，略過自動校正以避免誤改');
        }


        // 115-1 週三三堂技術分析概論，依確認課表補缺、標示堂次；部署可重複執行。
        const wangSessions = [
            { day: '11', part: 'I', ordinal: '第一堂' },
            { day: '18', part: 'II', ordinal: '第二堂' },
            { day: '25', part: 'III', ordinal: '第三堂' }
        ];
        for (const session of wangSessions) {
            const expectedDate = '2026年11月' + session.day + '日(三)';
            const expectedTitle = '技術分析概論 ' + session.part;
            const brief = '技術分析概論三堂系列｜' + session.ordinal + '。時間：16:00–18:00；地點：CM1037。';
            const existing = await db.execute({
                sql: 'SELECT id, date, title, speaker, description FROM activities ' +
                     'WHERE type = ? AND semester = ? AND (date LIKE ? OR date LIKE ?)',
                args: ['plan', '115-1', '2026年11月' + session.day + '日%', '115年11月' + session.day + '日%']
            });
            const wangRows = existing.rows.filter(row => String(row.speaker || '').includes('王昭文'));
            if (wangRows.length === 0 && existing.rows.length === 0) {
                await db.execute({
                    sql: 'INSERT INTO activities (type, semester, date, title, speaker, description) VALUES (?, ?, ?, ?, ?, ?)',
                    args: ['plan', '115-1', expectedDate, expectedTitle, '王昭文教授', brief]
                });
                console.log('✓ 已補上 ' + expectedDate + ' 王昭文教授課程');
            } else if (wangRows.length === 1) {
                const current = wangRows[0];
                const previousTitle = String(current.title || '').trim();
                const matchingSeriesTitle = /^技術分析概論(?:\s*(?:I|II|III|Ⅰ|Ⅱ|Ⅲ))?$/.test(previousTitle);
                const revisedTitle = matchingSeriesTitle ? expectedTitle : current.title;
                const revisedDescription = String(current.description || '').trim() ? current.description : brief;
                if (current.date !== expectedDate || current.title !== revisedTitle || current.description !== revisedDescription) {
                    await db.execute({
                        sql: 'UPDATE activities SET date = ?, title = ?, description = ? ' +
                             'WHERE id = ? AND type = ? AND semester = ? AND date = ? AND title = ?',
                        args: [expectedDate, revisedTitle, revisedDescription, current.id, 'plan', '115-1', current.date, current.title]
                    });
                    console.log('✓ 已校正 ' + expectedDate + ' 王昭文教授課程');
                }
            } else {
                console.warn('⊘ ' + expectedDate + ' 有重複或其他活動，略過自動修改以防誤改');
            }
        }

        console.log('--- Seed completed ---');
        process.exit(0);
    } catch (err) {
        console.error('Seed Error:', err);
        process.exit(1);
    }
}

seed();
