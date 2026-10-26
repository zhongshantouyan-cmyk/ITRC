import { useEffect, useRef, useState } from 'react';
import { CLUB_TOOLS, findClubTool } from './club-tools-catalog';
import './club-tools.css';

export { CLUB_TOOLS } from './club-tools-catalog';

const isPreviewBuild = import.meta.env.VITE_CLUB_TOOLS_MODE === 'preview';

function PreviewNotice({ title, demo }) {
  return <div className="club-tools-notice" role="status">
    <strong>{demo ? '練習模式' : '預覽模式'}：{title}不連接正式資料</strong>
    <p>財務、名單與共用工具請在正式工作台使用。這裡不會載入可修改正式資料的工具。</p>
  </div>;
}

export function ToolDirectory({ onOpen, demo = false }) {
  return <section className="ops-panel club-tools-directory">
    <div className="ops-panel-heading"><div><h2>社團工具</h2><p className="ops-muted">選擇工具，直接在工作台中使用。</p></div></div>
    {(demo || isPreviewBuild) && <PreviewNotice title="社團工具" demo={demo} />}
    <div className="club-tools-grid">
      {CLUB_TOOLS.filter(tool => !tool.hidden).map(tool => <button key={tool.id} className="club-tool-card" type="button" disabled={demo || isPreviewBuild} onClick={() => {
        if (demo || isPreviewBuild) return;
        if (onOpen) onOpen(tool.id);
        else window.location.assign(tool.workspacePath);
      }}>
        <span className="club-tool-group">{tool.group}</span>
        <strong>{tool.title}</strong><p>{tool.description}</p><span className="club-tool-open">開啟工具 →</span>
      </button>)}
    </div>
  </section>;
}

export default function ToolFrame({ toolId, demo = false, onOpen }) {
  const tool = findClubTool(toolId);
  const frame = useRef(null);
  const [generation, setGeneration] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const blocked = demo || isPreviewBuild;

  useEffect(() => { setLoaded(false); }, [toolId, generation]);
  useEffect(() => {
    if (blocked) return undefined;
    const navigate = event => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== 'itrc-workspace:navigate') return;
      const next = findClubTool(event.data.toolId);
      if (next && !next.hidden) {
        if (onOpen) onOpen(next.id);
        else window.location.assign(next.workspacePath);
      } else if (event.data.view === 'tasks') window.location.assign(`/ops?view=tasks${event.data.source === 'legacy' ? '&source=legacy' : ''}`);
      else if (event.data.view === 'overview') window.location.assign('/ops');
    };
    window.addEventListener('message', navigate);
    return () => window.removeEventListener('message', navigate);
  }, [blocked, onOpen]);

  if (!tool) return <ToolDirectory onOpen={onOpen} demo={demo} />;
  return <section className="ops-panel club-tool-panel" aria-label={tool.title}>
    <div className="club-tool-heading"><div><span className="ops-kicker">{tool.group}</span><h2>{tool.title}</h2><p>{tool.description}</p></div>
      {!blocked && <button type="button" className="ops-button quiet small" onClick={() => setGeneration(value => value + 1)}>重新載入</button>}
    </div>
    {blocked ? <PreviewNotice title={tool.title} demo={demo} /> : <div className="club-tool-frame-shell">
      {!loaded && <p className="club-tool-loading" role="status">正在載入{tool.title}…</p>}
      <iframe key={`${tool.id}:${generation}`} ref={frame} title={`${tool.title}操作區`} src={`${tool.path}?embedded=1`} className="club-tool-frame" allow="clipboard-write" referrerPolicy="same-origin" onLoad={() => setLoaded(true)} />
    </div>}
  </section>;
}
