const db = require('./db');

const onlineResources = [
    {
        name: '公開資訊觀測站',
        nameEn: 'Market Observation Post System',
        url: 'https://mops.twse.com.tw/mops/#/web/home',
        description: '臺灣證券市場公開資訊查詢系統，提供上市櫃公司財務報表、重大訊息及股東會資訊。',
        icon: 'IconChart',
        color: '#4d7ea8'
    },
    {
        name: 'FRED',
        nameEn: 'Federal Reserve Economic Data',
        url: 'https://fred.stlouisfed.org/',
        description: '美國聯邦儲備銀行聖路易分行經濟數據庫，提供超過 80 萬筆經濟時間序列資料。',
        icon: 'IconTrendUp',
        color: '#2e7d32'
    },
    {
        name: 'IMF eLibrary',
        nameEn: 'International Monetary Fund',
        url: 'https://www.elibrary.imf.org/',
        description: '國際貨幣基金組織電子圖書館，涵蓋全球經濟研究、政策分析與統計數據。',
        icon: 'IconGlobe',
        color: '#1565c0'
    },
    {
        name: 'CFA Institute',
        nameEn: 'Chartered Financial Analyst',
        url: 'https://www.cfainstitute.org/',
        description: '全球金融分析師認證機構，提供投資管理與財務分析的專業學習資源。',
        icon: 'IconAward',
        color: '#6a1b9a'
    },
    {
        name: 'JY 價值筆記',
        nameEn: 'JY Value Notes',
        url: 'https://jyvalue.com/',
        description: '台灣金融證照考古題下載與學習筆記平台，適合準備各類金融證照考試。',
        icon: 'IconFileText',
        color: '#e65100'
    }
];

const offlineResources = [
    {
        title: '原則',
        titleEn: 'Principles',
        author: 'Ray Dalio（瑞・達利歐）',
        cover: '',
        description: '全球最大避險基金橋水基金創辦人的生活與工作原則，闡述系統化決策的思維框架。'
    },
    {
        title: '持續買進',
        titleEn: 'Just Keep Buying',
        author: 'Nick Maggiulli（尼克・馬朱利）',
        cover: '',
        description: '以數據驅動的方法證明，持續投入市場是累積財富最有效的策略。'
    },
    {
        title: '投資金律',
        titleEn: 'The Four Pillars of Investing',
        author: 'William J. Bernstein（威廉・乔恩斯坦）',
        cover: '',
        description: '從投資理論、歷史、心理與產業四大支柱，建構完整的投資知識體系。'
    },
    {
        title: '漫步華爾街',
        titleEn: 'A Random Walk Down Wall Street',
        author: 'Burton G. Malkiel（乔頓・墨基爾）',
        cover: '',
        description: '投資經典之作，以隨機漫步理論闡述市場效率與指數投資的優勢。'
    },
    {
        title: '金錢心理學',
        titleEn: 'Dollars and Sense',
        author: 'Dan Ariely & Jeff Kreisler',
        cover: '',
        description: '行為經濟學大師揭示人們在金錢決策中的非理性行為與心理偏誤。'
    }
];

async function seedResources() {
    try {
        console.log('Seeding resources...');
        for (let i = 0; i < onlineResources.length; i++) {
            const item = onlineResources[i];
            await db.execute({
                sql: 'INSERT INTO online_resources (name, name_en, url, description, icon, color, order_num) VALUES (?, ?, ?, ?, ?, ?, ?)',
                args: [item.name, item.nameEn, item.url, item.description, item.icon, item.color, i]
            });
        }
        console.log('Online resources seeded.');

        for (let i = 0; i < offlineResources.length; i++) {
            const item = offlineResources[i];
            await db.execute({
                sql: 'INSERT INTO offline_resources (title, title_en, author, cover_url, description, order_num) VALUES (?, ?, ?, ?, ?, ?)',
                args: [item.title, item.titleEn, item.author, item.cover, item.description, i]
            });
        }
        console.log('Offline resources seeded.');
    } catch (err) {
        console.error('Failed to seed resources', err);
    }
}

seedResources();
