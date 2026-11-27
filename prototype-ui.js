'use strict';

window.PrototypeUI = (() => {
const icons={home:'M3 10l9-7 9 7v10h-6v-7H9v7H3z',calendar:'M3 5h18v16H3zM7 3v4m10-4v4M3 10h18',wallet:'M3 5h18v15H3zM3 9h18m-6 5h6',user:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-2a8 8 0 0 1 16 0v2',check:'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0m5 0 3 3 5-6',racket:'M12 13 3 22M12 13C3 4 17-3 21 4s-4 15-9 9M10 5l8 8m-9-4 7-6',shuttle:'M5 3l16 7-10 8-7-4zM5 3l3 13m5-9-3 10m-6-3-2 4a4 4 0 0 0 7 4l2-4',shirt:'M8 3l-5 3-2 5 5 2v8h12v-8l5-2-2-5-5-3c0 5-8 5-8 0z',string:'M3 12a9 7 0 1 0 18 0 9 7 0 0 0-18 0m3 0a6 4 0 1 0 12 0 6 4 0 0 0-12 0',box:'M3 5h18v16H3zM3 9h18m-11 0v5h4V9',more:'M5 12h1m5 0h1m5 0h1',cloud:'M6 18a5 5 0 1 1 1-10 6 6 0 0 1 11-1 5.5 5.5 0 0 1 0 11zM9 12l2 2 4-4',bag:'M5 6h14v15H5zM9 6V4h6v2M5 13h14',ticket:'M3 5h18v14H3zM15 5v14',clipboard:'M5 5h14v16H5zM9 3h6v4H9zM8 13l3 3 5-6',chart:'M4 3v18h17M8 16v-5m5 5V7m5 9V4',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',lock:'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',people:'M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6',settings:'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1z'};
let tab='首页', sub='', mode='日历', period='月度', month='', day='', gearId=null, half=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ico=name=>`<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[name]||icons.more}"/></svg>`;
const ci=['shuttle','shirt','racket','box','string','more'];
const palette=['#0087b5','#78b6db','#30677d','#00a779','#72cdb6','#c1d0d8'];
const btn=(text,action,cls='plain',disabled=false)=>`<button type="button" class="${cls}" data-a="${esc(action)}"${disabled?' disabled':''}>${text}</button>`;
const action=(type,id)=>type+':'+encodeURIComponent(id);
const cap=text=>`<div class="muted">${esc(text)}</div>`;
const head=(title,right='')=>`<div class="header"><div><div class="eyebrow">MY BADMINTON</div><h1>${esc(title)}</h1></div>${right}</div>`;
const back=title=>`<div class="header">${btn('‹ 返回','back')}<h2>${esc(title)}</h2><span></span></div>`;
const metric=(label,value,unit='')=>`${cap(label)}<div class="metric">${esc(value)} <small style="font-size:12px">${esc(unit)}</small></div>`;
const card=content=>`<section class="card">${content}</section>`;
const grid2=(a,b)=>`<div class="g2"><div>${a}</div><div>${b}</div></div>`;
const seg=(values,selected,key)=>`<div class="seg" role="group">${values.map(value=>btn(esc(value),key+':'+value,value===selected?'active':'')).join('')}</div>`;
const item=(icon,name,detail,value,target)=>btn(`<span class="icbg">${ico(icon)}</span><span class="detail"><strong>${esc(name)}</strong>${cap(detail)}</span><span class="num">${esc(value)}</span>`,target,'item');
const setting=(icon,title,target,value='›')=>btn(`<span class="icbg">${ico(icon)}</span><span>${esc(title)}</span><span class="muted">${esc(value)}</span>`,target,'settings-row');
const legend=`<div class="tiny heat-caption"><i class="dot" style="background:#00a779"></i>培训　<i class="dot" style="background:#0087b5"></i>日常打球</div>`;
const activityRows=()=>Life.activities(state);
const expenses=()=>L.expenses(state);
const ledger=()=>[...state.records].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
const gear=()=>Life.all(state,'equipment');
const strings=()=>Life.all(state,'stringings');
const reconciliations=()=>[...Life.all(state,'reconciliations')].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
const balance=()=>readable?L.balance(state):'—';
const titleFor=row=>row.type==='training'?L.kinds[row.kind]:'日常打球';
const monthLabel=value=>value.slice(0,4)+'年'+Number(value.slice(5,7))+'月';
function syncLabel(){
  const info=cloud.status();
  return !info.account?'本地':info.error?'同步异常':info.inFlight?'同步中':!navigator.onLine?'离线':info.pending?'待同步':'已同步';
}
function heat(start,count,rows){
  const flags=Life.dayTypes(rows), today=L.today();
  const columns=Math.ceil(count/7);
  return `<div class="heat" style="grid-template-columns:repeat(${columns},minmax(0,1fr))">${Array.from({length:columns*7},(_,index)=>{
    if(index>=count)return '<span class="heat-placeholder" aria-hidden="true"></span>';
    const date=L.shift(start,index), kind=flags.get(date)||0;
    if(date>today&&!kind)return '<span class="heat-placeholder" aria-hidden="true"></span>';
    const color=kind&1?'#00a779':kind?'#0087b5':'#e8f0ef';
    return `<button type="button" data-a="date:${date}" aria-label="${date}" title="${date}" style="--heat-color:${color}"></button>`;
  }).join('')}</div>`;
}
function home(){
  const now=L.today(), activities=activityRows(), monthRows=activities.filter(r=>r.date.startsWith(now.slice(0,7)));
  const gross=expenses().filter(r=>r.date.startsWith(now.slice(0,7))).reduce((n,r)=>n+r.cents,0);
  const refunds=expenses().filter(r=>r.refundDate?.startsWith(now.slice(0,7))).reduce((n,r)=>n+r.refundCents,0);
  const current=balance(), last=reconciliations()[0];
  const opening=L.opening(state)/100;
  const percent=typeof current==='number'&&opening>0?Math.max(0,Math.min(100,current/opening*100)):0;
  return head('羽球日记',btn(ico('cloud')+' '+syncLabel(),'sub:同步','secondary'))+
    card(`<div class="row">${cap('剩余培训课时')}<span class="pill">${current>5?'课时充足':'请核对课时'}</span></div><div class="big blue" style="margin:11px 0">${current} <small style="font-size:18px">节</small></div>${cap('预计还可训练 '+(readable?Math.max(0,Math.floor(current/Life.goal(state))):'—')+' 周')}<div class="bar"><i style="width:${percent}%"></i></div><div class="row">${cap('最近对账 · '+(last?.date||'尚未对账'))}${btn('课时对账 ›','sub:对账','link')}</div>`)+
    `<div class="g2" style="margin-bottom:13px">${btn(ico('check')+' '+'完成训练','train','primary',!readable||quickBusy)}${btn(ico('racket')+' 日常打球','casual','secondary',!readable||quickBusy)}</div>`+
    grid2(card(metric('本月运动天数',Life.dayTypes(monthRows).size,'天')+cap('培训 '+monthRows.filter(r=>r.type==='training').length+' 次 · 日常 '+monthRows.filter(r=>r.type==='casual').length+' 次')),
      card(metric('本月羽球开销',money(gross-refunds))+btn('查看消费分析 →','tab:开销','link')))+
    card(`<div class="row" style="margin-bottom:12px"><h2>运动轨迹</h2><span class="tiny">最近12周</span></div>${heat(L.shift(now,-83),84,activities)}${legend}`)+
    card(`<div class="g4">${[['wallet','记一笔','expense'],['ticket','购买课时','purchase'],['clipboard','课时对账','sub:对账'],['bag','我的球包','sub:球包']].map(([i,t,a])=>btn(`<span class="icbg">${ico(i)}</span>${t}`,a,'quick')).join('')}</div>`);
}
function calendar(){
  const first=month+'-01', rows=activityRows().filter(r=>r.date.startsWith(month)), flags=Life.dayTypes(rows), cells=[];
  for(let i=0;i<L.weekday(first);i++)cells.push('<span></span>');
  for(let date=first;date.startsWith(month);date=L.shift(date,1)){
    const kind=flags.get(date)||0;
    cells.push(btn(Number(date.slice(8))+`<span class="dots">${kind&1?'<i class="dot" style="background:#00a779"></i>':''}${kind&2?'<i class="dot" style="background:#0087b5"></i>':''}</span>`,'day:'+date,'day'+(day===date?' chosen':'')));
  }
  return card(`<div class="row" style="margin-bottom:18px">${btn('‹','prev')}<h2>${monthLabel(month)}</h2>${btn('›','next')}</div><div class="calendar">${[...'一二三四五六日'].map(x=>`<span class="tiny">${x}</span>`).join('')}${cells.join('')}</div>${legend}`)+
    card(`<div class="g3"><div>${metric('运动天数',flags.size,'天')}</div><div>${metric('培训',rows.filter(x=>x.type==='training').length,'次')}</div><div>${metric('日常',rows.filter(x=>x.type==='casual').length,'次')}</div></div>`)+
    card(`<div class="row"><h2>${Number(month.slice(5))}月${Number(day.slice(8))}日</h2>${btn('+ 补记','activity','link')}</div>${rows.filter(x=>x.date===day).map(r=>item('racket',titleFor(r),r.date,'›',action('activityEdit',r.id))).join('')||cap('当天暂无运动记录')}`);
}
function annualHeat(){
  const y=month.slice(0,4), now=L.today(), rows=activityRows().filter(r=>r.date.startsWith(y));
  const endOfYear=y+'-12-31', end=half===null&&y===now.slice(0,4)?now:endOfYear;
  const initial=half===null;
  const start=initial?L.shift(end,-181):y+(half===0?'-01-01':'-07-01');
  const displayEnd=initial?end:y+(half===0?'-06-30':'-12-31');
  const count=Math.round((Date.parse(displayEnd)-Date.parse(start))/86400000)+1;
  const visible=(initial?activityRows():rows).filter(row=>row.date>=start&&row.date<=displayEnd);
  const plot=visible.length
    ?`<div style="margin:20px 0">${heat(start,count,visible)}</div>${legend}`
    :`<div class="heat-empty"><span class="icbg">${ico('chart')}</span>${cap('该时段暂无运动记录')}</div>`;
  return card(`<h2>年度运动轨迹 · ${y}</h2>${plot}<div class="line"></div>${grid2(metric('累计运动天数',Life.dayTypes(rows).size,'天'),metric('累计运动次数',rows.length,'次'))}`)+
    `<div class="range-line">${btn('‹ 上一年','yearPrev','link')}${btn(half===null?'近 26 周 ↔':half?'7–12 月 ↔':'1–6 月 ↔','half','link')}${btn('下一年 ›','yearNext','link')}</div>`;
}
function recon(withBack=false){
  const rows=reconciliations(), last=rows[0];
  return (withBack?back('课时对账'):'')+card(grid2(
    `<div style="background:#e9f5fa;padding:14px;border-radius:12px">${metric('系统记录余额',balance(),'节')}</div>`,
    `<div style="background:#e7f5ee;padding:14px;border-radius:12px">${metric('教练确认余额',last?.confirmed??'—','节')}</div>`)+
    cap('最近对账 · '+(last?.date||'尚未对账'))+btn('发起课时对账','reconcile','primary wide'))+
    card('<h2>历史对账</h2>'+(rows.map(r=>item('clipboard',r.date,r.reason||r.note||'余额核对',r.before+' → '+r.confirmed,action('reconDetail',r.id))).join('')||cap('暂无对账记录')));
}
function sport(){
  return head('运动',btn('+','activity','secondary'))+seg(['日历','热力图','课时流水','对账'],mode,'mode')+
    (mode==='日历'?calendar():mode==='热力图'?annualHeat():mode==='对账'?recon():
      card(cap('当前剩余课时')+`<div class="big blue">${balance()} 节</div><div class="g2">${btn('补记课程','lesson','secondary')}${btn('购买课时','purchase','primary')}</div>`)+
      card('<h2>课时明细</h2>'+ledger().map(r=>{
        const delta=L.delta(r,L.opening(state))/100;
        return item('ticket',L.kinds[r.kind],r.date+(r.note?' · '+r.note:''),(delta>0?'+':'')+delta+'节',action('lessonEdit',r.id));
      }).join('')+item('ticket','期初余额','初始课时',L.opening(state)/100+' 节','opening')));
}
function expenseList(rows){
  return rows.length?[...rows].sort((a,b)=>b.date.localeCompare(a.date)).map(row=>item(ci[L.categories.indexOf(row.category)],row.refundEntry?'退款 · '+row.item:row.item,row.date+' · '+row.category,money(row.cents),action(row.refundEntry?'refundEdit':'expenseEdit',row.id))).join(''):cap('暂无消费记录');
}
let exclude=false;
function spending(){
  const key=period==='年度'?month.slice(0,4):month;
  const included=L.filterExpenses(expenses(),!exclude), rows=included.filter(r=>r.date.startsWith(key));
  const refunds=included.filter(r=>r.refundCents&&r.refundDate.startsWith(key)).map(r=>({...r,date:r.refundDate,cents:-r.refundCents,refundEntry:true}));
  const total=rows.reduce((n,r)=>n+r.cents,0), tuition=rows.filter(L.isPurchaseExpense).reduce((n,r)=>n+r.cents,0);
  const values=L.categories.map(c=>rows.filter(r=>r.category===c).reduce((n,r)=>n+r.cents,0));
  let end=0;
  const slices=values.map((v,i)=>{const from=end;end+=total?v/total*100:0;return palette[i]+' '+from+'% '+end+'%'});
  const months=Array.from({length:period==='年度'?12:6},(_,i)=>{
    const year=Number(month.slice(0,4)), selected=Number(month.slice(5));
    return L.day(new Date(year,period==='年度'?i:selected-6+i,1,12)).slice(0,7);
  });
  const series=months.map(m=>included.filter(r=>r.date.startsWith(m)).reduce((n,r)=>n+r.cents,0)), maximum=Math.max(...series,1);
  return head('开销',btn('+','expense','secondary'))+seg(['月度','年度','账单'],period,'period')+
    `<div class="row" style="margin-bottom:12px">${btn('‹','prev')}<strong>${period==='年度'?key+'年':monthLabel(month)}</strong>${btn('›','next')}</div>`+
    (period==='账单'?card('<h2>消费明细</h2>'+expenseList([...rows,...refunds])):
    card(`<div class="row">${cap(period==='年度'?'年度实际支出':'本月实际支出')}<span class="pill">${rows.length} 笔</span></div><div class="money blue">${money(total)}</div><div class="line"></div>${grid2(metric('培训购课',money(tuition)),metric('其他支出',money(total-tuition)))}${refunds.length?cap('退款 '+money(-refunds.reduce((n,r)=>n+r.cents,0))+' · 净支出 '+money(total+refunds.reduce((n,r)=>n+r.cents,0))):''}<label class="muted expense-exclude"><input type="checkbox" data-a="exclude"${exclude?' checked':''}> 不包含一次性培训购课</label>`)+
    card(`<h2 style="margin-bottom:17px">消费构成</h2><div class="row"><div class="ring" style="background:${total?'conic-gradient('+slices.join(',')+')':'#e9f0f2'}"><div class="ringinner">${money(total)}<span class="tiny">合计支出</span></div></div><div style="flex:1;min-width:0">${L.categories.map((c,i)=>`<div class="row category-line"><span><i class="dot" style="background:${palette[i]}"></i>${c}</span><strong>${money(values[i])}</strong></div>`).join('')}</div></div>`)+
    card(`<div class="row"><h2>消费趋势</h2>${cap(period==='年度'?'全年':'近6个月')}</div><div class="chart" style="margin-top:16px">${series.map((v,i)=>`<div class="column" title="${money(v)}"><i style="height:${v/maximum*85+2}%;background:${months[i]===month?'#0087b5':'#79cdb6'}"></i><small>${Number(months[i].slice(5))}月</small></div>`).join('')}</div>`)+
    card(`<div class="row"><h2>最近账单</h2>${btn('全部 ›','period:账单','link')}</div>${expenseList([...rows,...refunds].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3))}`))+
    btn('+ 记一笔开销','expense','primary wide');
}
function mine(){
  const info=cloud.status(), labels=info.account?.email||'尚未登录';
  return head('我的')+card(item('user',labels,'个人账号','›','sub:账号'))+
    card(setting('bag','我的球包','sub:球包',gear().length+' 件 ›')+setting('clipboard','课时对账','sub:对账')+
      setting('chart','年度消费分析','annual')+(info.account?.role==='owner'?setting('people','邀请球友','sub:邀请'):'')+
      setting('string','穿线记录','sub:穿线'))+
    card(setting('cloud','数据同步','sub:同步',syncLabel()+' ›')+setting('download','数据备份与恢复','sub:备份')+
      setting('lock','账号与安全','sub:账号')+setting('settings','关于羽球日记','preferences','V3.1'));
}
function gearPage(){
  if(sub==='球包')return back('我的球包')+card(grid2(metric('装备数量',gear().length,'件'),metric('穿线记录',strings().length,'次')))+
    gear().map(r=>card(item(r.type==='racket'?'racket':'bag',r.name,[r.brand,Life.statuses[r.status]].filter(Boolean).join(' · '),r.cents===null?'—':money(r.cents),action('gearOpen',r.id)))).join('')+
    btn('+ 添加装备','gearNew','primary wide');
  const row=gear().find(r=>r.id===gearId);
  if(!row)return gearPageFallback();
  const rows=strings().filter(r=>r.equipmentId===row.id).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  const fees=rows.reduce((n,r)=>{
    const payment=state.expenses.find(e=>e.id===r.expenseId);
    return n+(payment?payment.cents-(payment.refundCents??0):0);
  },0);
  return back('装备详情')+card(`<div class="gear-art">${ico(row.type==='racket'?'racket':'bag')}</div><h2 style="margin-top:16px">${esc(row.name)}</h2>${cap([row.brand,row.model,row.date].filter(Boolean).join(' · '))}<div class="line"></div>${grid2(metric('购买价格',row.cents===null?'—':money(row.cents)),metric('维护费用',money(fees)))}${btn('编辑装备',action('gearEdit',row.id),'link')}`)+
    (row.type==='racket'?card(`<div class="row"><h2>穿线记录</h2>${btn('+ 新增','stringNew','link')}</div>`+stringList(rows)):'');
}
function gearPageFallback(){return back('我的球包')+card(cap('装备已删除或不存在'))}
function stringList(rows){
  return rows.map(r=>item('string',r.model+([r.main,r.cross].filter(x=>x!==null).length?' · '+[r.main,r.cross].filter(x=>x!==null).join(' / ')+' lbs':''),r.date,r.cents===null?'—':money(r.cents),action('stringEdit',r.id))).join('')||cap('暂无穿线记录');
}
function other(){
  const info=cloud.status();
  if(sub==='对账')return recon(true);
  if(sub==='球包'||sub==='装备详情')return gearPage();
  if(sub==='穿线')return back('穿线记录')+card(stringList(strings()));
  if(sub==='邀请')return back('邀请球友')+card('<h2>邀请制使用</h2>'+cap('每位球友拥有独立账号、课时和账单。')+btn('邀请与账号管理','invite','primary wide'));
  if(sub==='备份')return back('数据备份与恢复')+card('<h2>保护你的运动记录</h2>'+btn('立即备份','backup','primary wide'))+
    card(setting('download','导出 JSON','backup')+setting('download','导出消费 CSV','export')+setting('cloud','恢复备份','restore'));
  if(sub==='同步')return back('数据同步')+card(`<h2 class="green">${esc(syncLabel())}</h2><div class="line"></div>${cap('待同步 '+info.pending+' 条')}${info.error?cap(info.error):''}${btn(info.account?'立即同步':'个人账号登录',info.account?'sync':'account','primary wide')}`)+card(setting('settings','同步与离线设置','syncSettings'));
  return back('账号与安全')+card(item('user',info.account?.email||'尚未登录','个人账号','›','account')+setting('lock','账号管理','account'));
}
function render(){
  const root=document.getElementById('prototype');
  if(!root)return;
  if(!month){const now=L.today();month=now.slice(0,7);day=now}
  const body=sub?other():tab==='首页'?home():tab==='运动'?sport():tab==='开销'?spending():mine();
  const feedback=tab==='首页'&&!sub&&quickNotice?.date===L.today()
    ?`<div class="toast quick-toast" role="status">${esc(quickNotice.message)}${lastQuick?btn('撤销','undo','link',quickBusy):''}</div>`:'';
  root.innerHTML=(uiError?card(cap(uiError)):'')+body+`<nav class="nav" aria-label="底部导航">${[['首页','home'],['运动','calendar'],['开销','wallet'],['我的','user']].map(([name,icon])=>btn(ico(icon)+name,'tab:'+name,name===tab?'active':'')).join('')}</nav>`+feedback+(!feedback&&uiMessage?`<div class="toast" role="status">${esc(uiMessage)}</div>`:'');
}
function setMonth(offset){
  const target=new Date(Number(month.slice(0,4)),Number(month.slice(5))-1+offset,1,12);
  if(target.getFullYear()<1900||target.getFullYear()>9998)return;
  month=L.day(target).slice(0,7);day=month+'-01';
}
function handle(event){
  const target=event.target.closest('[data-a]');
  if(!target)return;
  const [kind,value='']=target.dataset.a.split(':',2), id=decodeURIComponent(value);
  const record=()=>state.records.find(r=>r.id===id), payment=()=>expenses().find(r=>r.id===id);
  let reset=false;
  switch(kind){
    case 'tab':tab=id;sub='';reset=true;break;
    case 'sub':sub=id;reset=true;break;
    case 'back':sub=sub==='装备详情'?'球包':'';reset=true;break;
    case 'mode':mode=id;break;
    case 'period':period=id;break;
    case 'annual':tab='开销';period='年度';sub='';reset=true;break;
    case 'prev':case 'next':setMonth((kind==='prev'?-1:1)*(tab==='开销'&&period==='年度'?12:1));break;
    case 'yearPrev':case 'yearNext':setMonth(kind==='yearPrev'?-12:12);half=null;break;
    case 'half':half=half===null?0:half===0?1:null;break;
    case 'day':day=id;break;
    case 'date':return LifeUI.dayDetails(id,activityRows());
    case 'exclude':exclude=target.checked;break;
    case 'train':return quickRecord(true);
    case 'casual':return quickRecord(false);
    case 'undo':return undoQuick();
    case 'activity':return LifeUI.activityEditor(null,day);
    case 'activityEdit':{
      const row=activityRows().find(r=>r.id===id);
      if(row)return row.type==='training'?recordEditor(row.kind,state.records.find(r=>r.id===row.ledgerId)):LifeUI.activityEditor(row);
      return;
    }
    case 'lesson':return recordEditor('lesson',null,false,day);
    case 'lessonEdit':if(record())return recordEditor(record().kind,record());return;
    case 'opening':return recordEditor('opening',state.records.find(r=>r.kind==='opening'),true);
    case 'purchase':return recordEditor('purchase');
    case 'expense':return expenseEditor();
    case 'expenseEdit':if(payment())return L.isPurchaseExpense(payment())?recordEditor('purchase',state.records.find(r=>r.id===payment().businessId)):expenseEditor(payment());return;
    case 'refundEdit':if(payment())return refundEditor(payment());return;
    case 'reconcile':return LifeUI.reconcile();
    case 'reconDetail':{
      const row=reconciliations().find(r=>r.id===id);
      if(row){
        const fields=promptEditor('对账详情');$('save-editor').hidden=true;
        fields.append(node('p',row.date+' · '+row.before+' → '+row.confirmed+' 节'),node('p',row.reason||row.note||'余额核对'));
      }
      return;
    }
    case 'gearOpen':gearId=id;sub='装备详情';reset=true;break;
    case 'gearNew':return LifeUI.equipmentEditor();
    case 'gearEdit':return LifeUI.equipmentEditor(gear().find(r=>r.id===id));
    case 'stringNew':return LifeUI.stringEditor(gear().find(r=>r.id===gearId));
    case 'stringEdit':{
      const row=strings().find(r=>r.id===id);
      if(row)return LifeUI.stringEditor(gear().find(r=>r.id===row.equipmentId),row);
      return;
    }
    case 'invite':return openInvitation();
    case 'backup':return settings('backup');
    case 'export':return settings('export');
    case 'restore':return $('import-file').click();
    case 'sync':return safe(async()=>{await cloud.sync();render()});
    case 'syncSettings':return settings('sync');
    case 'account':return settings('account');
    case 'preferences':return settings('preferences');
    default:return;
  }
  render();
  if(reset)window.scrollTo(0,0);
}
document.getElementById('prototype').addEventListener('click',handle);
function goLedger(){tab='运动';mode='课时流水';sub='';render();window.scrollTo(0,0)}
function clearPrivateView(){if(sub==='装备详情')sub='球包';gearId=null}
return {render,goLedger,clearPrivateView,iconPath:name=>icons[name==='backup'?'download':name==='expenses'?'wallet':name]||icons.more};
})();
