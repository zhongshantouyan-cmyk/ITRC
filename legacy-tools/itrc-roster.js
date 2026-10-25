/* 幹部權限資料：保留固定 ID、以合併匯入防止遺失，離任不刪除歷史。 */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ITRCRoster=api;}(typeof window!=='undefined'?window:this,function(){
  'use strict';
  var roles=['chair','advisor','treasurer','officer'];
  function text(v){return String(v==null?'':v).trim();}
  function inactive(r){return r.active===false||r.disabled===true||/^(inactive|retired|已卸任|離任|非當期名單|暫停|pending|待確認)$/i.test(text(r.status));}
  function normalize(value){return Object.values(value||{}).filter(function(r){return r&&typeof r==='object';}).map(function(r){
    var out=Object.assign({},r,{id:text(r.id),name:text(r.name),email:text(r.email),title:text(r.title||r.group),role:roles.indexOf(r.role)>=0?r.role:''});
    if(!out.id)throw new Error('舊名單有缺少固定 ID 的資料，請先由資訊組核對，避免產生重複人員。');
    if(inactive(out))out.role='';return out;
  });}
  function retire(row,user,now){var out=Object.assign({},row,{role:'',status:'retired',active:false,disabled:true,retiredAt:now,retiredBy:user&&user.uid||''});if(row.role)out.previousRole=row.role;return out;}
  function validate(rows){
    var ids=new Set(),emails=new Set(),personIds=new Set();
    rows.forEach(function(r){
      if(!r.id||ids.has(r.id))throw new Error('幹部 ID 缺漏或重複，請先修正。');ids.add(r.id);
      if(!text(r.name))throw new Error('每位幹部必須有姓名。');
      var email=text(r.email).toLowerCase();if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||emails.has(email)))throw new Error('信箱格式錯誤或重複，請先修正。');if(email)emails.add(email);
      if(r.personId){if(personIds.has(r.personId))throw new Error('主表幹部 ID 重複，請先修正。');personIds.add(r.personId);}
    });return rows;
  }
  function merge(current,incoming,user,now,idFactory){
    var out=normalize(current),seen=new Set();validate(out);
    incoming.forEach(function(input){
      var email=text(input.email).toLowerCase(),personId=text(input.personId);
      var byPerson=personId?out.find(function(r){return r.personId===personId;}):null;
      var byEmail=email?out.find(function(r){return text(r.email).toLowerCase()===email;}):null;
      if(byPerson&&byEmail&&byPerson.id!==byEmail.id)throw new Error('主表幹部 ID 與信箱指向不同的人，請先核對。');
      var old=byPerson||byEmail;
      if(!old&&!email){var names=out.filter(function(r){return !r.email&&r.name===text(input.name);});if(names.length===1)old=names[0];}
      var id=old?old.id:idFactory();if(seen.has(id))throw new Error('匯入資料重複指向同一位幹部。');seen.add(id);
      var row=Object.assign({},old||{id:id,role:'',status:'active'});
      ['name','email','title','personId','lineName','group','term'].forEach(function(field){if(input[field]!==undefined)row[field]=text(input[field]);});
      // 狀態、職稱不會把離任人員自動重新授權；復職須在管理頁另行啟用。
      if(input.status!==undefined){
        if(inactive({status:input.status}))row=retire(row,user,now);
        else if(!old||!inactive(old)){row.status='active';row.active=true;row.disabled=false;}
      }
      if(input.role!==undefined){if(input.role!==''&&roles.indexOf(input.role)<0)throw new Error('權限欄出現未知值，請先修正。');if(!inactive(row))row.role=input.role;}
      if(inactive(row))row.role='';
      var index=out.findIndex(function(r){return r.id===id;});if(index<0)out.push(row);else out[index]=row;
    });return validate(out);
  }
  return {roles:roles,inactive:inactive,normalize:normalize,retire:retire,validate:validate,merge:merge};
}));
