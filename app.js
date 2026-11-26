'use strict';

const L=Ledger, $=id=>document.getElementById(id);
const svgNS='http://www.w3.org/2000/svg';
const money=cents=>'¥'+(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const sum=rows=>rows.reduce((n,r)=>n+r.cents,0);
const icons={home:'M3 10l9-7 9 7v10h-6v-6H9v6H3z',history:'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5',expenses:'M3 6h18v13H3z M3 9h18 M15 14h3',stats:'M4 20h16 M7 16v-4 M12 16V5 M17 16V8',settings:'M4 7h16 M4 12h16 M4 17h16 M8 5v4 M16 10v4 M10 15v4'};
const colors=['#0087B5','#00A779','#3E687C','#57BBD0','#5E9C87','#8493A2'];
let state=L.empty(), stored=null, readable=true, previousBalance, lastQuick=null, dayAtRender='';
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
  svg.append(svgNode('path',{d:icons[name]}));
  return svg;
}
function button(label,action){
  const b=node('button',label);b.type='button';b.onclick=action;return b;
}
function read(){
  try{
    const loaded=L.load(localStorage);
    state=loaded.state;stored=loaded.raw;readable=true;
  }catch(error){
    readable=false;
    $('warning').hidden=false;
    $('warning').textContent='账本读取或迁移失败，原始数据已保留。请检查存储空间，或在设置中恢复备份。'+error.message;
  }
}
function persist(next,message,recover=false){
  if(!readable&&!recover)throw Error('账本暂不可写，请先恢复备份。');
  const current=localStorage.getItem(L.key);
  if(!recover&&current!==stored){read();render();throw Error('另一个页面已更新账本，请关闭表单后重试。')}
  if(recover&&current!==null)localStorage.setItem(L.key+'-before-restore',current);
  const data=JSON.stringify(next);
  localStorage.setItem(L.key,data);
  state=next;stored=data;readable=true;render();
  $('status').textContent=message;
}
function safe(action){
  try{action()}catch(error){$('status').textContent=error.message;alert(error.message)}
}
function options(select,entries,value){
  for(const [key,label] of entries){const option=node('option',label);option.value=key;select.append(option)}
  select.value=value;
}
const pages={home:'首页',history:'流水',expenses:'开销',stats:'统计'};
function navigate(page){
  for(const key of Object.keys(pages)){
    $(key+'-page').hidden=key!==page;
    if(key===page)$('nav-'+key).setAttribute('aria-current','page');
    else $('nav-'+key).removeAttribute('aria-current');
  }
  render();window.scrollTo(0,0);
}
for(const [key,label] of Object.entries(pages)){
  const b=button(label,()=>navigate(key));b.id='nav-'+key;b.prepend(svgIcon(key));$('nav').append(b);
}
$('nav-home').setAttribute('aria-current','page');
$('settings').append(svgIcon('settings'));
options($('kind-filter'),[['','全部类型'],...Object.entries(L.kinds)],'');
options($('category-filter'),[['','全部分类'],...L.categories.map(c=>[c,c])],'');
const currentMonth=L.today().slice(0,7);
$('period-value').value=$('calendar-month').value=currentMonth;
$('stats-year').value=currentMonth.slice(0,4);
$('period').onchange=()=>{
  const field=$('period-value'), year=$('period').value==='year';
  field.type=year?'number':'month';
  field.min=year?'1900':'';field.max=year?'9999':'';
  field.value=L.today().slice(0,year?4:7);
  $('period-label').textContent=year?'年份':'月份';render();
};
for(const id of ['from','to','kind-filter','category-filter','calendar-month','period-value','stats-year','include-purchases'])$(id).onchange=render;

function metric(container,values){
  $(container).replaceChildren(...values.map(([name,value])=>{const n=node('div',name);n.append(node('b',value));return n}));
}
const weekdays=['一','二','三','四','五','六','日'];
function calendar(id,keys,days,date){
  const el=$(id);el.replaceChildren(...weekdays.map(d=>node('small',d)));
  for(const key of keys){
    const cell=node('span',key?Number(key.slice(-2)):'',key?'day'+(days.has(key)?' trained':'')+(date===key?' current':''):'');
    if(key)cell.setAttribute('aria-label',key+(days.has(key)?' 已训练':''));
    el.append(cell);
  }
}
function list(id,rows,emptyText,getInfo,action){
  const target=$(id);
  target.replaceChildren();
  if(!rows.length)target.append(node('small',emptyText));
  for(const r of rows){
    const [label,sub,amount]=getInfo(r);
    const row=node('div',undefined,'row'), text=node('div');
    text.append(node('strong',label),node('small',sub));row.append(text,node('strong',amount,'amount'));
    if(action)row.append(button('编辑',()=>action(r)));
    target.append(row);
  }
}
const sorted=rows=>[...rows].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
const recordInfo=r=>[L.kinds[r.kind],r.date+(r.note?' · '+r.note:''), (L.delta(r)>0?'+':'')+L.delta(r)/100+' 节'];
const expenseInfo=r=>[r.item,r.date+' · '+r.category+(L.isPurchaseExpense(r)?' · 培训购课':r.source==='historical-training'?' · 历史培训':'')+(r.note?' · '+r.note:''),money(r.cents)];
const categoryTotals=rows=>L.categories.map(category=>sum(rows.filter(r=>r.category===category)));
function chart(id,kind,values){
  const ring=kind==='ring', svg=svgNode('svg',{viewBox:ring?'0 0 120 120':'0 0 360 132',role:'img','aria-label':ring?'支出分类占比':'月度开销趋势'});
  if(ring){
    const total=values.reduce((a,b)=>a+b,0);
    const props={cx:60,cy:60,r:42,fill:'none','stroke-width':13,pathLength:100,transform:'rotate(-90 60 60)'};
    svg.append(svgNode('circle',{...props,stroke:'#E2F1FA'}));
    let start=0;
    values.forEach((value,i)=>{
      if(!value)return;
      const part=value*100/total;
      svg.append(svgNode('circle',{...props,stroke:colors[i],'stroke-dasharray':part+' '+(100-part),'stroke-dashoffset':-start}));
      start+=part;
    });
  }else{
    const max=Math.max(...values,1);
    values.forEach((value,i)=>{
      const height=value*96/max;
      svg.append(svgNode('rect',{x:i*30+6,y:100-height,width:18,height,rx:3,fill:i%2?'#00A779':'#0087B5'}));
      const label=svgNode('text',{x:i*30+15,y:118,'text-anchor':'middle','font-size':10,fill:'#526778'});
      label.textContent=i+1;svg.append(label);
    });
  }
  $(id).replaceChildren(svg);
}
function render(){
  const date=L.today(), month=date.slice(0,7), stats=L.trainingStats(state,date), balance=L.balance(state);
  dayAtRender=date;
  const weeks=Math.max(0,Math.floor(balance)), paid=state.records.filter(r=>r.kind==='purchase'), expenses=L.expenses(state);
  const consumed=state.records.filter(L.training).reduce((n,r)=>n+L.units(r.qty),0);
  const positive=state.records.reduce((n,r)=>r.kind==='opening'?n:n+Math.max(0,L.delta(r)),Math.max(0,L.units(state.records.find(r=>r.kind==='opening')?.qty??22)));
  $('today').textContent=new Intl.DateTimeFormat('zh-CN',{dateStyle:'full'}).format(new Date());
  $('remaining').textContent=readable?balance:'—';
  if(previousBalance!==undefined&&previousBalance!==balance&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    $('remaining').animate?.([{opacity:.55},{opacity:1}],{duration:230});
  }
  previousBalance=balance;
  $('progress').value=positive?Math.min(100,Math.max(0,balance*10000/positive)):0;
  $('used').textContent=consumed/100+' 节';
  $('bought').textContent=paid.reduce((n,r)=>n+L.units(r.qty),0)/100+' 节';
  $('weeks').textContent=weeks+' 周';
  if(readable){
    const warning=balance<0?'已超课 '+(-balance)+' 节':balance===0?'课时已用完':balance<=1?'剩余 1 节以内':balance<=3?'剩余 3 节以内':balance<=5?'剩余 5 节以内':'';
    $('warning').hidden=!warning;$('warning').textContent=warning;
  }
  $('week-state').textContent=stats.complete?'本周已完成':'目标每周 1 节';
  $('quick').textContent=stats.days.has(date)?'今日已记课 · 再记一次':'完成今日训练 · −1节';
  $('quick').disabled=!readable;
  $('undo').hidden=!(lastQuick&&state.records.some(r=>r.id===lastQuick));
  calendar('week-calendar',weekdays.map((_,i)=>L.shift(stats.start,i)),stats.days,date);
  $('home-spend').textContent=money(sum(expenses.filter(r=>r.date.startsWith(month))));
  const recent=sorted([...state.records.map(r=>({...r,record:true})),...state.expenses]).slice(0,5);
  list('recent',recent,'暂无记录',r=>r.record?recordInfo(r):expenseInfo(r));
  const history=sorted(state.records.filter(r=>(!$('from').value||r.date>=$('from').value)&&(!$('to').value||r.date<=$('to').value)&&(!$('kind-filter').value||r.kind===$('kind-filter').value)));
  list('history',history,'暂无匹配流水',recordInfo,r=>recordEditor(r.kind,r));
  const yearMode=$('period').value==='year';
  const picked=$('period-value').value;
  const period=(yearMode?/^\d{4}$/:/^\d{4}-(0[1-9]|1[0-2])$/).test(picked)?picked:date.slice(0,yearMode?4:7);
  const periodRows=L.filterExpenses(expenses.filter(r=>r.date.startsWith(period)),$('include-purchases').checked), total=sum(periodRows), amounts=categoryTotals(periodRows);
  $('spend').textContent=money(total);$('expense-count').textContent=periodRows.length+' 笔';
  $('budget-status').textContent=!yearMode&&state.settings.budget!==null?'月预算 '+money(state.settings.budget)+(total>state.settings.budget?' · 已超出 '+money(total-state.settings.budget):' · 剩余 '+money(state.settings.budget-total)):'';
  chart('expense-chart','ring',amounts);
  const breakdown=$('expense-breakdown');breakdown.replaceChildren();
  amounts.forEach((amount,i)=>{
    const row=node('div',undefined,'row'), label=node('div',L.categories[i]), dot=node('span',undefined,'legend-dot');
    dot.style.backgroundColor=colors[i];label.prepend(dot);row.append(label,node('small',money(amount)+' · '+(total?amount*100/total:0).toFixed(1)+'%'));breakdown.append(row);
  });
  list('expense-list',sorted(periodRows.filter(r=>!$('category-filter').value||r.category===$('category-filter').value)),'暂无匹配支出',expenseInfo,r=>L.isPurchaseExpense(r)?recordEditor('purchase',state.records.find(x=>x.id===r.businessId)):expenseEditor(r));
  const next=stats.complete?L.shift(stats.last,7):date;
  const forecast=weeks&&weeks<50000?L.shift(next,(weeks-1)*7):'—';
  metric('training-metrics',[['本月训练',stats.month+' 次'],['年度训练',stats.year+' 次'],['连续完成',stats.streak+' 周'],['距上次训练',stats.last?Math.round((Date.parse(date)-Date.parse(stats.last))/86400000)+' 天':'—'],['预计剩余训练',weeks+' 周'],['估算耗尽日期',forecast]]);
  const monthSelection=$('calendar-month').value;
  const calendarMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(monthSelection)?monthSelection:month;
  const first=calendarMonth+'-01', keys=Array(L.weekday(first)).fill(null);
  for(let d=first;d.startsWith(calendarMonth);d=L.shift(d,1))keys.push(d);
  calendar('month-calendar',keys,stats.days,date);
  const year=/^\d{4}$/.test($('stats-year').value)?$('stats-year').value:date.slice(0,4);
  const annual=expenses.filter(r=>r.date.startsWith(year)), annualTotal=sum(annual);
  const monthly=Array.from({length:12},(_,i)=>sum(annual.filter(r=>r.date.startsWith(year+'-'+String(i+1).padStart(2,'0')))));
  const monthCount=year===date.slice(0,4)?Number(month.slice(-2)):12;
  const tuition=sum(annual.filter(L.isPurchaseExpense));
  metric('spend-metrics',[['年度累计',money(annualTotal)],['月均消费',money(Math.round(annualTotal/monthCount))],['培训购课支出占比',annualTotal?(tuition*100/annualTotal).toFixed(1)+'%':'—']]);
  chart('trend','bars',monthly);
  metric('trend-values',monthly.map((value,i)=>[i+1+' 月',money(value)]));
  const cost=L.costs(state);
  metric('cost-metrics',[['购课实付合计',paid.some(r=>r.cents!==null)?money(paid.reduce((n,r)=>n+(r.cents??0),0))+(paid.some(r=>r.cents===null)?'（部分缺失）':''):'未知'],['已消耗课程成本',cost.unknown?'部分未知'+(cost.known?' · 已知 '+money(cost.known):''):money(cost.known)]]);
}
function promptEditor(title){
  $('editor-title').textContent=title;
  $('editor-fields').replaceChildren();
  $('editor-error').textContent='';
  $('save-editor').hidden=false;
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
  $('editor-form').onsubmit=event=>{
    event.preventDefault();
    try{
      action(Object.fromEntries(new FormData(event.currentTarget)));
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
  control.append(button('删除记录',()=>{
    if(!confirm(question))return;
    try{persist(L.change(state,collection,r.id,null),'已删除记录');$('editor').close()}
    catch(error){$('editor-error').textContent=error.message}
  }));
}
function recordEditor(kind,r,onlyOpening=false){
  const target=promptEditor(r?'编辑课时流水':onlyOpening?'期初余额校准':kind==='purchase'?'购买课时':'新增课时流水');
  field('日期','date',r?.date??L.today(),{type:'date',required:''});
  const available=onlyOpening?[['opening',L.kinds.opening]]:Object.entries(L.kinds).filter(([k])=>k!=='opening');
  const type=field('类型','kind',kind,{options:available});
  const qty=field('课时数量','qty',r?.qty??(onlyOpening?22:1),{...numeric,step:r&&!Number.isInteger(r.qty)?'.01':'1',max:'1000000'});
  const bonus=field('赠送课时','bonus',r?.bonus??0,{...numeric,min:'0',max:'1000000'});
  const offset=field('历史欠课抵扣','offset',r?.offset??0,{...numeric,min:'0',max:'1000000'});
  const paid=field('实际支付（元，金额未知可留空）','amount',r?.cents==null?'':r.cents/100,yuan);
  field('备注','note',r?.note,{maxlength:'300'});
  const hint=node('p','', 'hint');target.append(hint);
  const configure=()=>{
    const purchase=type.value==='purchase', gift=type.value==='gift';
    for(const input of [bonus,offset,paid]){input.parentElement.hidden=!purchase;input.disabled=!purchase}
    qty.readOnly=gift;
    if(gift)qty.value=0;
    qty.min=['opening','adjust'].includes(type.value)?'-1000000':['credit','purchase','refund'].includes(type.value)?'1':'0';
    if(r&&r.qty>0&&r.qty<1&&type.value===r.kind)qty.min='.01';
    hint.textContent=purchase?'确认后同步生成打球费用并标记培训购课。仅填写本次实际抵扣的欠课。':type.value==='opening'?'填写校准后的期初余额，原有流水继续参与计算。':type.value==='adjust'?'填写正数增加课时，负数扣减课时。':type.value==='credit'?'增加赠送课时。':type.value==='gift'?'登记赠送训练，扣课为 0。':'';
  };
  type.onchange=configure;configure();
  if(r)remove(target,'records',r,r.kind==='purchase'?'删除购课会重算余额，并同时移除关联打球费用。确认删除？':'确认删除这条流水并重新计算余额？');
  submit(form=>{
    const purchase=form.kind==='purchase';
    const draft={date:form.date,kind:form.kind,qty:Number(form.qty),bonus:purchase?Number(form.bonus):0,offset:purchase?Number(form.offset):0,cents:purchase?cents(form.amount):null,note:form.note.trim()};
    if((!r||r.qty!==draft.qty)&&!Number.isInteger(draft.qty))throw Error('新增或修改课时数量时请输入整数。');
    if(r?.kind==='purchase'&&!purchase&&!confirm('变更类型后会移除关联打球费用，确认继续？'))throw Error('已取消变更。');
    if(L.training(draft)&&state.records.some(x=>x.id!==r?.id&&L.training(x)&&x.date===draft.date)&&!confirm('当天已有训练流水，确认继续登记？'))throw Error('已取消登记。');
    persist(L.change(state,'records',r?.id,draft),'课时流水已保存');
  });
}
function expenseEditor(r){
  const target=promptEditor(r?'编辑支出':'新增支出');
  field('消费日期','date',r?.date??L.today(),{type:'date',required:''});
  field('支出类别','category',r?.category??L.categories[0],{options:L.categories.map(c=>[c,c])});
  field('消费项目','item',r?.item,{required:'',maxlength:'100'});
  field('实付金额（元）','amount',r?r.cents/100:'',{...yuan,required:''});
  field('备注','note',r?.note,{maxlength:'300'});
  field('来源','source',r?.source??'manual',{options:[['manual','普通支出'],['historical-training','历史培训补录']]});
  target.append(node('p','历史培训补录归入打球费用，课时余额保持原样。','hint'));
  if(r)remove(target,'expenses',r,'确认删除这笔消费？');
  submit(form=>persist(L.change(state,'expenses',r?.id,{date:form.date,category:form.source==='historical-training'?L.categories[0]:form.category,item:form.item.trim(),cents:cents(form.amount),note:form.note.trim(),source:form.source,businessId:null}),'消费已保存'));
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
function settings(){
  const target=promptEditor('设置与数据管理');
  $('save-editor').hidden=true;
  $('editor-form').onsubmit=e=>e.preventDefault();
  const actions=node('div',undefined,'actions');
  actions.append(
    button('期初余额校准',()=>recordEditor('opening',state.records.find(r=>r.kind==='opening'),true)),
    button('月度预算',()=>{promptEditor('月度预算');field('预算（元，留空停用）','amount',state.settings.budget===null?'':state.settings.budget/100,yuan);
      submit(form=>{const next={...state,settings:{budget:cents(form.amount)}};if(!L.valid(next))throw Error('预算无效。');persist(next,'预算已保存')})}),
    button('导出 JSON',()=>safe(()=>{if(!readable)throw Error('无法读取当前账本，请导出原始数据。');download('羽球日记-'+L.today()+'.json',JSON.stringify(state,null,2),'application/json')})),
    button('恢复 JSON',()=>$('import-file').click()),
    button('导出课时 CSV',()=>download('课时流水-'+L.today()+'.csv',csv([['日期','类型','课时','赠送','欠课抵扣','实付（元）','净课时','备注'],['','默认期初余额',22,0,0,null,22,''],...sorted(state.records).map(r=>[r.date,L.kinds[r.kind],r.qty,r.bonus,r.offset,r.cents===null?null:r.cents/100,L.delta(r)/100,r.note])]),'text/csv;charset=utf-8')),
    button('导出消费 CSV',()=>download('运动开销-'+L.today()+'.csv',csv([['日期','分类','项目','实付（元）','备注','来源','关联ID','创建时间','修改时间'],...sorted(L.expenses(state)).map(r=>[r.date,r.category,r.item,r.cents/100,r.note,r.source,r.businessId,r.createdAt,r.updatedAt])]),'text/csv;charset=utf-8')),
    button('查看修改历史',()=>{const area=promptEditor('修改历史');$('save-editor').hidden=true;
      const names={create:'新增',update:'修改',delete:'删除'};
      for(const a of [...state.audit].reverse()){
        const detail=node('details');detail.append(node('summary',names[a.action]+' · '+new Date(a.at).toLocaleString()),node('p',JSON.stringify({操作前:a.before,操作后:a.after}),'hint'));detail.style.overflowWrap='anywhere';area.append(detail);
      }
      if(!state.audit.length)area.append(node('p','暂无修改历史','hint'));
    })
  );
  if(!readable)actions.append(button('导出原始数据',()=>safe(()=>download('羽球日记-原始账本.json',JSON.stringify({v3:localStorage.getItem(L.key),legacy:localStorage.getItem(L.legacyKey),migrationBackup:localStorage.getItem(L.backupKey),categoryBackup:localStorage.getItem(L.categoryBackupKey)}),'application/json'))));
  target.append(actions,node('p','羽球日记 3.0.1 · 数据仅保存在当前设备。','hint'));
}
$('import-file').onchange=async event=>{
  const file=event.target.files[0];
  if(!file)return;
  try{
    const next=L.restore(JSON.parse(await file.text()));
    if(confirm('恢复会替换当前账本。确认继续？')){persist(next,'账本已恢复',true);$('editor').close()}
  }catch(error){alert('无法恢复：'+error.message)}
  finally{event.target.value=''}
};
$('close').onclick=()=>$('editor').close();
$('settings').onclick=settings;
$('buy').onclick=()=>recordEditor('purchase');
$('backfill').onclick=$('new-record').onclick=()=>recordEditor('lesson');
$('quick-expense').onclick=$('new-expense').onclick=()=>expenseEditor();
$('quick').onclick=()=>safe(()=>{
  const date=L.today(), stats=L.trainingStats(state,date), repeated=stats.days.has(date), low=L.balance(state)<1;
  if((repeated||low)&&!confirm((repeated?'今天已记课，确认再登记一节？':'本次登记将产生超课，确认继续？')+(repeated&&low?' 本次登记将产生超课。':'')))return;
  const next=L.change(state,'records',null,{date,kind:'lesson',qty:1,bonus:0,offset:0,cents:null,note:''});
  lastQuick=next.records[next.records.length-1].id;
  persist(next,'今日训练已保存');
});
$('undo').onclick=()=>safe(()=>{
  if(lastQuick&&confirm('撤销最近一笔快捷记课？'))persist(L.change(state,'records',lastQuick,null),'已撤销记课');
});
window.addEventListener('storage',event=>{if(event.key===L.key){read();render()}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){read();render()}});
setInterval(()=>{if(dayAtRender!==L.today())render()},30000);
read();render();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
