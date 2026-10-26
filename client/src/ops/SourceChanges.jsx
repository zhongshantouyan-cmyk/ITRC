import { useEffect, useState } from 'react';
import { canOwn, dateText, isAdviser, safeLink } from './model.js';

const kinds = { events: '活動資料', posts: '宣傳成果', tasks: '任務交付' };
const stages = { pending: '待核對', approved: '已核准，待回寫', rejected: '已退回', written_back: '已登錄回寫' };
const fields = { title:'名稱', speaker:'講者', date:'日期', time:'時間', venue:'場地', audience:'對象', fee:'費用說明', registrationUrl:'報名網址', highlights:'宣傳重點', ownerPersonId:'承辦人 ID', confirmationStatus:'活動確認狀態', eventId:'活動 ID', projectId:'專案 ID', postId:'宣傳 ID', purpose:'目的', cta:'希望採取的行動', channel:'發布管道', scheduledAt:'預計發布時間', caption:'文案', slides:'輪播各頁', copyVersion:'文案版本', stage:'宣傳階段', approvedVersion:'核准版本', approvedAt:'核准時間', canvaEditUrl:'Canva 編輯連結', designCopyVersion:'設計文案版本', publishedUrl:'發布證據', publishedAt:'發布時間', reviewerPersonId:'驗收人 ID', dueDate:'截止日期', status:'任務狀態', acceptanceCriteria:'驗收標準', deliverableUrl:'成果連結', acceptedAt:'驗收時間', reviewIdentityMode:'驗收登錄方式', reviewEvidenceUrl:'驗收證據' };
const Link = ({href,children}) => safeLink(href) ? <a href={safeLink(href)} target="_blank" rel="noopener noreferrer">{children} ↗</a> : null;

export default function SourceChanges({data,busy,execute,openAction}) {
  const [kind,setKind] = useState('events');
  const [targetId,setTargetId] = useState('');
  const [form,setForm] = useState({sourceUrl:'',sourceKey:'',baseSourceRevision:'',reason:''});
  const [error,setError] = useState('');
  const [scope,setScope] = useState('open');
  const targets = (data[kind] || []).filter(record => canOwn(data.actor,record,data.projects,data.people,data.tasks));
  const target = targets.find(record => record.id === targetId);
  useEffect(() => {
    if (!target) return;
    const prior = [...(data.sourceChanges || [])].reverse().find(change => change.targetId === target.id && change.status === 'written_back');
    setForm({sourceUrl:target.sourceUrl || '',sourceKey:target.sourceKey || '',baseSourceRevision:prior?.appliedSourceRevision || target.sourceRevision || '',reason:''});
  },[targetId,kind]);
  const changes = (data.sourceChanges || []).filter(change => scope === 'all' || ['pending','approved'].includes(change.status));
  const propose = async event => {
    event.preventDefault(); setError('');
    try { await execute('source-change.propose',null,{...form,targetKind:kind,targetId,targetVersion:target.version}); setTargetId(''); }
    catch (issue) { setError(issue.response?.data?.error || issue.message || '來源提案未完成，請重新核對。'); }
  };
  const exportPackage = async change => {
    setError('');
    try {
      const result = await execute('source-change.export',change,{});
      const file = result.record?.package;
      if (!file) throw new Error('尚未取得已核准回寫包。');
      const url = URL.createObjectURL(new Blob([JSON.stringify(file,null,2)],{type:'application/json;charset=utf-8;'}));
      const link = document.createElement('a'); link.href = url; link.download = `ITRC_FileOS_核准回寫_${change.id}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    } catch (issue) { setError(issue.response?.data?.error || issue.message || '匯出未完成。'); }
  };
  return <>
    <div className="ops-section-heading"><div><h2>正式來源更新提案</h2><p className="ops-muted">集中保存待回寫的工作版本，依既有 FileOS 規則核准後更新原始檔。</p></div></div>
    <div className="ops-note"><strong>原有 Excel／Markdown／指定主表仍是正式來源。</strong><p>這裡保存更新提案、核准版本與回寫證據。現在由管理者在原始檔寫入並回讀後登錄；尚未自動接通原 FileOS 收件匣或改寫外部檔案，也不會自動公開官網或發布貼文。</p></div>
    {data.settings.mode === 'demo' ? <p className="ops-note">展示模式可查看此流程；來源回寫需要在正式工作區提出，展示頁不連接外部主檔。</p> : <details className="ops-source-proposal"><summary>提出一筆來源更新</summary><form onSubmit={propose}>
      <div className="ops-form-grid"><div className="ops-field"><label htmlFor="ops-source-kind">資料類型</label><select id="ops-source-kind" value={kind} onChange={event => {setKind(event.target.value);setTargetId('');}}>{Object.entries(kinds).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div className="ops-field"><label htmlFor="ops-source-target">工作紀錄</label><select id="ops-source-target" value={targetId} required onChange={event => setTargetId(event.target.value)}><option value="">選擇你負責的工作</option>{targets.map(record => <option key={record.id} value={record.id}>{record.title} · v{record.version}</option>)}</select></div>
        { [['sourceUrl','正式來源網址','url'],['sourceKey','原始檔固定識別碼','text'],['baseSourceRevision','目前正式來源版本','text']].map(([key,label,type]) => <div className="ops-field" key={key}><label htmlFor={`ops-source-${key}`}>{label}</label><input id={`ops-source-${key}`} value={form[key]} type={type} required maxLength={key === 'sourceKey' ? 200 : 2000} onChange={event => setForm(old => ({...old,[key]:event.target.value}))}/></div>)}
        <div className="ops-field wide"><label htmlFor="ops-source-reason">這次要回寫的原因與差異</label><textarea id="ops-source-reason" value={form.reason} required maxLength={2000} rows={3} onChange={event => setForm(old => ({...old,reason:event.target.value}))} placeholder="例如：活動場地已核對，回寫主表對應的活動 ID。"/></div>
      </div><p className="ops-footnote">提案會保存目前工作紀錄的版本。之後若工作資料改動，需重新提出，不能拿舊核准回寫。</p><button className="ops-button primary" type="submit" disabled={busy || !target}>送交來源更新確認</button>
    </form></details>}
    {error && <p className="ops-inline-error" role="alert">{error}</p>}
    <div className="ops-filters"><div className="ops-segment"><button className={scope === 'open' ? 'active' : ''} onClick={() => setScope('open')}>待處理</button><button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>全部紀錄</button></div></div>
    {changes.length ? <div className="ops-source-changes">{[...changes].reverse().map(change => {
      const targetRecord = data[change.targetKind]?.find(record => record.id === change.targetId);
      const stale = targetRecord?.version !== change.targetVersion;
      const admin = isAdviser(data.actor);
      const reviewFields = [{key:'confirmedSourceReview',label:'原始檔核對',type:'checkbox',required:true,checkboxLabel:'已開啟來源，核對識別碼、版本與本次內容'}, {key:'observedSourceRevision',label:'剛才核對到的正式來源版本',required:true,placeholder:change.baseSourceRevision}];
      return <article className="ops-panel ops-source-change" key={change.id}><div className="ops-item-line"><h3>{change.title}</h3><span className={`ops-badge ${change.status === 'written_back' ? 'ops-badge-green' : change.status === 'rejected' ? 'ops-badge-neutral' : 'ops-badge-amber'}`}>{stages[change.status] || change.status}</span></div>
        <p>{change.reason}</p><div className="ops-source-line"><span>{kinds[change.targetKind]} · 工作版本 v{change.targetVersion}</span><span>來源鍵：{change.sourceKey}</span><Link href={change.sourceUrl}>開啟正式來源</Link></div>
        <p className="ops-footnote">來源版本：{change.baseSourceRevision}{change.appliedSourceRevision ? ` → ${change.appliedSourceRevision}` : ''} · 提出於 {dateText(change.createdAt)}</p>
        {stale && ['pending','approved'].includes(change.status) && <p className="ops-inline-error">工作紀錄已變更；請退回這份提案，再依最新版本提出。</p>}
        {change.reviewReason && <p className="ops-note">退回原因：{change.reviewReason}</p>}
        <details><summary>查看這次提案的完整內容</summary><div className="ops-table-scroll"><table><thead><tr><th>欄位</th><th>擬回寫內容</th></tr></thead><tbody>{Object.entries(change.values || {}).map(([key,value]) => <tr key={key}><th>{fields[key] || key}</th><td className="ops-pre-line">{typeof value === 'object' ? JSON.stringify(value,null,2) : String(value)}</td></tr>)}</tbody></table></div></details>
        <div className="ops-button-row">
          {change.status === 'pending' && <button className="ops-button primary small" disabled={busy || !admin || stale} onClick={() => openAction({action:'source-change.approve',record:change,title:'核准正式來源更新',description:`預期原始檔版本：${change.baseSourceRevision}。核准後仍須寫回原始檔，本操作不會直接改檔。`,fields:reviewFields,button:'核准，等待回寫'})}>核對並核准</button>}
          {['pending','approved'].includes(change.status) && <button className="ops-button quiet small" disabled={busy || !admin} onClick={() => openAction({action:'source-change.reject',record:change,title:'退回來源更新',fields:[{key:'reason',label:'退回原因',type:'textarea',required:true}],button:'退回提案'})}>退回</button>}
          {change.status === 'approved' && <><button className="ops-button quiet small" disabled={busy || !admin || stale} onClick={() => exportPackage(change)}>匯出核准回寫包</button><button className="ops-button primary small" disabled={busy || !admin || stale} onClick={() => openAction({action:'source-change.record-writeback',record:change,title:'登錄原始檔回寫結果',description:'先在原始檔依固定識別碼完成更新，回讀確認內容後，才登錄新版本與證據。此處不會代替你寫入外部檔案。',fields:[{key:'confirmedSourceWriteback',label:'原始檔已完成',type:'checkbox',required:true,checkboxLabel:'已寫入指定來源並回讀核對完整內容'},{key:'observedSourceRevision',label:'寫入前核對的來源版本',required:true,placeholder:change.baseSourceRevision},{key:'appliedSourceRevision',label:'寫入後的新來源版本',required:true},{key:'evidenceUrl',label:'可核對的回寫證據連結',type:'url',required:true}],button:'記錄回寫完成'})}>登錄回寫結果</button></>}
          {change.status === 'written_back' && <Link href={change.writebackEvidenceUrl}>查看原始檔回寫證據</Link>}
        </div>{change.status === 'written_back' && <p className="ops-footnote">管理者依外部來源回讀結果登錄；保留完整核准與操作紀錄。</p>}
      </article>;
    })}</div> : <div className="ops-empty"><h3>目前沒有{scope === 'open' ? '待處理的' : ''}來源更新提案</h3><p>活動、宣傳或任務完成更新後，從上方選擇那筆工作，送交正式來源核對。</p></div>}
  </>;
}
