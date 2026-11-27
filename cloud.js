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
    active=await slot(account.id,{...next,token:crypto.randomUUID()},active?.token??null);emit();
  };
  function serial(fn){
    const p=queue.then(fn);
    queue=p.catch(()=>{});
    return p;
  }
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
    for(const collection of ['records','expenses']){
      const sets=[base,local,remote].map(s=>new Map(s[collection].map(row=>[row.id,row])));
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
    result.audit=[...new Map([...remote.audit,...local.audit].map(a=>[canonical(a),a])).values()];
    if(!Ledger.valid(result))throw Error('同步冲突：合并后的账本无法验证。');
    return result;
  }
  function historical(local,remote){
    const signature=r=>canonical(Object.fromEntries(Object.entries(r).filter(([k])=>!['id','createdAt','updatedAt'].includes(k))));
    const aligned={...local};
    for(const collection of ['records','expenses']){
      const byId=new Map(remote[collection].map(r=>[r.id,r]));
      const unmatched=new Map();
      for(const r of remote[collection]){
        if(local[collection].some(row=>row.id===r.id))continue;
        const key=signature(r);
        unmatched.set(key,(unmatched.get(key)||0)+1);
      }
      aligned[collection]=local[collection].flatMap(row=>{
        const same=byId.get(row.id);
        const key=signature(row);
        if(same)return [key===signature(same)?same:row];
        const count=unmatched.get(key)||0;
        if(!count)return [row];
        unmatched.set(key,count-1);
        return [];
      });
    }
    const result=merge(Ledger.empty(),aligned,remote,true);
    return result;
  }
  async function rpc(name,args){
    const response=await client.rpc(name,args);
    if(response.error)throw Object.assign(Error(response.error.message),{code:response.error.code});
    return response.data;
  }
  async function pull(){
    const snapshot=await rpc('diary_snapshot');
    if(!snapshot||!Ledger.valid(snapshot.state))throw Error('此账号尚未获授权，或云端账本无法验证。');
    return snapshot;
  }
  async function refresh(){
    if(!client&&navigator.onLine)await initialize();
    if(!client||!account||!navigator.onLine)return;
    inFlight=true;emit();
    try{
      active=await slot(account.id);
      if(!active){
        const remote=await pull();
        if(remote.revision===0&&localStorage.getItem(Ledger.key)){
          const legacy=Ledger.load(localStorage).state;
          if(legacy.records.length||legacy.expenses.length||legacy.audit.length||legacy.settings.budget!==null){
            await set({base:remote.state,draft:remote.state,revision:remote.revision,last:null});
            error='检测到本机历史账本。请在设置中预览并确认导入。';
            return;
          }
        }
        await set({base:remote.state,draft:remote.state,revision:remote.revision,last:new Date().toISOString()});
      }
      if(active.job){
        const j=active.job;
        try{
          const revision=await rpc('diary_apply',{expected:j.revision,operation_id:j.id,payload:j.state});
          await set({...active,base:j.state,revision,job:null});
        }catch(e){
          if(e.code!=='40001')throw e;
          const remote=await pull();
          const draft=merge(active.base,active.draft,remote.state);
          await set({...active,base:remote.state,draft,revision:remote.revision,job:null});
        }
      }
      const remote=await pull();
      if(remote.revision!==active.revision){
        const draft=merge(active.base,active.draft,remote.state);
        await set({...active,base:remote.state,draft,revision:remote.revision});
      }
      if(!equal(active.draft,active.base)){
        const j={id:crypto.randomUUID(),revision:active.revision,state:active.draft};
        await set({...active,job:j});
        const revision=await rpc('diary_apply',{expected:j.revision,operation_id:j.id,payload:j.state});
        await set({...active,base:j.state,revision,job:null,last:new Date().toISOString()});
      }else await set({...active,last:new Date().toISOString()});
      error='';
    }catch(e){
      error=e.message;
      clearTimeout(retry);
      if(!error.startsWith('同步冲突')&&e.code!=='42501')retry=setTimeout(sync,30000);
    }finally{inFlight=false;emit()}
  }
  const sync=()=>serial(refresh);
  async function attach(user){
    if(channel){await client.removeChannel(channel);channel=null}
    account=user?{id:user.id,email:user.email}:null;
    if(!account){active=null;localStorage.removeItem(marker);emit();return}
    localStorage.setItem(marker,JSON.stringify(account));
    active=await slot(account.id);emit();
    channel=client.channel('diary-'+account.id).on('postgres_changes',{event:'UPDATE',schema:'public',table:'diary_profiles',filter:'user_id=eq.'+account.id},()=>sync()).subscribe();
  }
  async function initialize(){
    if(!enabled)return;
    try{
      account=JSON.parse(localStorage.getItem(marker)||'null');
      if(account){active=await slot(account.id);emit()}
      const sdk=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm');
      client=sdk.createClient(config.url,config.publishableKey,{global:{fetch:(url,options)=>fetch(url,{...options,signal:options?.signal||AbortSignal.timeout(12000)})}});
      const {data,error:sessionError}=await client.auth.getSession();
      if(sessionError)throw sessionError;
      await attach(data.session?.user);
    }catch(e){client=null;error=e.message;emit()}
  }
  const init=()=>serial(async()=>{await initialize();if(client)await refresh()});
  async function login(email,password){
    if(!client)await initialize();
    if(!client)throw Error('云端连接不可用，请检查项目状态。');
    const result=await client.auth.signInWithPassword({email,password});
    if(result.error)throw result.error;
    try{await pullFor(result.data.user);await attach(result.data.user);await refresh()}
    catch(e){await client.auth.signOut({scope:'local'});throw e}
  }
  async function pullFor(user){
    if(!user)throw Error('登录失败');
    await pull();
  }
  async function logout(){
    if(!client)throw Error('请联网后退出登录。');
    if(active&&(active.job||!equal(active.draft,active.base)))throw Error('请先同步或导出待同步账本。');
    const {error:e}=await client.auth.signOut({scope:'local'});
    if(e)throw e;
    await attach(null);
  }
  function save(next,previous){
    return serial(async()=>{
      if(!account||!active)throw Error('请先完成云端登录与初始化。');
      if(!equal(previous,active.draft))throw Error('账本已有更新，请重新打开表单。');
      await set({...active,draft:next});
    }).then(()=>{sync()});
  }
  function discard(){
    return serial(async()=>{
      const remote=await pull();
      await set({base:remote.state,draft:remote.state,revision:remote.revision,last:new Date().toISOString()});
      error='';emit();
    });
  }
  function pendingCount(){
    if(!active)return 0;
    const {base,draft}=active;
    let count=equal(base.settings,draft.settings)?0:1;
    for(const collection of ['records','expenses']){
      const before=new Map(base[collection].map(row=>[row.id,row]));
      const after=new Map(draft[collection].map(row=>[row.id,row]));
      for(const id of new Set([...before.keys(),...after.keys()]))
        if(!equal(before.get(id),after.get(id)))count++;
    }
    return count||Number(Boolean(active.job||!equal(base.audit,draft.audit)));
  }
  addEventListener('online',sync);
  addEventListener('pageshow',sync);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});
  return {enabled,init,login:(email,password)=>serial(()=>login(email,password)),
    logout:()=>serial(logout),save,sync,discard,historical,merge,
    status:()=>({account,state:active?.draft,last:active?.last,pending:pendingCount(),inFlight,error})};
})();
