/* ITRC 幹部工具站 — 共用：SVG 圖示精靈 + 頂部導覽列 + toast。
   各工具頁 <head> 加： <link rel="stylesheet" href="itrc.css"><script src="itrc.js" defer></script>
   用圖示： <svg class="svgic"><use href="#i-board"></use></svg>  (顏色用 currentColor，大小用 font-size 或 width/height) */
(function(){

  /* ---- 圖示精靈（線性，stroke=currentColor）---- */
  var ICONS={
    board:'<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="9.5" y="4" width="5" height="10" rx="1"/><rect x="16" y="4" width="5" height="13" rx="1"/>',
    checklist:'<path d="M10 5h9"/><path d="M10 12h9"/><path d="M10 19h9"/><path d="M4 5l1 1 2-2"/><path d="M4 12l1 1 2-2"/><path d="M4 19l1 1 2-2"/>',
    mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/>',
    store:'<path d="M3.5 9 5 4h14l1.5 5"/><path d="M4.5 9v9a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V9"/><path d="M3.5 9h17"/><path d="M9.5 19v-5h5v5"/>',
    palette:'<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.9 1.6-1.7 0-.5-.3-.9-.6-1.2-.3-.4-.6-.7-.6-1.2 0-.8.7-1.4 1.5-1.4H15a4 4 0 0 0 4-4c0-4.7-3.1-8.5-7-8.5Z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10" cy="7.8" r="1"/><circle cx="14.3" cy="7.8" r="1"/>',
    certificate:'<rect x="4" y="3" width="16" height="13" rx="1.5"/><line x1="7.5" y1="7.5" x2="16.5" y2="7.5"/><line x1="7.5" y1="11" x2="13" y2="11"/><circle cx="12" cy="17.5" r="3"/><path d="M10.2 19.7 9.4 23l2.6-1.5 2.6 1.5-.8-3.3"/>',
    trophy:'<path d="M8 4h8v4.5a4 4 0 0 1-8 0Z"/><path d="M8 5.5H5V7a3 3 0 0 0 3 3"/><path d="M16 5.5h3V7a3 3 0 0 1-3 3"/><line x1="12" y1="12.5" x2="12" y2="16"/><path d="M9.5 20h5"/><path d="M10 16h4l.6 4h-5.2Z"/>',
    bulb:'<path d="M9.5 18h5"/><path d="M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.5.5.8 1.1.8 1.8V16h6v-.6c0-.7.3-1.3.8-1.8A6 6 0 0 0 12 3Z"/>',
    dashboard:'<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/>',
    chart:'<line x1="4" y1="20" x2="20" y2="20"/><path d="M7 20v-6"/><path d="M12 20V8"/><path d="M17 20v-9"/>',
    search:'<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7.5l8 5.5 8-5.5"/>',
    file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="16.5" x2="15" y2="16.5"/>',
    plus:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    x:'<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    check:'<path d="M5 12.5l4.5 4.5L19 7"/>',
    trash:'<path d="M4 7h16"/><path d="M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1Z"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    up:'<path d="M6 15l6-6 6 6"/>',
    down:'<path d="M6 9l6 6 6-6"/>',
    download:'<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/>',
    copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5H7a2 2 0 0 0-2 2v8"/>',
    clock:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    calendar:'<rect x="4" y="5" width="16" height="16" rx="2"/><line x1="4" y1="9.5" x2="20" y2="9.5"/><line x1="9" y1="3" x2="9" y2="7"/><line x1="15" y1="3" x2="15" y2="7"/>',
    external:'<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
    edit:'<path d="M4 20h4L18 10l-4-4L4 16Z"/><path d="M13.5 6.5l4 4"/>',
    refresh:'<path d="M20 11a8 8 0 0 0-14-4.5L4 9"/><path d="M4 4.5V9h4.5"/><path d="M4 13a8 8 0 0 0 14 4.5L20 15"/><path d="M20 19.5V15h-4.5"/>',
    send:'<path d="M4.5 12 20 5l-6.5 15-2.5-6.2Z"/><path d="M11 13.8 20 5"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    pin:'<path d="M7 4h10v15l-5-3.5L7 19Z"/>',
    printer:'<path d="M7 9V4h10v5"/><path d="M7 18H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"/><rect x="7" y="15" width="10" height="6" rx="1"/>',
    link:'<path d="M9 14a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7L10 8.5"/><path d="M15 10a4 4 0 0 0-6-.5l-2 2A4 4 0 0 0 12.7 17L14 15.5"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3"/><line x1="12" y1="17" x2="12" y2="17"/>',
    arrow:'<line x1="5" y1="12" x2="18" y2="12"/><path d="M13 7l5 5-5 5"/>'
  };
  var sprite='<svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">';
  for(var k in ICONS) sprite+='<symbol id="i-'+k+'" viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+ICONS[k]+'</symbol>';
  sprite+='</svg>';

  var NAV=[
    ['ITRC管理組-任務看板.html','看板'],
    ['ITRC活動組-講師池排程.html','活動'],
    ['ITRC公關拉贊助小幫手.html','公關'],
    ['ITRC圖文小幫手.html','行銷'],
    ['ITRC證書產生器.html','證書'],
    ['使用說明.html','說明']
  ];

  function build(){
    if(!document.getElementById('i-board')){                // 注入圖示精靈（首頁也需要）
      var d=document.createElement('div');d.innerHTML=sprite;
      document.body.insertBefore(d.firstChild,document.body.firstChild);
    }
    var cur=decodeURIComponent((location.pathname.split('/').pop()||'').trim());
    if(cur===''||cur==='index.html')return;                 // 首頁不注入導覽列
    if(document.querySelector('.sitebar'))return;
    var nav=document.createElement('nav');nav.className='sitebar';
    var html='<a class="home" href="index.html"><svg class="svgic"><use href="#i-dashboard"></use></svg>幹部工具站</a><span class="bar">|</span>';
    NAV.forEach(function(p){
      html += (p[0]===cur) ? '<span class="cur">'+p[1]+'</span>' : '<a href="'+p[0]+'">'+p[1]+'</a>';
    });
    nav.innerHTML=html;document.body.insertBefore(nav,document.body.firstChild);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);
  else build();

  var t;
  window.itrcToast=function(msg){
    if(!t){t=document.createElement('div');t.className='itrc-toast';document.body.appendChild(t);}
    t.textContent=msg;t.classList.add('show');
    clearTimeout(t._h);t._h=setTimeout(function(){t.classList.remove('show');},1800);
  };
})();
