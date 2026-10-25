/* ITRC 共用登入閘 — Firebase Auth (Google) + 角色白名單
   ─────────────────────────────────────────────
   正式環境：Google 登入；角色讀自 RTDB roles，以 Email 比對白名單。
   測試環境（localhost / 127.0.0.1 / file://）：
     顯示「角色切換器」，免真的登入即可切換 幹部 / 審核 / 財務 來驗證流程。
   用法：
     ITRCAuth.init({ onChange:function(user){ ... } });
     user = {uid,name,role,title,email} 或 role=null（已登入但尚未授權）或 user=null（未登入）。
       title = 名單職稱（如「資訊長／資訊組員」），供依組別鎖頁用（如資訊組維護手冊）。
     ITRCAuth.has('treasurer') / ITRCAuth.can('approve') / ITRCAuth.can('treasury')
     ITRCAuth.signIn() / ITRCAuth.signOut()
   需在頁面載入 firebase-app / -auth / -database compat SDK 才會走正式模式。
*/
(function(){
  var CFG = {
    apiKey:"AIzaSyBG41luYP0eyt9UUeuS0lybKTqWYi1GpLc",
    authDomain:"itrc-workspace.firebaseapp.com",
    databaseURL:"https://itrc-workspace-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:"itrc-workspace",
    storageBucket:"itrc-workspace.firebasestorage.app",
    messagingSenderId:"462903407211",
    appId:"1:462903407211:web:9cc9217dcef3c97cf2372e"
  };
  var ROLES = ['chair','advisor','treasurer','officer'];
  var ROLE_LABEL = {chair:'社長／副社長', advisor:'顧問', treasurer:'財務長', officer:'幹部'};
  /* 能力對照：roster=編輯幹部名單與權限；approve=核銷簽核；treasury=編輯收支表＋核銷入帳；
     ledger=檢視收支表；apply=申請核銷。roster（改權限）只給 正副社長＋顧問；正副社長另兼簽核。*/
  var CAPS = {
    chair:    ['roster','approve','ledger','apply'],
    advisor:  ['roster','ledger','apply'],
    treasurer:['treasury','ledger','apply'],
    officer:  ['ledger','apply'],
    '':       []
  };
  /* 永久萬能管理員（防鎖死救命索）：這些信箱一律視為最高權限（所有能力），
     不受 roles 名單影響——永遠能編輯名單、進財務站、解鎖。換屆走光也不會死鎖。*/
  var SUPER_ADMINS = ['zhongshantouyan@gmail.com'];

  // 測試模式：僅本機 localhost／127.0.0.1／file:// 開啟。
  // ?dev=1 也只在本機環境生效——正式網站一律走真實 Google 登入，
  // 避免任何人加 ?dev=1 就跳出角色切換器、繞過登入冒充社長（資安修正）。
  var isLocal = location.hostname==='localhost' || location.hostname==='127.0.0.1'
             || location.hostname==='::1' || location.protocol==='file:';
  var isDev = isLocal;
  var authGeneration = 0;
  var roleWatch = null;

  var A = window.ITRCAuth = {
    user:null, mode:null, db:null,
    ROLES:ROLES, ROLE_LABEL:ROLE_LABEL, onChange:null,
    init:init, signIn:signIn, signOut:signOut, has:has, can:can, isDev:function(){return A.mode==='dev';},
    setRoleLocal:setRoleLocal
  };

  function has(roles){ if(!A.user||!A.user.role) return false; if(!roles) return true;
    roles=[].concat(roles); return roles.indexOf(A.user.role)>=0; }
  function can(cap){ if(!A.user) return false; if(A.user.superAdmin) return true;
    var role=A.user.role; if(!role) return false; return (CAPS[role]||[]).indexOf(cap)>=0; }
  function emit(){ if(typeof A.onChange==='function') A.onChange(A.user); }

  function init(opts){
    opts=opts||{}; if(opts.onChange) A.onChange=opts.onChange;
    if(isDev){
      A.mode='dev';
      try{ if(typeof firebase!=='undefined'){ if(!(firebase.apps&&firebase.apps.length))firebase.initializeApp(CFG); A.db=firebase.database(); } }catch(e){}
      var saved=null; try{saved=JSON.parse(localStorage.getItem('itrc_dev_user')||'null');}catch(e){}
      A.user = saved || {uid:'dev-officer', name:'測試·幹部', role:'officer', email:'dev@local'};
      renderDevBar(); emit(); return;
    }
    A.mode='prod';
    if(typeof firebase==='undefined' || typeof firebase.auth!=='function' || typeof firebase.database!=='function'){
      A.mode='unavailable'; A.user=null; emit(); return;
    }
    if(!(firebase.apps&&firebase.apps.length))firebase.initializeApp(CFG);
    A.db=firebase.database();
    firebase.auth().onAuthStateChanged(function(u){
      var generation=++authGeneration;
      if(roleWatch){roleWatch.ref.off('value',roleWatch.fn);roleWatch=null;}
      if(!u){ A.user=null; emit(); return; }
      if(u.emailVerified===false){A.user={uid:u.uid,name:u.displayName||u.email,role:null,email:u.email};emit();return;}
      // 角色以 email 在 roles 名單比對（可在登入前就由管理組指派）
      var ref=A.db.ref('roles');
      var accept=function(s){
        if(generation!==authGeneration) return;
        var list=s.val()||{}, email=(u.email||'').toLowerCase(), matches=[];
        if(SUPER_ADMINS.indexOf(email)>=0){ // 救命索：永遠顧問級顯示，superAdmin 短路所有能力（全權）
          var superUser={uid:u.uid, name:u.displayName||u.email, role:'advisor', email:u.email, superAdmin:true};
          if(JSON.stringify(A.user)!==JSON.stringify(superUser)){A.user=superUser;emit();}return;
        }
        Object.keys(list).forEach(function(k){ var r=list[k];
          if(r&&r.email&&String(r.email).toLowerCase()===email&&r.disabled!==true&&r.active!==false&&!/^(inactive|retired|已卸任|離任|非當期名單|暫停)$/i.test(String(r.status||''))&&ROLES.indexOf(r.role)>=0)matches.push(r);
        });
        var found=matches.length===1?matches[0]:null;
        var next = found
          ? {uid:u.uid, name:found.name||u.displayName||u.email, role:found.role, title:found.title||'', email:u.email}
          : {uid:u.uid, name:u.displayName||u.email, role:null, email:u.email}; // 已登入、尚未授權
        if(JSON.stringify(A.user)!==JSON.stringify(next)){A.user=next;emit();}
      };
      var denied=function(){if(generation!==authGeneration)return;A.user={uid:u.uid,name:u.displayName||u.email,role:null,email:u.email};emit();};
      if(typeof ref.on==='function'){roleWatch={ref:ref,fn:accept};ref.on('value',accept,denied);}
      else ref.once('value').then(accept).catch(denied);
    });
  }

  function signIn(){
    if(A.mode!=='prod') return;
    var p=new firebase.auth.GoogleAuthProvider();
    return firebase.auth().signInWithPopup(p).catch(function(e){ alert('登入失敗：'+e.message); return null; });
  }
  function signOut(){ if(A.mode==='prod') return firebase.auth().signOut(); }

  function setRoleLocal(role){
    var label=(ROLE_LABEL[role]||'').replace(/（.*?）/,'')||'訪客';
    A.user={uid:'dev-'+role, name:'測試·'+label, role:role, email:'dev@local'};
    try{localStorage.setItem('itrc_dev_user',JSON.stringify(A.user));}catch(e){}
    document.querySelectorAll('[data-devrole]').forEach(function(x){
      x.style.outline = x.getAttribute('data-devrole')===role ? '2px solid #ffd479' : '';});
    emit();
  }

  function renderDevBar(){
    function build(){
      if(document.getElementById('itrcDevBar')) return;
      var bar=document.createElement('div'); bar.id='itrcDevBar';
      bar.style.cssText='background:#7a2e2e;color:#fff;font:600 12px "Microsoft JhengHei",system-ui;padding:6px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      var lab=document.createElement('span'); lab.textContent='● 測試模式（未串接真實登入）切換身分：'; bar.appendChild(lab);
      ROLES.forEach(function(r){
        var b=document.createElement('button'); b.textContent=ROLE_LABEL[r]; b.setAttribute('data-devrole',r);
        b.style.cssText='border:1px solid #ffffff55;background:#00000030;color:#fff;border-radius:6px;padding:3px 9px;cursor:pointer;font:inherit';
        if(A.user&&A.user.role===r) b.style.outline='2px solid #ffd479';
        b.onclick=function(){ setRoleLocal(r); };
        bar.appendChild(b);
      });
      document.body.insertBefore(bar, document.body.firstChild);
    }
    if(document.body) build(); else document.addEventListener('DOMContentLoaded', build);
  }
})();
