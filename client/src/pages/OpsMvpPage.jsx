import { useMemo, useState } from 'react';

const ACTIVITIES = [
  { id:'A08', name:'深度研究－交易策略組', status:'高風險', priority:'最高', owner:'待定', deadline:'2026-10-03', next:'確認教室與錄影', blocker:'目前兩項皆無明確接手人' },
  { id:'A05', name:'MaiCoin 課程＋交易競賽', status:'重排中', priority:'高', owner:'品言主導', deadline:'待定', next:'確認新日期／形式／規則', blocker:'10/5、10/11、10/17 舊排程不可沿用' },
  { id:'A04', name:'期末／學期競賽', status:'待確認', priority:'高', owner:'嘉瑩＊', deadline:'待定', next:'確認嘉瑩本人是否正式承接', blocker:'執行分工尚未定案' },
  { id:'A03', name:'Ourbit＋模擬交易競賽', status:'待確認', priority:'高', owner:'妤萱＊', deadline:'待定', next:'確認品言／彥綸／妤萱接受與交接', blocker:'9/24 分工仍屬提議／待交接' },
  { id:'A01', name:'週三社課', status:'進行中', priority:'中', owner:'梓芸／嘉瑩＊／妤萱＊', deadline:'每週日發文', next:'補每場接待、開門、飲水、車證與簽到安排', blocker:'整體追蹤與現場細節仍未完整' },
  { id:'A02', name:'週五社課／講座', status:'進行中', priority:'中', owner:'依宸', deadline:'依各場次', next:'逐場確認講師、教室、設備、簽到與發布', blocker:'部分場次細節尚未匯入' },
  { id:'A06', name:'新百王合作活動', status:'規劃中', priority:'中', owner:'梓芸／妤萱／嘉瑩', deadline:'2026-11-04', next:'等合作方流程後補文案、表單、現場分工', blocker:'流程預計 10 月中確認' },
  { id:'A07', name:'深度研究－基本面組', status:'待補分工', priority:'中', owner:'待定', deadline:'待定', next:'確認群組、連結與行政交接', blocker:'後續行政主責未明確' },
  { id:'A09', name:'深度研究－加密組', status:'進行中', priority:'中', owner:'妤萱', deadline:'2026-10-03', next:'補講師接洽、行政與宣傳協作', blocker:'除妤萱外多數角色未補齊' },
];

const PREFLIGHT = [
  { activity:'深度研究－交易策略組', item:'教室／場地確認', due:'2026-09-30', owner:'待定', status:'未分派', blocking:true },
  { activity:'深度研究－交易策略組', item:'錄影人員確認', due:'2026-09-30', owner:'待定', status:'未分派', blocking:true },
  { activity:'深度研究－交易策略組', item:'講師最終確認', due:'2026-10-02', owner:'大恒', status:'進行中', blocking:true },
  { activity:'深度研究－交易策略組', item:'學員地點提醒', due:'2026-10-02', owner:'待定', status:'未分派', blocking:true },
  { activity:'深度研究－加密組', item:'線上連結與講師確認', due:'2026-10-02', owner:'妤萱', status:'進行中', blocking:true },
  { activity:'新百王合作活動', item:'合作流程定案', due:'2026-10-21', owner:'梓芸／公關', status:'已提議', blocking:true },
];

const PEOPLE = ['梓芸','依宸','大恒','品言','妤萱','嘉瑩','羽蓉','彥綸','緯承','至維','浩原','沁彤'];

const styles = {
  page:{ minHeight:'100vh', background:'#f5f7fb', padding:'88px 18px 48px' },
  shell:{ maxWidth:1120, margin:'0 auto' },
  hero:{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start', marginBottom:18, flexWrap:'wrap' },
  title:{ margin:0, fontSize:'clamp(26px,4vw,40px)', letterSpacing:'-.02em' },
  sub:{ color:'#68707d', marginTop:8, lineHeight:1.6 },
  badge:{ background:'#fff3cd', color:'#6d5200', padding:'8px 12px', borderRadius:999, fontSize:13, fontWeight:700, border:'1px solid #f0d878' },
  nav:{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, margin:'18px 0 22px' },
  navBtn:{ border:'1px solid #dfe3e8', background:'#fff', borderRadius:14, padding:'13px 14px', fontWeight:800, cursor:'pointer' },
  card:{ background:'#fff', border:'1px solid #e4e7eb', borderRadius:18, padding:18, boxShadow:'0 5px 18px rgba(0,0,0,.035)' },
  grid:{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))', gap:12 },
  metric:{ fontSize:30, fontWeight:900, marginTop:5 },
  muted:{ color:'#6b7280', fontSize:13 },
  list:{ display:'grid', gap:10 },
  item:{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:15, padding:15 },
  row:{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' },
  tag:{ fontSize:12, fontWeight:800, background:'#eef1f4', padding:'4px 8px', borderRadius:999 },
  input:{ width:'100%', border:'1px solid #cfd5dc', borderRadius:11, padding:'11px 12px', font:'inherit', background:'#fff' },
  label:{ fontSize:13, fontWeight:800, display:'block', margin:'12px 0 6px' },
  primary:{ width:'100%', marginTop:16, border:0, borderRadius:12, background:'#111827', color:'#fff', padding:'13px 16px', fontWeight:900, cursor:'pointer' },
};

function urgencyColor(priority){ return priority==='最高' ? '#ffe3e3' : priority==='高' ? '#fff4cf' : '#edf2f7'; }
function taskMatches(a, name){ if(!name) return false; return (a.owner||'').includes(name); }

export default function OpsMvpPage(){
  const [tab,setTab]=useState('home');
  const [name,setName]=useState('');
  const [checkActivity,setCheckActivity]=useState('');
  const [form,setForm]=useState({activity:'',reporter:'',update:'',date:'2026-09-30',source:''});
  const [queue,setQueue]=useState(()=>{ try{return JSON.parse(localStorage.getItem('itrc_ops_mvp_queue')||'[]')}catch{return[]} });

  const high=ACTIVITIES.filter(a=>['最高','高'].includes(a.priority)).length;
  const focus=ACTIVITIES.filter(a=>['最高','高'].includes(a.priority));
  const blocking=PREFLIGHT.filter(x=>x.blocking && x.status!=='完成').length;
  const myActivities=useMemo(()=>ACTIVITIES.filter(a=>taskMatches(a,name)),[name]);
  const myPreflight=useMemo(()=>PREFLIGHT.filter(x=>(x.owner||'').includes(name)),[name]);
  const checks=useMemo(()=>PREFLIGHT.filter(x=>!checkActivity||x.activity===checkActivity),[checkActivity]);

  function submit(e){
    e.preventDefault();
    if(!form.activity||!form.reporter||!form.update||!form.date){ alert('四個必填欄位還沒填完'); return; }
    const next=[{...form, id:Date.now(), status:'待審核'},...queue];
    setQueue(next); localStorage.setItem('itrc_ops_mvp_queue',JSON.stringify(next));
    setForm(v=>({...v,update:'',source:''}));
    setTab('queue');
  }

  const tabs=[['home','總覽'],['report','回報進度'],['mine','我的任務'],['check','活動前檢查'],['queue',`待審核 ${queue.length}`]];

  return <main style={styles.page}><div style={styles.shell}>
    <div style={styles.hero}>
      <div><h1 style={styles.title}>ITRC 活動管理中心</h1><div style={styles.sub}>給一般幹部用的 MVP。先把「看狀況、回報、找自己的任務」做簡單。<br/>正式資料仍以 File OS 為準。</div></div>
      <div style={styles.badge}>MVP Preview · snapshot 2026-09-29</div>
    </div>

    <div style={styles.nav}>{tabs.map(([k,t])=><button key={k} style={{...styles.navBtn,...(tab===k?{background:'#111827',color:'#fff'}:{})}} onClick={()=>setTab(k)}>{t}</button>)}</div>

    {tab==='home' && <>
      <div style={styles.grid}>
        {[
          ['目前活動',ACTIVITIES.length,'納管工作線'],
          ['高優先',high,'需要先處理'],
          ['待審核',queue.length,'此 MVP 本機 queue'],
          ['阻塞事項',blocking,'活動前必要事項'],
        ].map(([a,b,c])=><div style={styles.card} key={a}><div style={styles.muted}>{a}</div><div style={styles.metric}>{b}</div><div style={styles.muted}>{c}</div></div>)}
      </div>
      <section style={{marginTop:22}}><h2>現在最需要注意</h2><div style={styles.list}>{focus.map(a=><div style={styles.item} key={a.id}><div style={styles.row}><strong>{a.name}</strong><span style={{...styles.tag,background:urgencyColor(a.priority)}}>{a.status}</span></div><p style={{margin:'10px 0 6px'}}><b>下一步：</b>{a.next}</p><div style={styles.muted}>負責：{a.owner} · 期限：{a.deadline}</div><div style={{marginTop:7,color:'#8a3131'}}>卡點：{a.blocker}</div></div>)}</div></section>
    </>}

    {tab==='report' && <form onSubmit={submit} style={{...styles.card,maxWidth:720}}>
      <h2 style={{marginTop:0}}>回報這週進度</h2><div style={styles.muted}>只填四個必要欄位。這裡先示範待審核流程，不會改正式分工。</div>
      <label style={styles.label}>① 活動＊</label><select style={styles.input} value={form.activity} onChange={e=>setForm({...form,activity:e.target.value})}><option value="">請選活動</option>{ACTIVITIES.map(a=><option key={a.id}>{a.name}</option>)}</select>
      <label style={styles.label}>② 你的名字＊</label><input style={styles.input} value={form.reporter} onChange={e=>setForm({...form,reporter:e.target.value})} placeholder="例如：嘉瑩"/>
      <label style={styles.label}>③ 這週發生什麼？＊</label><textarea style={{...styles.input,minHeight:110}} value={form.update} onChange={e=>setForm({...form,update:e.target.value})} placeholder="例如：教室確定 CM203，品言會幫忙錄影。"/>
      <label style={styles.label}>④ 消息日期＊</label><input type="date" style={styles.input} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/>
      <label style={styles.label}>在哪裡看到？（可空白）</label><input style={styles.input} value={form.source} onChange={e=>setForm({...form,source:e.target.value})} placeholder="活動組 LINE／講師私訊"/>
      <button style={styles.primary}>送到待審核</button>
    </form>}

    {tab==='mine' && <>
      <div style={{...styles.card,maxWidth:520}}><h2 style={{marginTop:0}}>我的任務</h2><label style={styles.label}>選你的名字</label><select style={styles.input} value={name} onChange={e=>setName(e.target.value)}><option value="">請選名字</option>{PEOPLE.map(p=><option key={p}>{p}</option>)}</select><div style={{...styles.muted,marginTop:8}}>＊ 表示尚未正式確認承接。</div></div>
      {name && <><section style={{marginTop:22}}><h2>你參與的活動</h2><div style={styles.list}>{myActivities.length?myActivities.map(a=><div style={styles.item} key={a.id}><div style={styles.row}><strong>{a.name}</strong><span style={styles.tag}>{a.status}</span></div><p>{a.next}</p><div style={styles.muted}>期限：{a.deadline} · {a.owner}</div></div>):<div style={styles.card}>目前沒有找到你的活動。</div>}</div></section>
      <section style={{marginTop:22}}><h2>你的活動前任務</h2><div style={styles.list}>{myPreflight.length?myPreflight.map((x,i)=><div style={styles.item} key={i}><strong>{x.item}</strong><div style={styles.muted}>{x.activity} · 建議完成 {x.due} · {x.status}</div></div>):<div style={styles.card}>目前沒有找到你的活動前任務。</div>}</div></section></>}
    </>}

    {tab==='check' && <>
      <div style={{...styles.card,maxWidth:620}}><h2 style={{marginTop:0}}>活動前檢查</h2><select style={styles.input} value={checkActivity} onChange={e=>setCheckActivity(e.target.value)}><option value="">全部活動</option>{[...new Set(PREFLIGHT.map(x=>x.activity))].map(x=><option key={x}>{x}</option>)}</select></div>
      <div style={{...styles.list,marginTop:16}}>{checks.map((x,i)=><div style={styles.item} key={i}><div style={styles.row}><strong>{x.item}</strong><span style={{...styles.tag,background:x.status==='完成'?'#dff6e5':x.blocking?'#ffe3e3':'#fff4cf'}}>{x.status}</span>{x.blocking&&<span style={styles.tag}>阻塞</span>}</div><div style={{...styles.muted,marginTop:8}}>{x.activity} · 負責：{x.owner} · 建議完成：{x.due}</div></div>)}</div>
    </>}

    {tab==='queue' && <><div style={styles.card}><h2 style={{marginTop:0}}>待審核更新</h2><div style={styles.muted}>MVP 階段先存在你的瀏覽器，Vercel/後端接好後改成中央 queue。</div></div><div style={{...styles.list,marginTop:14}}>{queue.length?queue.map(q=><div style={styles.item} key={q.id}><div style={styles.row}><strong>{q.activity}</strong><span style={{...styles.tag,background:'#fff4cf'}}>{q.status}</span></div><p>{q.update}</p><div style={styles.muted}>{q.reporter} · {q.date} · {q.source||'未填來源'}</div></div>):<div style={styles.card}>目前沒有待審核更新。</div>}</div></>}

    <div style={{...styles.muted,marginTop:30}}>MVP 安全邊界：不直接修改正式分工、活動狀態或 Firebase RTDB。</div>
  </div></main>;
}
