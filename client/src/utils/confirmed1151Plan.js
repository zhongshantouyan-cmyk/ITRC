import { activityDateTimestamp } from './activityDates';

/** Temporary 115-1 public schedule reconciliation; source: confirmed club schedule. */
export function reconcileConfirmed1151Plan(items, semester) {
    if (semester !== '115-1') return items;
    // Display fallback for confirmed dates while the Render/Turso seed migration is pending.
    // Keep data entered in the admin panel unless it is the known old generic course label.
    const sessions = [
        { day: 11, part: 'I', ordinal: '第一堂' },
        { day: 18, part: 'II', ordinal: '第二堂' },
        { day: 25, part: 'III', ordinal: '第三堂' }
    ].map(session => ({
        ...session,
        date: '2026年11月' + session.day + '日(三)',
        title: '技術分析概論 ' + session.part,
        description: '技術分析概論三堂系列｜' + session.ordinal + '。時間：16:00–18:00；地點：CM1037。',
        stamp: Date.UTC(2026, 10, session.day)
    }));
    const nov4Stamp = Date.UTC(2026, 10, 4);
    const nov4Title = '新百王證券合作講座：2026 年末台股展望 × 2027 投資布局';
    const nov4Outline = [
        'Part 1｜台股展望與投資布局：2026–2027 年總經趨勢、台積電 GAA／A16／CoWoS 先進封裝、GPU 與 ASIC 算力布局、實體 AI 與機器人、估值與風險管理。',
        'Part 2｜進場策略與實際操作：以歷史股票案例解讀週線、日線訊號與支撐位，規劃進場與停損，並檢視成交明細。',
        'Part 3｜「慧眼獨具」看盤小遊戲：手機掃 QR Code 觀察走勢並答題，前三名獎金依序為 1,500／1,000／500 元。',
        '時間：11/04（三）16:00–18:00｜地點：CM1037。'
    ].join('\n');

    const corrected = items.map(item => {
        const stamp = activityDateTimestamp(item);
        const speaker = String(item.speaker || '');
        const session = sessions.find(entry => entry.stamp === stamp);
        if (session && speaker.includes('王昭文')) {
            const title = String(item.title || '').trim();
            const expected = /^技術分析概論(?:\s*(?:I|II|III|Ⅰ|Ⅱ|Ⅲ))?$/.test(title) ? session.title : item.title;
            return {
                ...item,
                date: session.date,
                title: expected,
                description: String(item.description || '').trim() ? item.description : session.description
            };
        }
        if (stamp === nov4Stamp && speaker.includes('新百王') &&
            (item.title === '台股展望與投資布局講座' || item.title === nov4Title)) {
            return {
                ...item,
                date: '2026年11月4日(三)',
                title: nov4Title,
                description: String(item.description || '').trim() ? item.description : nov4Outline
            };
        }
        return item;
    });
    for (const session of sessions) {
        const onDate = corrected.filter(item => activityDateTimestamp(item) === session.stamp);
        // Do not duplicate sessions already in Turso or collide with a different event.
        if (onDate.length === 0) {
            corrected.push({
                id: 'confirmed-1151-wang-' + session.day,
                type: 'plan',
                semester: '115-1',
                date: session.date,
                title: session.title,
                speaker: '王昭文教授',
                description: session.description
            });
        }
    }
    return corrected;
}
