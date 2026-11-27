'use strict';

const LifeUI = (() => {
  const categories=()=>L.categories.map(c=>[c,c]);
  const choice=items=>Object.entries(items);
  const dayLabel=['无运动','培训','日常打球','培训与日常打球'];
  const dateField=(value)=>field('日期','date',value,{type:'date',required:''});
  const noteField=value=>field('备注','note',value,{maxlength:'300'});
  const save=(next,message)=>{
    if(!L.valid(next))throw Error('请核对日期、金额与关联数据。');
    return persist(next,message);
  };
  const byDate=rows=>[...rows].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  const putCard=(parent,title,id)=>{
    const card=node('article',undefined,'card');
    card.append(node('h2',title));
    if(id)card.id=id;
    $(parent).append(card);
    return card;
  };
  function expenseFields(row,category){
    const used=new Set(Life.collections.flatMap(name=>Life.all(state,name).filter(x=>x.id!==row?.id).map(x=>x.expenseId)));
    const choices=state.expenses.filter(x=>!used.has(x.id)&&(!category||x.category===category));
    field('消费联动','link',row?(row.expenseId?'keep':'none'):'auto',{options:[
      ...(row?.expenseId?[['keep','保留关联与账单金额'],['update','同步更新关联账单金额']]:[]),
      ['auto','按填写金额新增消费'],['existing','关联已有消费'],['none','仅保存档案']
    ]});
    field('已有消费','expenseId','',{options:[['','请选择'],...choices.map(x=>[x.id,x.date+' · '+x.item+' · '+money(x.cents)])]});
    field('金额（元，可选）','amount',row?.cents==null?'':row.cents/100,yuan);
  }
  function resolveExpense(next,row,form,category,name){
    const amount=cents(form.amount);
    let id=null;
    if(form.link==='keep'||form.link==='update'){
      id=row?.expenseId;
      if(!id)throw Error('关联账单不存在。');
      if(form.link==='update'){
        const old=next.expenses.find(x=>x.id===id);
        if(!old||amount===null)throw Error('请填写关联账单金额。');
        next=L.change(next,'expenses',id,{...old,cents:amount},{deferValidation:true});
      }
    }else if(form.link==='existing'){
      id=form.expenseId;
      if(!next.expenses.some(x=>x.id===id))throw Error('请选择已有消费。');
    }else if(form.link==='auto'&&amount!==null){
      next=L.change(next,'expenses',null,{date:form.date,cents:amount,item:name,category,note:form.note,source:'manual',businessId:null},{deferValidation:true});
      id=next.expenses.at(-1).id;
    }
    return {next,id,amount};
  }
  function removeEntry(container,name,row){
    container.append(button('删除记录',()=>safe(async()=>{
      if(name==='equipment'&&Life.all(state,'stringings').some(x=>x.equipmentId===row.id)){
        throw Error('这件装备有穿线历史，请将状态改为已退役或已出售，以保留历史。');
      }
      if(!confirm('确认删除此记录？历史消费默认保留。'))return;
      let next=Life.remove(state,name,row.id);
      if(row.expenseId&&confirm('这笔关联支出也是错误录入，需要一并撤销吗？'))
        next=L.change(next,'expenses',row.expenseId,null,{deferValidation:true});
      await save(next,'已删除记录');$('editor').close();
    })));
  }
  function activityEditor(row,selected=L.today()){
    const target=promptEditor(row?'编辑日常打球':'补记日常打球');
    dateField(row?.date??selected);
    field('时长（分钟，可选）','minutes',row?.minutes,{type:'number',min:1,max:1440});
    field('地点（可选）','place',row?.place,{maxlength:120});
    noteField(row?.note);
    expenseFields(row,'打球费用');
    if(row)removeEntry(target,'activities',row);
    submit(async form=>{
      const {next,id}=resolveExpense(state,row,form,'打球费用','日常打球');
      await save(Life.change(next,'activities',{id:row?.id,date:form.date,minutes:form.minutes?Number(form.minutes):null,place:form.place,note:form.note,expenseId:id}),'日常打球已保存');
    });
  }
  function equipmentEditor(row){
    const target=promptEditor(row?'编辑装备':'新增装备');
    field('装备类型','type',row?.type??'racket',{options:choice(Life.types)});
    field('名称','name',row?.name,{required:'',maxlength:100});
    field('品牌','brand',row?.brand,{maxlength:100});
    field('型号','model',row?.model,{maxlength:100});
    field('规格（可选）','spec',row?.spec,{maxlength:100});
    field('状态','status',row?.status??'active',{options:choice(Life.statuses)});
    field('购买日期','date',row?.date??L.today(),{type:'date',required:''});
    noteField(row?.note);
    field('其他装备支出类别','category','其他',{options:categories()});
    expenseFields(row);
    if(row)removeEntry(target,'equipment',row);
    submit(async form=>{
      const category=['racket','bag'].includes(form.type)?'球拍装备':['shoes','apparel'].includes(form.type)?'球鞋服饰':form.category;
      const {next,id,amount}=resolveExpense(state,row,form,category,form.name.trim());
      await save(Life.change(next,'equipment',{id:row?.id,type:form.type,name:form.name.trim(),brand:form.brand,model:form.model,spec:form.spec,
        status:form.status,date:form.date,note:form.note,cents:amount,expenseId:id}),'装备已保存');
    });
  }
  function stringEditor(gear,row){
    const target=promptEditor(row?'编辑穿线':'登记穿线');
    dateField(row?.date??L.today());
    field('球线品牌','brand',row?.brand,{maxlength:100});
    field('球线型号','model',row?.model,{required:'',maxlength:100});
    for(const [label,key] of [['主线磅数（可作统一磅数）','main'],['横线磅数','cross']])
      field(label,key,row?.[key],{type:'number',min:'0.01',max:100,step:'.01'});
    field('门店（可选）','shop',row?.shop,{maxlength:120});
    field('更换原因（可选）','reason',row?.reason,{maxlength:300});
    field('断线日期（可选）','broken',row?.broken,{type:'date'});
    noteField(row?.note);
    expenseFields(row,'穿线维护');
    if(row)removeEntry(target,'stringings',row);
    submit(async form=>{
      const {next,id,amount}=resolveExpense(state,row,form,'穿线维护',gear.name+' · 穿线');
      await save(Life.change(next,'stringings',{id:row?.id,equipmentId:gear.id,date:form.date,brand:form.brand,model:form.model.trim(),
        main:form.main?Number(form.main):null,cross:form.cross?Number(form.cross):null,shop:form.shop,reason:form.reason,
        broken:form.broken||null,note:form.note,cents:amount,expenseId:id}),'穿线记录已保存');
    });
  }
  const paid=row=>state.expenses.find(x=>x.id===row.expenseId);
  const net=row=>row.cents-(row.refundCents??0);
  const actual=row=>paid(row)?net(paid(row)):0;
  const tension=r=>[r.main,r.cross].filter(x=>x!==null).join('/')||'—';
  function gearDetails(gear){
    const target=promptEditor(gear.name);$('save-editor').hidden=true;
    const history=byDate(Life.all(state,'stringings').filter(row=>row.equipmentId===gear.id));
    const current=history[0], maintenance=history.reduce((n,r)=>n+actual(r),0);
    target.append(node('p',[gear.brand,gear.model,gear.spec,Life.statuses[gear.status]].filter(Boolean).join(' · ')),
      node('p','购买于 '+gear.date+' · '+(gear.cents===null?'价格未填写':money(gear.cents))),
      node('p','累计实际支出 '+money(actual(gear)+maintenance)+' · 穿线 '+history.length+' 次 · 维护 '+money(maintenance)));
    if(current)target.append(node('p','最近穿线 '+current.date+' · '+current.brand+' '+current.model+' · '+tension(current)+' 磅'));
    const actions=node('div',undefined,'actions');
    actions.append(button('编辑装备',()=>equipmentEditor(gear)));
    if(gear.type==='racket')actions.append(button('登记穿线',()=>stringEditor(gear)));
    target.append(actions);
    for(const row of history){
      const newer=history[history.indexOf(row)-1];
      const end=row.broken||newer?.date||L.today(), days=Math.max(0,(Date.parse(end)-Date.parse(row.date))/86400000);
      target.append(button(row.date+' · '+row.model+' · '+tension(row)+' 磅 · '+days+' 天',()=>stringEditor(gear,row)));
    }
  }
  function reconcile(){
    const target=promptEditor('课时对账'), balance=L.balance(state);
    const last=byDate(Life.all(state,'reconciliations'))[0];
    target.append(node('p','当前系统余额 '+balance+' 节'));
    if(last){
      const newer=state.records.filter(r=>r.date>last.date||r.date===last.date&&r.createdAt>last.createdAt);
      const purchases=newer.filter(r=>r.kind==='purchase').reduce((n,r)=>n+L.units(r.qty),0)/100;
      const spent=newer.filter(L.training).reduce((n,r)=>n+L.units(r.qty),0)/100;
      target.append(node('p','上次 '+last.date+' · 教练确认 '+last.confirmed+' 节'),
        node('p','上次后购课 '+purchases+' 节 · 已消课 '+spent+' 节'));
    }
    dateField(L.today());
    const confirmed=field('教练确认余额','confirmed',balance,{type:'number',step:'.01',required:''});
    const difference=node('p','差异 0 节','hint');target.append(difference);
    confirmed.oninput=()=>{difference.textContent='差异 '+(Math.round((Number(confirmed.value)-balance)*100)/100)+' 节'};
    field('差异原因','reason','',{maxlength:300});noteField('');
    target.append(button('查看课时流水',()=>{$('editor').close();navigate('history');$('history').scrollIntoView()}));
    submit(async form=>{
      const status=cloud.status();
      if(status.account){
        if(!navigator.onLine)throw Error('请联网确认对账。');
        await cloud.sync();
        const latest=cloud.status();
        if(latest.error||latest.pending||status.account.id!==latest.account?.id)throw Error('请先同步现有流水。');
      }
      if(L.balance(state)!==balance)throw Error('课时余额已变化，请关闭后重新对账。');
      const final=Number(form.confirmed), adjustment=(L.units(final)-L.units(balance))/100;
      if(!Life.quantity(final)||!Life.quantity(adjustment))throw Error('请输入有效课时数，最多两位小数。');
      if(adjustment&&(!form.reason.trim()||!confirm('确认以教练余额为准，增加一条 '+adjustment+' 节的调整流水？')))
        throw Error('有差异时请填写原因并确认调整。');
      let next=state, adjustmentId=null;
      if(adjustment){
        next=L.change(next,'records',null,{date:form.date,kind:'adjust',qty:adjustment,note:form.reason,cents:null,bonus:0,offset:0});
        adjustmentId=next.records.at(-1).id;
      }
      await save(Life.change(next,'reconciliations',{date:form.date,before:balance,confirmed:final,adjustment,adjustmentId,reason:form.reason,note:form.note}),'对账已保存');
    });
  }
  function dayDetails(date,rows){
    const target=promptEditor(date+' 运动记录');$('save-editor').hidden=true;
    const day=byDate(rows.filter(r=>r.date===date));
    if(!day.length)target.append(node('p','当天没有运动记录。','hint'));
    for(const row of day)target.append(button(row.type==='training'?L.kinds[row.kind]:'日常打球'+(row.place?' · '+row.place:''),
      ()=>row.type==='training'?recordEditor(row.kind,state.records.find(r=>r.id===row.ledgerId)):activityEditor(row)));
    const actions=node('div',undefined,'actions');
    actions.append(button('补记培训',()=>recordEditor('lesson',null,false,date)),button('补记日常打球',()=>activityEditor(null,date)));
    target.append(actions);
  }
  function activityCell(date,flags,rows,heat){
    const cell=button(heat?'':String(Number(date.slice(-2))),()=>dayDetails(date,rows));
    cell.className=(heat?'heat-cell':'day')+' activity-'+flags;
    cell.title=date+' · '+dayLabel[flags];cell.setAttribute('aria-label',cell.title);
    return cell;
  }
  function heatmap(root,start,end,rows){
    const days=Life.dayTypes(rows);
    root.replaceChildren();
    for(let i=0;i<L.weekday(start);i++)root.append(node('span'));
    for(let date=start;date<=end;date=L.shift(date,1))root.append(activityCell(date,days.get(date)||0,rows,true));
  }
  const monthMove=(value,amount)=>{
    const [y,m]=value.split('-').map(Number);
    return L.day(new Date(y,m-1+amount,1,12)).slice(0,7);
  };
  function setup(){
    const home=$('week-calendar').parentElement;
    const quick=node('div',undefined,'actions');
    quick.append(button('登记今天打球',()=>safe(async()=>{
      if(!readable)throw Error('请先登录。');
      await save(Life.change(state,'activities',{date:L.today(),place:'',minutes:null,note:'',expenseId:null}),'日常打球已保存');
    })),button('补记打球详情',()=>activityEditor()),button('课时对账',reconcile),button('我的球包',()=>{navigate('stats');$('equipment-list').closest('article').scrollIntoView()}));
    home.append(quick);
    const balance=$('remaining').closest('article');
    const last=node('p',undefined,'hint');last.id='last-reconciliation';balance.append(last);
    const compact=putCard('home-page','最近 12 周运动');
    const homeHeat=node('div',undefined,'heatmap');homeHeat.id='home-heat';compact.append(homeHeat);
    const calendarCard=putCard('history-page','运动日历');
    $('history-page').prepend(calendarCard);
    const navigation=node('div',undefined,'actions');
    for(const [label,amount] of [['上个月',-1],['下个月',1],['回到今天',0]])navigation.append(button(label,()=>{
      $('calendar-month').value=amount?monthMove($('calendar-month').value||L.today().slice(0,7),amount):L.today().slice(0,7);render();
    }));
    const oldCalendar=$('calendar-month').closest('label');
    calendarCard.append(oldCalendar,navigation,$('month-calendar'));
    $('history-page').append($('training-metrics').closest('article'));
    const calendarTotals=node('p',undefined,'hint');calendarTotals.id='activity-month-totals';calendarCard.append(calendarTotals);
    const motion=putCard('history-page','运动记录');
    const motionList=node('div');motionList.id='activity-list';motion.append(motionList);
    motion.append(button('补记日常打球',()=>activityEditor()),button('课时对账',reconcile));
    const annual=putCard('history-page','年度运动热力图');
    const yearInput=node('input');yearInput.type='number';yearInput.min=1900;yearInput.max=9998;yearInput.value=L.today().slice(0,4);yearInput.id='activity-year';yearInput.onchange=render;
    const yearLabel=node('label','运动年份');yearLabel.append(yearInput);annual.append(yearLabel);
    const heat=node('div',undefined,'annual-heat');heat.id='year-heat';annual.append(heat);
    const totals=node('p',undefined,'hint');totals.id='activity-year-totals';annual.append(totals,node('small','灰色无运动 · 绿色培训 · 蓝色日常打球 · 双色为混合'));
    const settingsCard=putCard('stats-page','账号和数据');
    $('stats-page').prepend(settingsCard);
    const profile=node('p',undefined,'hint');profile.id='profile-info';
    settingsCard.append(profile,button('设置与数据管理',settings));
    const gear=putCard('stats-page','我的球包');
    gear.append(button('新增装备',()=>equipmentEditor()));
    const items=node('div');items.id='equipment-list';gear.append(items);
    const records=putCard('stats-page','课时对账记录');
    const recordList=node('div');recordList.id='reconciliation-list';records.append(button('新建对账',reconcile),recordList);
    $('expenses-page').append($('spend-metrics').closest('article'));
    const filter=node('div',undefined,'fields');
    const search=node('input');search.id='expense-search';search.type='search';search.oninput=render;
    const label=node('label','搜索项目、备注');label.append(search);
    const order=node('select');order.id='expense-order';options(order,[['date','最新日期'],['amount','金额从高到低']],'date');order.onchange=render;
    const sort=node('label','排序');sort.append(order);filter.append(label,sort);$('expense-list').before(filter);
  }
  function renderExtras(){
    const info=cloud.status();
    $('profile-info').textContent=info.account
      ?info.account.email+' · '+(info.error?'同步异常':info.pending?'待同步 '+info.pending+' 条':navigator.onLine?'云端账本':'离线缓存')
      :'尚未登录';
    const date=L.today(), all=Life.activities(state), selected=$('calendar-month').value;
    const month=Life.date(selected+'-01')?selected:date.slice(0,7);
    const rows=all.filter(r=>r.date.startsWith(month)), flags=Life.dayTypes(rows);
    const first=month+'-01', monthGrid=$('month-calendar');
    monthGrid.replaceChildren(...weekdays.map(d=>node('small',d)));
    for(let i=0;i<L.weekday(first);i++)monthGrid.append(node('span'));
    for(let d=first;d.startsWith(month);d=L.shift(d,1))monthGrid.append(activityCell(d,flags.get(d)||0,all,false));
    const trainings=rows.filter(r=>r.type==='training').length;
    $('activity-month-totals').textContent=flags.size+' 个运动日 · 培训 '+trainings+' 次 · 日常打球 '+(rows.length-trainings)+' 次';
    list('activity-list',byDate(rows),'本月没有运动记录',r=>[r.type==='training'?L.kinds[r.kind]:'日常打球',r.date+' · '+(r.place||r.note||''),r.minutes?r.minutes+' 分钟':''],
      r=>r.type==='training'?recordEditor(r.kind,state.records.find(x=>x.id===r.ledgerId)):activityEditor(r));
    const yearInput=$('activity-year').value;
    const year=/^(19\d{2}|[2-9]\d{3})$/.test(yearInput)&&yearInput!=='9999'?yearInput:date.slice(0,4);
    const annual=all.filter(r=>r.date.startsWith(year));
    if(!$('history-page').hidden){
      const root=$('year-heat');root.replaceChildren();
      for(const [start,end,label] of [['01-01','03-31','1–3 月'],['04-01','06-30','4–6 月'],['07-01','09-30','7–9 月'],['10-01','12-31','10–12 月']]){
        const grid=node('div',undefined,'heatmap');
        root.append(node('small',label),grid);
        heatmap(grid,year+'-'+start,year+'-'+end,annual);
      }
    }
    heatmap($('home-heat'),L.shift(L.week(date),-77),L.shift(L.week(date),6),all);
    const weeks=Life.weekStats(annual,date,Life.goal(state));
    const months=Array.from({length:12},(_,i)=>new Set(annual.filter(r=>Number(r.date.slice(5,7))===i+1).map(r=>r.date)).size);
    const busiest=Math.max(...months);
    $('activity-year-totals').textContent=Life.dayTypes(annual).size+' 个运动日 · '+annual.length+' 次运动 · 连续运动 '+weeks.active+' 周 · 最长达标训练 '+weeks.longest+' 周 · 最活跃月份 '+(busiest?(months.indexOf(busiest)+1)+' 月':'—');
    const last=byDate(Life.all(state,'reconciliations'))[0];
    $('last-reconciliation').textContent='最近对账 '+(last?last.date:'—')+' · 本月运动 '+Life.dayTypes(all.filter(r=>r.date.startsWith(date.slice(0,7)))).size+' 天';
    list('reconciliation-list',byDate(Life.all(state,'reconciliations')),'暂无对账',r=>[r.date,r.reason||r.note||'余额核对',r.before+' → '+r.confirmed+' 节']);
    list('equipment-list',byDate(Life.all(state,'equipment')),'暂无装备',r=>[r.name,Life.types[r.type]+' · '+Life.statuses[r.status],r.cents===null?'':money(r.cents)],gearDetails);
  }
  return {setup,renderExtras,net,activityEditor};
})();
