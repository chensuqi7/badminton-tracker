'use strict';

const LifeUI = (() => {
  const categories=()=>L.categories.map(c=>[c,c]);
  const choice=items=>Object.entries(items);
  const dateField=(value)=>field('日期','date',value,{type:'date',required:''});
  const noteField=value=>field('备注','note',value,{maxlength:'300'});
  const save=(next,message)=>{
    if(!L.valid(next))throw Error('请核对日期、金额与关联数据。');
    return persist(next,message);
  };
  const byDate=rows=>[...rows].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
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
    target.append(button('查看课时流水',()=>{$('editor').close();window.PrototypeUI.goLedger()}));
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
  function segmented(entries,onSelect,initial=0){
    const group=node('div',undefined,'segmented');
    group.setAttribute('role','group');
    const controls=entries.map((label,index)=>button(label,()=>select(index)));
    function select(index){
      controls.forEach((control,i)=>control.setAttribute('aria-pressed',String(i===index)));
      onSelect(index);
    }
    controls.forEach((control,i)=>control.setAttribute('aria-pressed',String(i===initial)));
    group.append(...controls);
    return group;
  }
  return {segmented,dayDetails,activityEditor,equipmentEditor,stringEditor,reconcile};
})();
