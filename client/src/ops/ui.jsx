import { useEffect, useRef } from 'react';
import { JOB_STATES, safeLink } from './model';

export const humanError = error => {
  const body = error.response?.data;
  const message = typeof body?.error === 'string' ? body.error : body?.message || body?.error?.message || error.message;
  if (error.response?.status === 401) return '登入已失效，請重新登入。尚未儲存的內容仍保留。';
  if (error.response?.status === 409) return (message || '這筆資料剛被更新。') + ' 請重新整理後再試。';
  return message?.slice(0, 500) || '暫時無法儲存，請稍後再試。';
};

export function ExternalLink({ href, children, className = '' }) {
  const target = safeLink(href);
  return target ? <a className={className} href={target} target="_blank" rel="noopener noreferrer">{children}<span aria-hidden="true"> ↗</span></a> : null;
}
export function ActionButton({ children, reason, busy, onClick, tone = 'primary', ...rest }) {
  return <div className="ops-action"><button type="button" className={'ops-button ' + tone} onClick={onClick} disabled={!!reason || busy} title={reason || undefined} {...rest}>{children}</button>{reason && <small className="ops-disabled-reason">{reason}</small>}</div>;
}
export function Badge({ value, type = 'job' }) {
  const label = type === 'job' ? JOB_STATES[value] : value;
  return <span className={'ops-badge ops-badge-' + (['succeeded', 'done', 'completed'].includes(value) ? 'green' : ['failed', 'needs_reconciliation'].includes(value) ? 'red' : 'neutral')}>{label || value}</span>;
}
export function Panel({ title, kicker, action, children, className = '' }) {
  return <section className={'ops-panel ' + className}><div className="ops-panel-heading"><div>{kicker && <span className="ops-kicker">{kicker}</span>}<h2>{title}</h2></div>{action}</div>{children}</section>;
}
export function Empty({ title, detail, children }) {
  return <div className="ops-empty"><h3>{title}</h3>{detail && <p>{detail}</p>}{children}</div>;
}
export function Dialog({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current; dialog.showModal();
    const cancel = event => { event.preventDefault(); closeRef.current(); };
    dialog.addEventListener('cancel', cancel);
    return () => dialog.removeEventListener('cancel', cancel);
  }, []);
  return <dialog ref={ref} className={'ops-dialog' + (wide ? ' wide' : '')} aria-labelledby="ops-dialog-title" onClick={event => { if (event.target === ref.current) onClose(); }}>
    <div className="ops-dialog-heading"><h2 id="ops-dialog-title">{title}</h2><button className="ops-icon-button" type="button" aria-label="關閉" onClick={onClose}>×</button></div>{children}
  </dialog>;
}
export function Field({ label, value, onChange, type = 'text', options = [], required = false, placeholder = '', rows = 3, wide = false, hint = '', name, checkboxLabel }) {
  const id = name || 'field-' + label;
  return <div className={'ops-field' + (wide ? ' wide' : '')}>
    <label htmlFor={id}>{label}{required && <span className="ops-required"> *</span>}</label>
    {type === 'checkbox' ? <label className="ops-checkbox"><input id={id} type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} required={required} />{checkboxLabel || label}</label>
      : type === 'textarea' ? <textarea id={id} value={value || ''} onChange={e => onChange(e.target.value)} rows={rows} required={required} maxLength={12000} placeholder={placeholder} />
      : type === 'select' ? <select id={id} value={value || ''} onChange={e => onChange(e.target.value)} required={required}>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
        : <input id={id} type={type} value={value || ''} onChange={e => onChange(e.target.value)} required={required} maxLength={2000} placeholder={placeholder} />}
    {hint && <small>{hint}</small>}
  </div>;
}
