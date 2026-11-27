'use strict';

window.DiaryCloud = (() => {
  const config=window.DIARY_CLOUD;
  const enabled=Boolean(config?.url&&config?.publishableKey);
  let client, account, active, channel, queue=Promise.resolve(), retry, inFlight=false, error='';
  const emit=()=>window.dispatchEvent(new Event('diary-cloud'));
  let db;
  function database(){
    if(!db)db=new Promise((resolve,reject)=>{
      const request=indexedDB.open('badminton-diary-cloud',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('accounts');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>{db=null;reject(request.error)};
    });
    return db;
  }
  const marker='badminton-cloud-last-account';
  const legacyLock='badminton-cloud-legacy-locked';
  const sessionKey=enabled?'sb-'+new URL(config.url).hostname.split('.')[0]+'-auth-token':null;
  let generation=0;
  const offlineKey=id=>'badminton-cloud-trusted-offline:'+id;
  const slot=async (id,next,expected)=>{
    const conn=await database();
    return new Promise((resolve,reject)=>{
      const tx=conn.transaction('accounts',next?'readwrite':'readonly'), store=tx.objectStore('accounts');
      const request=store.get(id);
      let value, conflict=false;
      request.onsuccess=()=>{
        value=request.result||null;
        if(next){
          if((value?.token??null)!==expected){conflict=true;tx.abort();return}
          store.put(next,id);
        }
      };
      tx.oncomplete=()=>resolve(next||value);
      tx.onabort=tx.onerror=()=>reject(conflict?Error('另一个窗口已更新，请刷新后重试。'):tx.error||request.error);
    });
  };
  const set=async next=>{
    const userId=account.id, epoch=generation;
    const saved=await slot(userId,{...next,token:crypto.randomUUID()},active?.token??null);
    if(epoch!==generation)throw Error('登录会话已变更，请重新打开账本。');
    active=saved;emit();
  };
  function serial(fn){
    const p=queue.then(fn);
    queue=p.catch(()=>{});
    return p;
  }
  const collections=['records','expenses',...Life.collections];
  const syncPayload=state=>({
    version:state.version,settings:{...state.settings,weeklyGoal:Life.goal(state)},
    ...Object.fromEntries(collections.map(name=>[name,state[name]??[]]))
  });
  const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
    ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  const equal=(a,b)=>canonical(a)===canonical(b);
  function merge(base,local,remote,importing=false){
    function pick(old,a,b,label){
      if(equal(a,b)||equal(old,b))return a;
      if(equal(old,a))return b;
      throw Error('同步冲突：'+label+' 在两台设备上均有改动。请先导出本机账本。');
    }
    const result={...remote};
    if(!importing&&(local.reconciliations??[]).some(r=>!(base.reconciliations??[]).some(old=>old.id===r.id))
      &&!equal(base.records,remote.records))throw Error('同步冲突：课时流水已变化，请重新对账。');
    for(const collection of collections){
      const sets=[base,local,remote].map(s=>new Map((s[collection]??[]).map(row=>[row.id,row])));
      const ids=new Set(sets.flatMap(m=>[...m.keys()]));
      result[collection]=[...ids].map(id=>pick(...sets.map(m=>m.get(id)),collection+'/'+id)).filter(Boolean);
    }
    if(!importing){
      const old=new Set(base.records.map(r=>r.id));
      const added=remote.records.filter(r=>!old.has(r.id)&&Ledger.training(r));
      if(local.records.some(r=>!old.has(r.id)&&Ledger.training(r)&&added.some(other=>other.id!==r.id&&other.date===r.date)))
        throw Error('同步冲突：两台设备在同一天新登记了训练，请核对是否为重复记课。');
    }
    result.settings=pick(base.settings,local.settings,remote.settings,'设置');
    result.audit=remote.audit;
    if(!Ledger.valid(result))throw Error('同步冲突：合并后的账本无法验证。');
    return result;
  }
  function historical(local,remote){
    if((local.reconciliations??[]).some(row=>!(remote.reconciliations??[]).some(saved=>equal(saved,row))))
      throw Error('备份含云端尚未确认的对账，请从原账号恢复或重新对账。');
    const linked=new Set(Life.collections.flatMap(name=>(local[name]??[]).flatMap(row=>[row.expenseId,row.equipmentId,row.adjustmentId].filter(Boolean))));
    const signature=r=>canonical(Object.fromEntries(Object.entries(r).filter(([k])=>!['id','createdAt','updatedAt'].includes(k))));
    const aligned={...local,settings:{...local.settings,weeklyGoal:Life.goal(local)}};
    for(const collection of collections){
      const byId=new Map((remote[collection]??[]).map(r=>[r.id,r]));
      const unmatched=new Map();
      for(const r of remote[collection]??[]){
        if((local[collection]??[]).some(row=>row.id===r.id))continue;
        const key=signature(r);
        unmatched.set(key,(unmatched.get(key)||0)+1);
      }
      aligned[collection]=(local[collection]??[]).flatMap(row=>{
        const same=byId.get(row.id);
        const key=signature(row);
        if(same)return [key===signature(same)?same:row];
        if(linked.has(row.id)||!['records','expenses'].includes(collection))return [row];
        const count=unmatched.get(key)||0;
        if(!count)return [row];
        unmatched.set(key,count-1);
        return [];
      });
    }
    const baseline=Ledger.empty();
    baseline.settings.weeklyGoal=1;
    const result=merge(baseline,aligned,remote,true);
    return result;
  }
  async function rpc(name,args){
    const response=await client.rpc(name,args);
    if(response.error)throw Object.assign(Error(response.error.message),{code:response.error.code});
    return response.data;
  }
  function assertAccount(snapshot,id){
    if(!snapshot)throw Object.assign(Error('此账号尚未获授权。'),{code:'42501'});
    if(snapshot.userId!==id)throw Object.assign(Error('登录会话已变更，请重新登录。'),{code:'42501'});
    return snapshot;
  }
  async function pull(id=account?.id,checkpoint){
    if(checkpoint?.schema===1){
      let page, cursor={}, state=structuredClone(checkpoint.base);
      const rows=Object.fromEntries(collections.map(name=>[name,new Map(state[name].map(row=>[row.id,row]))]));
      do{
        page=assertAccount(await rpc('diary_life_changes',{since:checkpoint.revision,...cursor}),id);
        if(page.headRevision!==page.revision||page.revision<checkpoint.revision){
          return pull(id);
        }
        state.settings=page.settings;
        for(const change of page.changes){
          if(change.kind==='audit'){state.audit.push(change.entry);continue}
          if(change.deleted)rows[change.kind].delete(change.id);
          else rows[change.kind].set(change.id,change.entry);
        }
        if(page.more){
          const last=page.changes.at(-1);
          cursor={through:page.revision,after_version:last.version,after_key:last.key};
        }
      }while(page.more);
      for(const name of collections)state[name]=[...rows[name].values()];
      if(!Ledger.valid(state))throw Error('增量账本无法验证。');
      return {...page,state,schema:1};
    }
    const snapshot=assertAccount(await rpc('diary_life_snapshot'),id);
    if(snapshot.schema!==1||!Ledger.valid(snapshot.state)||typeof snapshot.legacyImport!=='boolean')
      throw Error('云端账本无法验证，请检查数据库版本。');
    return snapshot;
  }
  async function refresh(){
    if(!client&&navigator.onLine)await initialize();
    if(client&&!account&&navigator.onLine)await resume();
    if(!client||!account||!navigator.onLine)return;
    const epoch=generation, id=account.id;
    inFlight=true;emit();
    try{
      const cached=await slot(id);
      let remote=await pull(id,cached);
      if(epoch!==generation)return;
      active=cached;
      account.legacyImport=remote.legacyImport;
      account.role=remote.role;
      if(!active)await set({base:remote.state,draft:remote.state,revision:remote.revision,schema:1,last:new Date().toISOString()});
      if(active.job){
        const j=active.job;
        try{
          await rpc('diary_life_apply',{expected:j.revision,operation_id:j.id,actor_id:id,payload:syncPayload(j.state)});
          if(epoch!==generation)return;
          remote=await pull(id,active);
          if(epoch!==generation)return;
          const draft=merge(j.state,active.draft,remote.state);
          await set({...active,base:remote.state,draft,revision:remote.revision,schema:1,job:null});
        }catch(e){
          if(e.code!=='40001')throw e;
          remote=await pull(id,active);
          if(epoch!==generation)return;
          const draft=merge(active.base,active.draft,remote.state);
          await set({...active,base:remote.state,draft,revision:remote.revision,schema:1,job:null});
        }
      }
      if(remote.revision!==active.revision||!equal(remote.state,active.base)){
        const draft=merge(active.base,active.draft,remote.state);
        await set({...active,base:remote.state,draft,revision:remote.revision,schema:1});
      }
      if(!equal(active.draft,active.base)){
        const j={id:crypto.randomUUID(),revision:active.revision,state:active.draft};
        await set({...active,job:j});
        await rpc('diary_life_apply',{expected:j.revision,operation_id:j.id,actor_id:id,payload:syncPayload(j.state)});
        if(epoch!==generation)return;
        remote=await pull(id,active);
        if(epoch!==generation)return;
        await set({...active,base:remote.state,draft:remote.state,revision:remote.revision,schema:1,job:null,last:new Date().toISOString()});
      }else await set({...active,last:new Date().toISOString()});
      error='';
    }catch(e){
      if(epoch!==generation)return;
      error=e.message.includes('reconciliation balance changed')?'同步冲突：课时余额已变化，请重新对账。':e.message;
      clearTimeout(retry);
      if(e.code==='42501'){active=null;account.legacyImport=false}
      else if(e.code==='22023'&&active?.job)await set({...active,job:null});
      else if(!error.startsWith('同步冲突'))retry=setTimeout(sync,30000);
    }finally{inFlight=false;emit()}
  }
  const sync=()=>serial(refresh);
  function hideAccount(){
    generation++;
    clearTimeout(retry);
    const previousChannel=channel;
    channel=null;
    if(previousChannel)Promise.resolve().then(()=>client.removeChannel(previousChannel)).catch(()=>{});
    account=null;active=null;error='';
    emit();
  }
  async function attach(user){
    if(channel){await client.removeChannel(channel);channel=null}
    if(!user){localStorage.removeItem(marker);return}
    const epoch=generation, cached=await slot(user.id);
    if(epoch!==generation)return;
    // A previous marker records a verified online login, never grants access by itself.
    const previous=JSON.parse(localStorage.getItem(marker)||'null');
    if(!navigator.onLine&&(previous?.id!==user.id||localStorage.getItem(offlineKey(user.id))!=='1'))return;
    const remote=navigator.onLine?await pull(user.id,cached):null;
    if(epoch!==generation)return;
    if(remote){
      localStorage.setItem(legacyLock,'1');
      localStorage.setItem(marker,JSON.stringify({id:user.id}));
    }
    account={id:user.id,email:user.email,legacyImport:remote?.legacyImport??false,role:remote?.role??'user'};
    active=cached;
    emit();
    channel=client.channel('diary-'+user.id).on('postgres_changes',{event:'UPDATE',schema:'public',table:'diary_profiles',filter:'user_id=eq.'+user.id},()=>{if(account?.id===user.id)sync()}).subscribe();
  }
  async function restoreSession(){
    if(!client)return;
    const {data,error:sessionError}=await client.auth.getSession();
    if(sessionError)throw sessionError;
    if(data.session?.user?.id===account?.id&&account)return;
    await attach(data.session?.user);
  }
  async function initialize(){
    if(!enabled||client)return;
    try{
      if(localStorage.getItem(marker))localStorage.setItem(legacyLock,'1');
      const sdk=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm');
      client=sdk.createClient(config.url,config.publishableKey,{global:{fetch:(url,options)=>fetch(url,{...options,signal:options?.signal||AbortSignal.timeout(12000)})}});
      client.auth.onAuthStateChange?.((event,session)=>{
        if(event==='SIGNED_OUT'||(account&&session?.user?.id!==account.id))hideAccount();
      });
    }catch(e){client=null;error=e.message;emit();return}
    await resume();
  }
  async function resume(){
    try{await restoreSession()}
    catch(e){error=e.message;emit()}
  }
  const init=()=>serial(async()=>{await initialize();if(client)await refresh()});
  async function login(email,password){
    if(!client)await initialize();
    if(!client)throw Error('云端连接不可用，请检查项目状态。');
    hideAccount();
    const result=await client.auth.signInWithPassword({email:email.trim(),password});
    if(result.error)throw result.error;
    try{await attach(result.data.user);await refresh()}
    catch(e){await client.auth.signOut({scope:'local'});throw e}
  }
  async function logout(){
    if(!client)throw Error('请联网后退出登录。');
    if(active&&(active.job||!equal(active.draft,active.base)))throw Error('还有 '+pendingCount()+' 条未同步变更，请先同步或导出备份。');
    hideAccount();
    const {error:e}=await client.auth.signOut({scope:'local'});
    if(e)throw e;
    await attach(null);
  }
  function save(next,previous){
    const epoch=generation;
    return serial(async()=>{
      if(epoch!==generation||!account||!active)throw Error('请先完成云端登录与初始化。');
      if(!equal(previous,active.draft))throw Error('账本已有更新，请重新打开表单。');
      await set({...active,draft:next});
    }).then(()=>{sync()});
  }
  function discard(){
    const epoch=generation;
    return serial(async()=>{
      if(epoch!==generation||!account)throw Error('登录会话已变更。');
      const remote=await pull(account.id,active);
      if(epoch!==generation)return;
      await set({base:remote.state,draft:remote.state,revision:remote.revision,schema:1,last:new Date().toISOString()});
      error='';emit();
    });
  }
  function pendingCount(){
    if(!active)return 0;
    const {base,draft}=active;
    let count=equal(base.settings,draft.settings)?0:1;
    for(const collection of collections){
      const before=new Map((base[collection]??[]).map(row=>[row.id,row]));
      const after=new Map((draft[collection]??[]).map(row=>[row.id,row]));
      for(const id of new Set([...before.keys(),...after.keys()]))
        if(!equal(before.get(id),after.get(id)))count++;
    }
    return count||Number(Boolean(active.job||!equal(base.audit,draft.audit)));
  }
  addEventListener('storage',event=>{
    if(!enabled||event.key!==sessionKey&&event.key!==marker&&event.key!==null)return;
    if(account&&event.newValue){
      try{
        const current=JSON.parse(event.newValue);
        if((event.key===sessionKey?current.user?.id:current.id)===account.id)return;
      }catch{}
    }
    hideAccount();
    if(navigator.onLine)sync();
  });
  addEventListener('online',sync);
  addEventListener('pageshow',sync);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});
  function setOfflineTrust(trusted){
    if(!account||!active)throw Error('请先完成登录与同步。');
    const key=offlineKey(account.id);
    if(trusted)localStorage.setItem(key,'1');else localStorage.removeItem(key);
    emit();
  }
  return {enabled,init,setOfflineTrust,adminSummary:()=>rpc('diary_admin_summary'),login:(email,password)=>serial(()=>login(email,password)),
    logout:()=>serial(logout),save,sync,discard,historical,merge,
    status:()=>({localLocked:enabled&&Boolean(localStorage.getItem(legacyLock)||localStorage.getItem(marker)),account,trustedOffline:Boolean(account&&localStorage.getItem(offlineKey(account.id))==='1'),state:active?.draft,last:active?.last,pending:pendingCount(),inFlight,error})};
})();
