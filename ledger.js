'use strict';

const Ledger = (() => {
  const key = 'badminton-diary-v3';
  const legacyKey = 'zy-personal-lessons-v1';
  const backupKey = 'badminton-diary-v2-migration-backup';
  const categories = ['打球费用','球鞋服饰','球拍装备','羽球耗材','穿线维护','其他'];
  const categoryAliases = new Map([['培训费用','打球费用'],['场地费用','打球费用'],['其他费用','其他']]);
  const categoryBackupKey = 'badminton-diary-v3-category-backup';
  const kinds = {lesson:'正常上课',makeup:'补课',gift:'赠送训练',credit:'赠送课时',purchase:'购课',refund:'退款退课',adjust:'余额调整',opening:'期初余额校准'};
  const base = 2200;
  const units = n => Math.round(n * 100);
  const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const stamp = () => new Date().toISOString();
  const day = d => [String(d.getFullYear()).padStart(4,'0'),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  const today = () => day(new Date());
  const shift = (d,n) => {const date=new Date(d+'T12:00:00');date.setDate(date.getDate()+n);return day(date)};
  const weekday = d => (new Date(d+'T12:00:00').getDay()+6)%7;
  const week = d => shift(d,-weekday(d));
  const training = r => ['lesson','makeup','gift'].includes(r.kind);
  const dateOK = d => typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(Date.parse(d)).toISOString().slice(0,10)===d;
  const quantityOK = n => Number.isFinite(n)&&Math.abs(n)<=1000000&&Math.abs(n*100-units(n))<1e-7;
  const centsOK = n => Number.isSafeInteger(n)&&n>=0&&n<=100000000000;
  const unique = a => new Set(a.map(r=>r.id)).size===a.length;
  const meta = r => r && typeof r.id==='string' && r.id.length>0 && dateOK(r.date) && typeof r.note==='string' && typeof r.createdAt==='string' && typeof r.updatedAt==='string';
  const recordOK = r => meta(r)&&Object.hasOwn(kinds,r.kind)&&quantityOK(r.qty)
    && (['adjust','opening'].includes(r.kind)||r.qty>=0)
    && (!['credit','refund','purchase'].includes(r.kind)||r.qty>0)
    && (r.kind!=='gift'||r.qty===0)
    && quantityOK(r.bonus)&&r.bonus>=0&&quantityOK(r.offset)&&r.offset>=0
    && (r.kind==='purchase'||(r.bonus===0&&r.offset===0&&r.cents===null))
    && (r.cents===null||centsOK(r.cents));
  const expenseOK = r => meta(r)&&categories.includes(r.category)&&typeof r.item==='string'&&r.item.trim().length>0&&centsOK(r.cents)&&['manual','historical-training'].includes(r.source)&&r.businessId===null;
  const auditOK = a => a && typeof a.at==='string' && ['create','update','delete'].includes(a.action)
    && ['records','expenses'].includes(a.collection)
    && (a.before===null||(a.collection==='records'?recordOK(a.before):expenseOK(a.before)))
    && (a.after===null||(a.collection==='records'?recordOK(a.after):expenseOK(a.after)));
  const empty = () => ({version:3,records:[],expenses:[],settings:{budget:null},audit:[]});
  const valid = s => s?.version===3 && Array.isArray(s.records)&&s.records.every(recordOK)&&unique(s.records)
    && s.records.filter(r=>r.kind==='opening').length<=1
    && Array.isArray(s.expenses)&&s.expenses.every(expenseOK)&&unique(s.expenses)
    && s.settings && (s.settings.budget===null||centsOK(s.settings.budget))
    && Array.isArray(s.audit)&&s.audit.every(auditOK);
  function migrate(records){
    if(!Array.isArray(records))throw Error('旧课时流水格式无效');
    const state=empty(), at=stamp();
    state.records=records.map(r=>{
      if(!r||!['lesson','makeup','gift','purchase'].includes(r.kind)||
        !(r.money===null||(Number.isFinite(r.money)&&r.money>=0)))throw Error('旧课时流水无法识别');
      return {id:r.id,date:r.date,kind:r.kind,qty:r.qty,note:r.note,cents:r.kind==='purchase'&&r.money!==null?units(r.money):null,bonus:0,offset:0,createdAt:at,updatedAt:at};
    });
    if(!valid(state))throw Error('旧课时流水校验失败');
    return state;
  }
  function normalizeCategories(state){
    const remap = row => {
      const category=categoryAliases.get(row?.category);
      return category ? {...row,category} : row;
    };
    if(state?.version!==3||!Array.isArray(state.expenses)||!Array.isArray(state.audit))return state;
    const expenses=state.expenses.map(remap);
    const audit=state.audit.map(entry=>{
      if(entry?.collection!=='expenses')return entry;
      const before=remap(entry.before), after=remap(entry.after);
      return before===entry.before&&after===entry.after ? entry : {...entry,before,after};
    });
    return expenses.some((row,i)=>row!==state.expenses[i])||audit.some((row,i)=>row!==state.audit[i])
      ? {...state,expenses,audit} : state;
  }
  const isPurchaseExpense = expense => expense.source==='purchase';
  const filterExpenses = (rows,includePurchases) => includePurchases ? rows : rows.filter(r=>!isPurchaseExpense(r));
  function load(storage){
    const raw=storage.getItem(key);
    if(raw!==null){
      const original=JSON.parse(raw), state=normalizeCategories(original);
      if(!valid(state))throw Error('V3 账本校验失败');
      if(state===original)return {state,raw};
      if(storage.getItem(categoryBackupKey)===null)storage.setItem(categoryBackupKey,raw);
      const saved=JSON.stringify(state);
      storage.setItem(key,saved);
      return {state,raw:saved};
    }
    const old=storage.getItem(legacyKey);
    if(old===null)return {state:empty(),raw:null};
    if(storage.getItem(backupKey)===null)storage.setItem(backupKey,old);
    const state=migrate(JSON.parse(old)), saved=JSON.stringify(state);
    storage.setItem(key,saved);
    return {state,raw:saved};
  }
  function restore(data){
    if(data?.version===1&&data.initial===22)return migrate(data.records);
    data=normalizeCategories(data);
    if(!valid(data))throw Error('备份格式无效');
    return data;
  }
  function delta(r){
    const qty=units(r.qty);
    if(r.kind==='purchase')return qty+units(r.bonus)-units(r.offset);
    if(r.kind==='credit'||r.kind==='adjust')return qty;
    if(r.kind==='opening')return qty-base;
    return -qty;
  }
  const balance = s => (base+s.records.reduce((n,r)=>n+delta(r),0))/100;
  const expenses = s => [...s.expenses,...s.records.filter(r=>r.kind==='purchase'&&r.cents!==null).map(r=>({
    id:'purchase:'+r.id,date:r.date,category:categories[0],item:'购课',cents:r.cents,note:r.note,source:'purchase',businessId:r.id,createdAt:r.createdAt,updatedAt:r.updatedAt
  }))];
  function change(state,collection,id,draft){
    const list=state[collection], before=list.find(r=>r.id===id)||null, at=stamp();
    const after=draft?{...draft,id:before?.id||uid(),createdAt:before?.createdAt||at,updatedAt:at}:null;
    if(!before&&!after)return state;
    const next={...state,[collection]:before?(after?list.map(r=>r.id===id?after:r):list.filter(r=>r.id!==id)):[...list,after],
      audit:[...state.audit,{at,collection,action:after?(before?'update':'create'):'delete',before,after}]};
    if(!valid(next))throw Error('请核对日期、课时和金额。期初校准仅保留一条。');
    return next;
  }
  function trainingStats(s,date){
    const rows=s.records.filter(r=>training(r)&&r.date<=date);
    const days=new Set(rows.map(r=>r.date)), weeks=new Set([...days].map(week));
    const start=week(date), complete=weeks.has(start);
    let streak=0;
    for(let d=complete?start:shift(start,-7);weeks.has(d);d=shift(d,-7))streak++;
    return {days,start,complete,streak,last:[...days].sort().pop(),
      month:rows.filter(r=>r.date.startsWith(date.slice(0,7))).length,
      year:rows.filter(r=>r.date.startsWith(date.slice(0,4))).length};
  }
  function costs(s){
    const initial=s.records.find(r=>r.kind==='opening');
    const pool=[];
    let debt=0, known=0, unknown=false;
    function supply(q,cents=null){
      if(q<=0)return;
      const applied=Math.min(debt,q);
      debt-=applied;
      if(q>applied)pool.push({left:q-applied,total:q,cents,used:applied});
    }
    function portion(batch,count){
      const total=BigInt(batch.total);
      return Number((2n*BigInt(batch.cents)*BigInt(count)+total)/(2n*total));
    }
    function take(q,track,fromEnd=false){
      while(q>0&&pool.length){
        const batch=fromEnd?pool[pool.length-1]:pool[0], count=Math.min(q,batch.left);
        if(track){
          if(batch.cents===null)unknown=true;
          else known+=portion(batch,batch.used+count)-portion(batch,batch.used);
        }
        if(!fromEnd)batch.used+=count;
        batch.left-=count;q-=count;
        if(batch.left===0)fromEnd?pool.pop():pool.shift();
      }
      if(q>0){debt+=q;if(track)unknown=true}
    }
    const opening=initial?units(initial.qty):base;
    if(opening>=0)supply(opening);else debt=-opening;
    for(const r of [...s.records].sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt))){
      if(r.kind==='opening')continue;
      if(r.kind==='purchase'){
        supply(units(r.qty)+units(r.bonus),r.cents);
        take(units(r.offset),false);
      }else if(r.kind==='refund')take(units(r.qty),false,true);
      else if(delta(r)>0)supply(delta(r));
      else if(delta(r)<0)take(-delta(r),training(r));
    }
    return {known,unknown};
  }
  return {key,legacyKey,backupKey,categoryBackupKey,isPurchaseExpense,filterExpenses,categories,kinds,base,units,today,day,shift,week,weekday,training,valid,empty,load,restore,delta,balance,expenses,change,trainingStats,costs};
})();
if(typeof module!=='undefined')module.exports=Ledger;
