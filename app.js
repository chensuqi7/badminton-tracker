'use strict';

const L=Ledger, $=id=>document.getElementById(id);
const svgNS='http://www.w3.org/2000/svg';
const money=cents=>'¥'+(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
let state=L.empty(), stored=null, readable=true, lastQuick=null, quickBusy=false, quickNotice=null;
let uiMessage='', uiError='';
function showMessage(message){
  uiMessage=message;
  render();
  if(message)setTimeout(()=>{if(uiMessage===message){uiMessage='';render()}},2400);
}
function node(tag,text,cls){
  const n=document.createElement(tag);
  if(text!==undefined)n.textContent=text;
  if(cls)n.className=cls;
  return n;
}
function svgNode(tag,attrs){
  const n=document.createElementNS(svgNS,tag);
  for(const [name,value] of Object.entries(attrs))n.setAttribute(name,value);
  return n;
}
function svgIcon(name){
  const svg=svgNode('svg',{class:'icon',viewBox:'0 0 24 24','aria-hidden':'true'});
  svg.append(svgNode('path',{d:window.PrototypeUI.iconPath(name)}));
  return svg;
}
function button(label,action){
  const b=node('button',label);b.type='button';b.onclick=action;return b;
}
const cloud=window.DiaryCloud;
function read(){
  uiError='';
  const remote=cloud?.status();
  if(remote?.account||remote?.localLocked){
    readable=Boolean(remote.state);
    state=remote.state??{...L.empty(),openingHundredths:0};
    return;
  }
  try{
    const loaded=L.load(localStorage);
    state=loaded.state;stored=loaded.raw;readable=true;
  }catch(error){
    readable=false;state={...L.empty(),openingHundredths:0};
    uiError='账本读取或迁移失败，原始数据已保留。'+error.message;
  }
}
async function persist(next,message,recover=false){
  if(cloud?.status().account){await cloud.save(next,state);showMessage(message);return}
  if(cloud?.status().localLocked)throw Error('请登录后操作账本。');
  if(!readable&&!recover)throw Error('账本暂不可写，请先恢复备份。');
  const current=localStorage.getItem(L.key);
  if(!recover&&current!==stored){read();render();throw Error('另一个页面已更新账本，请关闭表单后重试。')}
  if(recover&&current!==null)localStorage.setItem(L.key+'-before-restore',current);
  const data=JSON.stringify(next);
  localStorage.setItem(L.key,data);
  state=next;stored=data;readable=true;
  showMessage(message);
}
async function safe(action){
  try{await action()}catch(error){showMessage(error.message);alert(error.message)}
}
function options(select,entries,value){
  for(const [key,label] of entries){const option=node('option',label);option.value=key;select.append(option)}
  select.value=value;
}
const sorted=rows=>[...rows].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
function render(){window.PrototypeUI.render()}
function promptEditor(title){
  $('editor-title').textContent=title;
  $('editor-fields').replaceChildren();
  $('close').textContent='取消';
  $('save-top').textContent='保存';
  $('editor-error').textContent='';
  $('save-editor').hidden=false;
  $('save-editor').textContent='确认保存';
  if(!$('editor').open)$('editor').showModal();
  return $('editor-fields');
}
function field(label,name,value,attrs={}){
  const wrapper=node('label',label), control=node(attrs.options?'select':'input');
  control.name=name;
  for(const [key,val] of Object.entries(attrs))if(key!=='options')control.setAttribute(key,val);
  if(attrs.options)options(control,attrs.options,value);else control.value=value??'';
  wrapper.append(control);$('editor-fields').append(wrapper);return control;
}
function submit(action){
  $('editor-form').onsubmit=async event=>{
    event.preventDefault();
    try{
      await action(Object.fromEntries(new FormData(event.currentTarget)));
      $('editor').close();
    }catch(error){$('editor-error').textContent=error.message}
  };
}
function cents(value){
  if(value==='')return null;
  if(!/^\d*(?:\.\d{1,2})?$/.test(value)||value==='.')throw Error('金额最多两位小数。');
  const [whole='',decimal='']=value.split('.');
  return Number(whole)*100+Number(decimal.padEnd(2,'0'));
}
const numeric={type:'number',step:'1',required:''};
const yuan={type:'number',min:'0',step:'.01',inputmode:'decimal',max:'1000000000'};
function remove(control,collection,r,question){
  control.append(button('删除记录',async ()=>{
    if(!confirm(question))return;
    try{await persist(L.change(state,collection,r.id,null),'已删除记录');$('editor').close()}
    catch(error){$('editor-error').textContent=error.message}
  }));
}
function recordEditor(kind,r,onlyOpening=false,selected=L.today()){
  if(r&&Life.all(state,'reconciliations').some(row=>row.adjustmentId===r.id)){
    const target=promptEditor('已确认的对账调整');$('save-editor').hidden=true;
    target.append(node('p','此流水与已确认对账关联。需要纠正时，请重新对账并填写原因。'));return;
  }
  const target=promptEditor(r?'编辑课时流水':onlyOpening?'期初余额校准':kind==='purchase'?'购买课时':'新增课时流水');
  field('日期','date',r?.date??selected,{type:'date',required:''});
  const available=onlyOpening?[['opening',L.kinds.opening]]:Object.entries(L.kinds).filter(([k])=>k!=='opening');
  const type=field('类型','kind',kind,{options:available});
  const qty=field('课时数量','qty',r?.qty??(onlyOpening?L.opening(state)/100:1),{...numeric,step:'.01',max:'1000000'});
  const bonus=field('赠送课时','bonus',r?.bonus??0,{...numeric,step:'.01',min:'0',max:'1000000'});
  const offset=field('历史欠课抵扣','offset',r?.offset??0,{...numeric,step:'.01',min:'0',max:'1000000'});
  const paid=field('实际支付（元，金额未知可留空）','amount',r?.cents==null?'':r.cents/100,yuan);
  field('备注','note',r?.note,{maxlength:'300'});
  const hint=node('p','', 'hint');target.append(hint);
  const configure=()=>{
    const purchase=type.value==='purchase', gift=type.value==='gift';
    for(const input of [bonus,offset,paid]){input.parentElement.hidden=!purchase;input.disabled=!purchase}
    qty.readOnly=gift;
    if(gift)qty.value=0;
    qty.min=['opening','adjust'].includes(type.value)?'-1000000':['credit','purchase','refund'].includes(type.value)?'.01':'0';
    if(r&&r.qty>0&&r.qty<1&&type.value===r.kind)qty.min='.01';
    hint.textContent=purchase?'确认后同步生成打球费用并标记培训购课。仅填写本次实际抵扣的欠课。':type.value==='opening'?'填写校准后的期初余额，原有流水继续参与计算。':type.value==='adjust'?'填写正数增加课时，负数扣减课时。':type.value==='credit'?'增加赠送课时。':type.value==='gift'?'登记赠送训练，扣课为 0。':'';
  };
  type.onchange=configure;configure();
  if(r)remove(target,'records',r,r.kind==='purchase'?'删除购课会重算余额，并同时移除关联打球费用。确认删除？':L.training(r)?'确认删除培训？课时余额和运动统计会同时重新计算。':'确认删除这条流水并重新计算余额？');
  submit(async form=>{
    const purchase=form.kind==='purchase';
    const draft={date:form.date,kind:form.kind,qty:Number(form.qty),bonus:purchase?Number(form.bonus):0,offset:purchase?Number(form.offset):0,cents:purchase?cents(form.amount):null,note:form.note.trim()};

    if(r?.kind==='purchase'&&!purchase&&!confirm('变更类型后会移除关联打球费用，确认继续？'))throw Error('已取消变更。');
    if(L.training(draft)&&state.records.some(x=>x.id!==r?.id&&L.training(x)&&x.date===draft.date)&&!confirm('当天已有训练流水，确认继续登记？'))throw Error('已取消登记。');
    await persist(L.change(state,'records',r?.id,draft),'课时流水已保存');
  });
}
function expenseEditor(r){
  const target=promptEditor(r?'编辑账单':'记一笔开销');
  target.append(LifeUI.segmented(['支出','退款'],index=>{if(index===1)refundEditor(r)}));
  const amount=field('金额（元）','amount',r?r.cents/100:'',{...yuan,required:'',placeholder:'0.00'});
  amount.closest('label').classList.add('money-field');
  field('消费日期','date',r?.date??L.today(),{type:'date',required:''});
  const selectedCategory=field('消费分类','category',r?.category??L.categories[0],{options:L.categories.map(c=>[c,c])});
  selectedCategory.closest('label').hidden=true;
  const categories=node('div',undefined,'expense-category-grid');
  const groupTitle=node('p','消费分类','field-caption');
  const categoryIcons=['shuttle','bag','racket','backup','racket','expenses'];
  const controls=L.categories.map((category,i)=>{
    const control=button(category,()=>{
      selectedCategory.value=category;
      controls.forEach(item=>item.setAttribute('aria-pressed',String(item===control)));
    });
    control.prepend(svgIcon(categoryIcons[i]));
    control.setAttribute('aria-pressed',String(selectedCategory.value===category));return control;
  });
  categories.setAttribute('role','group');categories.setAttribute('aria-label','消费分类');
  categories.append(...controls);target.append(groupTitle,categories);
  field('消费项目','item',r?.item,{required:'',maxlength:'100'});
  field('备注','note',r?.note,{maxlength:'300'});
  field('来源','source',r?.source??'manual',{options:[['manual','普通支出'],['historical-training','历史培训补录']]});
  target.append(node('p','历史培训补录归入打球费用，课时余额保持原样。','hint'));
  if(r){
    const linked=Life.collections.some(name=>Life.all(state,name).some(x=>x.expenseId===r.id));
    if(linked)target.append(node('p','这笔消费已有业务关联。请在对应业务中解除关联后删除。','hint'));
    else remove(target,'expenses',r,'确认删除这笔消费？');
  }
  submit(form=>{
    return persist(L.change(state,'expenses',r?.id,{date:form.date,category:form.source==='historical-training'?L.categories[0]:form.category,
      item:form.item.trim(),cents:cents(form.amount),note:form.note.trim(),source:form.source,businessId:null,
      ...(r?.refundCents===undefined?{}:{refundCents:r.refundCents,refundDate:r.refundDate})}),'消费已保存');
  });
}
function refundEditor(expense){
  const target=promptEditor('记一笔退款');
  target.append(LifeUI.segmented(['支出','退款'],index=>{if(index===0)expenseEditor(expense)},1));
  if(!state.expenses.length){
    target.append(node('p','暂无可关联的支出账单。','hint'));
    $('save-editor').hidden=true;return;
  }
  const picker=field('原支出','expenseId',expense?.id??'',{required:'',options:[['','请选择原支出'],...sorted(state.expenses).map(r=>[r.id,r.date+' · '+r.item+' · '+money(r.cents)])]});
  const amount=field('累计退款金额（元）','refund',expense?.refundCents==null?'':expense.refundCents/100,{...yuan,required:'',placeholder:'0.00'});
  amount.closest('label').classList.add('money-field');
  const date=field('退款日期','refundDate',expense?.refundDate??L.today(),{type:'date',required:''});
  picker.onchange=()=>{
    const original=state.expenses.find(row=>row.id===picker.value);
    amount.value=original?.refundCents==null?'':original.refundCents/100;
    date.value=original?.refundDate??L.today();
  };
  submit(form=>{
    const original=state.expenses.find(row=>row.id===form.expenseId), refund=cents(form.refund);
    if(!original||refund===null||refund>original.cents||form.refundDate<original.date)throw Error('请确认退款日期与金额。');
    return persist(L.change(state,'expenses',original.id,{...original,refundCents:refund,refundDate:form.refundDate}),'退款已保存');
  });
}
function download(name,body,type){
  const url=URL.createObjectURL(new Blob([body],{type})), link=node('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function csv(rows){
  const escape=value=>'"'+(typeof value==='number'?String(value):String(value??'').replace(/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/,"'$&")).replace(/"/g,'""')+'"';
  return '\ufeff'+rows.map(r=>r.map(escape).join(',')).join('\r\n');
}
const localImportReceipt='badminton-cloud-local-import';
async function importHistory(local,owner){
  const account=cloud.status().account;
  if(!account)throw Error('请先登录目标账号。');
  if(owner&&owner!==account.id)throw Error('此备份属于另一个账号，无法导入。');
  if(!cloud.status().state)throw Error('请先同步并打开云端账本。');
  const next=cloud.historical(local,state);
  const summary=(owner?'目标账号：':'文件未标记所属账号，请确认这是自己的账本。目标账号：')+account.email+'。合并后共有 '+next.records.length+' 条课时、'+next.expenses.length+' 条独立支出，余额 '+L.balance(next)+' 节。当前余额 '+L.balance(state)+' 节。';
  if(!confirm(summary+' 确认上传到个人账本？'))return false;
  await persist(next,'历史数据已加入待同步队列');$('editor').close();return true;
}
function cloudSettings(target){
  if(!cloud?.enabled)return;
  const info=cloud.status(), tools=node('div',undefined,'actions');
  target.append(node('p',info.account?.email||'尚未登录','hint'));
  target.append(node('p','最后同步 '+(info.last?new Date(info.last).toLocaleString():'—')+' · 待同步记录 '+info.pending,'hint'));
  if(info.error)target.append(node('p',info.error+'。可检查 Supabase 项目是否运行后重试。','error'));
  if(info.account)tools.append(
    button('立即同步',()=>safe(async()=>{await cloud.sync();settings()})),
    button(info.trustedOffline?'关闭此设备离线打开':'允许此设备离线打开',()=>safe(()=>{
      if(!info.trustedOffline&&!confirm('仅在私人设备启用。此设备保留当前登录会话时，可以离线打开账本。'))return;
      cloud.setOfflineTrust(!info.trustedOffline);settings();
    })),
    button('退出登录',()=>safe(async()=>{await cloud.logout();settings()}))
  );
  if(info.account?.legacyImport&&localStorage.getItem(localImportReceipt)!==info.account.id)
    tools.append(button('导入本机历史账本',()=>safe(async()=>{
      if(await importHistory(L.load(localStorage).state,info.account.id))
        localStorage.setItem(localImportReceipt,info.account.id);
    })));
  if(!info.account)tools.append(button('个人账号登录',()=>{
    promptEditor('登录羽球日记');
    field('邮箱','email','',{type:'email',required:'',autocomplete:'username'});
    field('密码','password','',{type:'password',required:'',autocomplete:'current-password'});
    $('save-editor').textContent='登录';$('save-top').textContent='登录';
    submit(form=>cloud.login(form.email,form.password));
  }));
  if(info.account?.role==='owner')tools.append(button('邀请及账户管理',openInvitation));
  if(info.error.startsWith('同步冲突'))tools.append(button('保留云端版本',()=>safe(async()=>{
    if(!confirm('请先导出本机 JSON。确认放弃本机尚未同步的修改？'))return;
    await cloud.discard();settings();
  })));
  target.append(tools);
}
function openInvitation(){
  return safe(async()=>{
    const account=cloud.status().account;
    if(account?.role!=='owner')throw Error('仅管理员可管理邀请。');
    const summary=await cloud.adminSummary();
    if(cloud.status().account?.id!==account.id)return;
    const panel=promptEditor('邀请球友');$('save-editor').hidden=true;
    panel.append(node('p',summary.enabled+' 个启用账号 · 共 '+summary.accounts+' 个账号'),
      node('p','在 Supabase 控制台创建经过确认的用户，再登记该用户的 UID。公开注册保持关闭。','hint'));
  });
}
let renderedAccount;
function refreshCloudStatus(){
  const id=cloud.status().account?.id;
  if(renderedAccount!==id){
    renderedAccount=id;lastQuick=null;quickNotice=null;uiMessage='';
    window.PrototypeUI.clearPrivateView();
    if($('editor').open)$('editor').close();
  }
  read();render();
}
window.addEventListener('diary-cloud',refreshCloudStatus);
window.addEventListener('offline',()=>{if(cloud?.enabled)refreshCloudStatus()});
function settings(mode){
  const titles={account:'个人账号',sync:'数据同步',backup:'数据备份与恢复',export:'导出数据',preferences:'应用设置'};
  const target=promptEditor(titles[mode]||'设置与数据管理');
  $('save-editor').hidden=true;
  $('editor-form').onsubmit=e=>e.preventDefault();
  const actions=node('div',undefined,'actions');
  actions.append(
    button('期初余额校准',()=>recordEditor('opening',state.records.find(r=>r.kind==='opening'),true)),
    button('每周培训目标',()=>{
      promptEditor('每周培训目标');field('每周培训次数','goal',Life.goal(state),{type:'number',min:1,max:7,required:''});
      submit(form=>persist({...state,settings:{...state.settings,weeklyGoal:Number(form.goal)}},'目标已保存'));
    }),
    button('月度预算',()=>{promptEditor('月度预算');field('预算（元，留空停用）','amount',state.settings.budget===null?'':state.settings.budget/100,yuan);
      submit(async form=>{const next={...state,settings:{...state.settings,budget:cents(form.amount)}};if(!L.valid(next))throw Error('预算无效。');await persist(next,'预算已保存')})}),
    button('导出 JSON',()=>safe(()=>{if(!readable)throw Error('无法读取当前账本，请导出原始数据。');download('羽球日记-'+L.today()+'.json',JSON.stringify(cloud?.status().account?{...state,ownerId:cloud.status().account.id}:state,null,2),'application/json')})),
    button('恢复 JSON',()=>$('import-file').click()),
    button('导出课时 CSV',()=>download('课时流水-'+L.today()+'.csv',csv([['日期','类型','课时','赠送','欠课抵扣','实付（元）','净课时','备注'],['','默认期初余额',L.opening(state)/100,0,0,null,L.opening(state)/100,''],...sorted(state.records).map(r=>[r.date,L.kinds[r.kind],r.qty,r.bonus,r.offset,r.cents===null?null:r.cents/100,L.delta(r,L.opening(state))/100,r.note])]),'text/csv;charset=utf-8')),
    button('导出消费 CSV',()=>download('运动开销-'+L.today()+'.csv',csv([['日期','分类','项目','实付（元）','备注','来源','关联ID','退款金额（元）','退款日期','创建时间','修改时间'],...sorted(L.expenses(state)).map(r=>[r.date,r.category,r.item,r.cents/100,r.note,r.source,r.businessId,r.refundCents==null?'':r.refundCents/100,r.refundDate,r.createdAt,r.updatedAt])]),'text/csv;charset=utf-8')),
    button('查看修改历史',()=>{const area=promptEditor('修改历史');$('save-editor').hidden=true;
      const names={create:'新增',update:'修改',delete:'删除'};
      for(const a of [...state.audit].reverse()){
        const detail=node('details');detail.append(node('summary',names[a.action]+' · '+new Date(a.at).toLocaleString()),node('p',JSON.stringify({操作前:a.before,操作后:a.after}),'hint'));detail.style.overflowWrap='anywhere';area.append(detail);
      }
      if(!state.audit.length)area.append(node('p','暂无修改历史','hint'));
    })
  );
  if(!readable&&!cloud?.status().localLocked)actions.append(button('导出原始数据',()=>safe(()=>download('羽球日记-原始账本.json',JSON.stringify({v3:localStorage.getItem(L.key),legacy:localStorage.getItem(L.legacyKey),migrationBackup:localStorage.getItem(L.backupKey),categoryBackup:localStorage.getItem(L.categoryBackupKey)}),'application/json'))));
  const sections={backup:['导出 JSON','恢复 JSON','导出原始数据'],export:['导出 JSON','导出课时 CSV','导出消费 CSV'],
    preferences:['期初余额校准','每周培训目标','月度预算','查看修改历史'],account:[],sync:[]};
  if(mode==='account'||mode==='sync'||!sections[mode])cloudSettings(target);
  if(sections[mode])for(const control of [...actions.children])
    if(!sections[mode].includes(control.textContent))control.remove();
  target.append(actions);
  if(mode==='preferences'||!sections[mode])target.append(node('p','羽球日记 V3.1 · 羽球生活','hint'));
}
$('import-file').onchange=async event=>{
  const file=event.target.files[0];
  if(!file)return;
  try{
    const target=cloud?.status().account?.id;
    const backup=JSON.parse(await file.text());
    if(target!==cloud?.status().account?.id)throw Error('登录账号已变更，请重新选择文件。');
    const next=L.restore(backup);
    if(target){await importHistory(next,backup.ownerId);return}
    if(backup.ownerId)throw Error('请登录备份所属账号后恢复。');
    if(confirm('恢复会替换当前账本。确认继续？')){await persist(next,'账本已恢复',true);$('editor').close()}
  }catch(error){alert('无法恢复：'+error.message)}
  finally{event.target.value=''}
};
$('close').onclick=()=>$('editor').close();
function expireQuickNotice(){
  const notice=quickNotice;
  if(!notice)return;
  setTimeout(()=>{if(quickNotice===notice&&!quickBusy){quickNotice=null;render()}},6500);
}
async function quickRecord(training){
  if(quickBusy||!readable)return;
  const date=L.today(), balance=L.balance(state);
  const count=training?state.records.filter(row=>row.date===date&&L.training(row)).length
    :Life.all(state,'activities').filter(row=>row.date===date).length;
  if(count&&!confirm(training?'今日已登记 '+count+' 次训练。再扣 1 节课时？':'今日已登记 '+count+' 次打球。确认再记一次？'))return;
  if(training&&balance<1&&!confirm('这次登记将产生超课，继续吗？'))return;
  quickBusy=true;quickNotice={date,message:'正在保存…'};render();
  const actor=cloud.status().account?.id;
  try{
    const collection=training?'records':'activities';
    const next=training?L.change(state,collection,null,{date,kind:'lesson',qty:1,bonus:0,offset:0,cents:null,note:''})
      :Life.change(state,collection,{date,place:'',minutes:null,note:'',expenseId:null});
    await persist(next,'');
    if(actor!==cloud.status().account?.id)return;
    lastQuick={collection,id:next[collection].at(-1).id};
    quickNotice={date,message:training?'训练已记录 · 已扣 1 节 · 剩余 '+L.balance(next)+' 节'
      :'打球已记录 · 今日 '+(count+1)+' 次 · 不扣课时'};
  }catch(error){if(actor===cloud.status().account?.id)quickNotice={date,message:'未能保存：'+error.message,error:true}}
  finally{quickBusy=false;render();expireQuickNotice()}
}
async function undoQuick(){
  if(quickBusy||!lastQuick)return;
  const {collection,id}=lastQuick, training=collection==='records', date=L.today(), actor=cloud.status().account?.id;
  quickBusy=true;render();
  try{
    const next=training?L.change(state,collection,id,null):Life.remove(state,collection,id);
    await persist(next,'');
    if(actor!==cloud.status().account?.id)return;
    lastQuick=null;
    quickNotice={date,message:training?'已撤销记课 · 剩余 '+L.balance(next)+' 节':'已撤销这次打球'};
  }catch(error){if(actor===cloud.status().account?.id)quickNotice={date,message:'未能撤销：'+error.message,error:true}}
  finally{quickBusy=false;render();expireQuickNotice()}
};
window.addEventListener('storage',event=>{if(event.key===L.key){read();render()}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){read();render()}});
let lastDate=L.today();
setInterval(()=>{const now=L.today();if(lastDate!==now){lastDate=now;render()}},30000);
read();render();
cloud?.init();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
