'use strict';

const Life = (() => {
  const collections=['activities','equipment','stringings','reconciliations'];
  const types={racket:'球拍',shoes:'球鞋',bag:'球包',apparel:'服饰',other:'其他装备'};
  const statuses={active:'使用中',spare:'备用',retired:'已退役',sold:'已出售'};
  const cents=n=>n===null||Number.isSafeInteger(n)&&n>=0&&n<=100000000000;
  const quantity=n=>Number.isFinite(n)&&Math.abs(n)<=1000000&&Math.abs(n*100-Math.round(n*100))<1e-7;
  const text=(s,max=300)=>typeof s==='string'&&s.length<=max;
  const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(Date.parse(s)).toISOString().slice(0,10)===s;
  const all=(state,name)=>state[name]??[];
  const goal=state=>state.settings.weeklyGoal??1;
  const expenseLink=row=>row.expenseId??null;
  function valid(state){
    if(!Number.isInteger(goal(state))||goal(state)<1||goal(state)>7)return false;
    if(collections.some(name=>!Array.isArray(all(state,name))))return false;
    const expenses=new Map(state.expenses.map(row=>[row.id,row])), linked=new Set(), adjustments=new Set();
    const gear=new Map(all(state,'equipment').filter(Boolean).map(row=>[row.id,row]));
    for(const name of collections){
      const rows=all(state,name), ids=new Set();
      for(const row of rows){
        if(!row||!text(row.id,128)||!row.id||ids.has(row.id)||!date(row.date)||!text(row.note)||!text(row.createdAt,50)||!text(row.updatedAt,50))return false;
        ids.add(row.id);
        const link=expenseLink(row);
        if(link!==null){
          const expense=expenses.get(link);
          if(!expense||linked.has(link)||(name==='activities'&&expense.category!=='打球费用')||(name==='stringings'&&expense.category!=='穿线维护'))return false;
          linked.add(link);
        }
        if(name==='activities'&&(!text(row.place,120)||!(row.minutes===null||Number.isInteger(row.minutes)&&row.minutes>0&&row.minutes<=1440)))return false;
        if(name==='equipment'&&(!Object.hasOwn(types,row.type)||!Object.hasOwn(statuses,row.status)||!text(row.name,100)||!row.name.trim()||!text(row.brand,100)||!text(row.model,100)||!text(row.spec,100)||!cents(row.cents)))return false;
        if(name==='stringings'){
          if(gear.get(row.equipmentId)?.type!=='racket'||!text(row.brand,100)||!text(row.model,100)||!row.model.trim()||!text(row.shop,120)||!text(row.reason)
            ||!cents(row.cents)||![row.main,row.cross].every(x=>x===null||quantity(x)&&x>0&&x<=100)
            ||!(row.broken===null||date(row.broken)&&row.broken>=row.date))return false;
        }
        if(name==='reconciliations'){
          if(link!==null||![row.before,row.confirmed,row.adjustment].every(quantity)||!text(row.reason)
            ||Math.round((row.confirmed-row.before)*100)!==Math.round(row.adjustment*100))return false;
          if(row.adjustment!==0&&(!row.reason.trim()||adjustments.has(row.adjustmentId)))return false;
          if(row.adjustmentId!==null)adjustments.add(row.adjustmentId);
          const adjustment=state.records.find(x=>x.id===row.adjustmentId);
          if(row.adjustment===0?row.adjustmentId!==null:!adjustment||adjustment.kind!=='adjust'||adjustment.date!==row.date||adjustment.qty!==row.adjustment)return false;
        }
      }
    }
    return true;
  }
  function change(state,name,row){
    const rows=all(state,name), old=rows.find(x=>x.id===row.id), at=new Date().toISOString();
    const saved={...row,id:row.id??crypto.randomUUID(),createdAt:old?.createdAt??at,updatedAt:at};
    return {...state,[name]:old?rows.map(x=>x.id===saved.id?saved:x):[...rows,saved]};
  }
  function remove(state,name,id){
    return {...state,[name]:all(state,name).filter(row=>row.id!==id)};
  }
  function activities(state){
    const lessons=state.records.filter(Ledger.training).map(row=>({...row,type:'training',ledgerId:row.id,id:'training:'+row.id}));
    return [...lessons,...all(state,'activities').map(row=>({...row,type:'casual'}))];
  }
  function dayTypes(rows){
    const result=new Map();
    for(const row of rows)result.set(row.date,(result.get(row.date)||0)|(row.type==='training'?1:2));
    return result;
  }
  function weekStats(rows,today,target){
    const weeks=new Map(), training=new Map(), thisWeek=Ledger.week(today);
    for(const row of rows.filter(r=>r.date<=today)){
      const week=Ledger.week(row.date);
      weeks.set(week,true);
      if(row.type==='training')training.set(week,(training.get(week)||0)+1);
    }
    let active=0,trainingStreak=0,longest=0,run=0,last;
    for(let d=weeks.has(thisWeek)?thisWeek:Ledger.shift(thisWeek,-7);weeks.has(d);d=Ledger.shift(d,-7))active++;
    for(let d=(training.get(thisWeek)||0)>=target?thisWeek:Ledger.shift(thisWeek,-7);(training.get(d)||0)>=target;d=Ledger.shift(d,-7))trainingStreak++;
    for(const key of [...training.keys()].sort().filter(d=>training.get(d)>=target)){
      run=last&&Ledger.shift(last,7)===key?run+1:1;last=key;longest=Math.max(longest,run);
    }
    return {active,trainingStreak,longest,current:training.get(thisWeek)||0};
  }
  return {collections,types,statuses,all,goal,date,quantity,valid,change,remove,activities,dayTypes,weekStats};
})();
