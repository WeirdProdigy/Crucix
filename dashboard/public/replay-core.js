(function(window){
  'use strict';
  // The sweep replay's state machine: pure, no DOM, no fetch, no clock. replay.js does the I/O and dispatches what happened.
  // mode: 'live' | 'loading' (target, targetIndex) | 'replay' (id, index) | 'error' (error; id/index stay the sweep shown, or null
  // when the replay was never entered). sweeps: the archived sweep ids, oldest -> newest. pending/missed: the newest live
  // snapshot kept aside while a replay holds the page, and how many newer ones arrived.
  const SWEEP_ID=/^sweep-\d{8}T\d{6}Z$/;
  const LIVE={mode:'live',id:null,index:-1,target:null,targetIndex:-1,error:'',pending:null,missed:0};
  const createState=()=>({...LIVE,sweeps:[]});
  // Only ISO-8601 times: Date.parse also reads any text with a number in it.
  const ISO_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
  const timeOf=snapshot=>{const value=snapshot&&typeof snapshot==='object'&&snapshot.meta&&typeof snapshot.meta.timestamp==='string'&&ISO_TIME.test(snapshot.meta.timestamp)?Date.parse(snapshot.meta.timestamp):NaN;return Number.isFinite(value)?value:null;};
  // Live data may be applied: live mode, or an error before any sweep was shown.
  const canApplyLive=state=>state.mode==='live'||(state.mode==='error'&&state.id===null);
  const loading=(state,index)=>({...state,mode:'loading',target:state.sweeps[index],targetIndex:index,error:''});
  // A failure keeps the sweep shown; without one the replay never started, so the kept live snapshot goes back to the caller.
  function fail(state,error){
    const next={...state,mode:'error',error,target:null,targetIndex:-1};
    return next.id===null?{...next,pending:null,missed:0}:next;
  }
  // Move to `index` from where the user is (the target while loading); back to the sweep shown cancels the load.
  function moveTo(state,index){
    const from=state.mode==='loading'?state.targetIndex:state.index;
    if(index<0||index>=state.sweeps.length||index===from)return state;
    if(state.id!==null&&index===state.index)return {...state,mode:'replay',target:null,targetIndex:-1,error:''};
    return loading(state,index);
  }
  function reduce(state,action){
    const type=action&&action.type;
    if(type==='sweeps'){
      // The sweep shown (and the one loading) stay listed even when retention dropped them meanwhile. Ids sort by time.
      const ids=Array.isArray(action.sweeps)?action.sweeps.filter(id=>typeof id==='string'&&SWEEP_ID.test(id)):[];
      const sweeps=[...new Set([...ids,state.id,state.target].filter(id=>id!==null))].sort();
      return {...state,sweeps,index:state.id===null?-1:sweeps.indexOf(state.id),targetIndex:state.target===null?-1:sweeps.indexOf(state.target)};
    }
    if(type==='open'){
      if(!state.sweeps.length)return fail(state,'noSweeps');
      const id=action.id==null?state.sweeps[state.sweeps.length-1]:action.id,index=state.sweeps.indexOf(id);
      if(index<0)return fail(state,'notFound');
      if(state.id===id)return {...state,mode:'replay',index,target:null,targetIndex:-1,error:''};
      return loading(state,index);
    }
    if(type==='step'){
      if(canApplyLive(state))return state;
      const from=state.mode==='loading'?state.targetIndex:state.index,delta=Number.isInteger(action.delta)?action.delta:0;
      if(from<0||!delta)return state;
      return moveTo(state,Math.max(0,Math.min(state.sweeps.length-1,from+delta)));
    }
    if(type==='goto'){
      if(canApplyLive(state))return state;
      return moveTo(state,state.sweeps.indexOf(action.id));
    }
    if(type==='loaded'){
      if(state.mode!=='loading'||action.id!==state.target)return state;
      return {...state,mode:'replay',id:state.target,index:state.targetIndex,target:null,targetIndex:-1,error:''};
    }
    if(type==='failed'){
      if(state.mode!=='loading'||action.id!==state.target)return state;
      return fail(state,typeof action.error==='string'&&action.error?action.error:'error');
    }
    if(type==='exit')return {...LIVE,sweeps:state.sweeps};
    if(type==='liveArrived'){
      const time=timeOf(action.snapshot);
      if(canApplyLive(state)||time===null)return state;
      // Only a newer snapshot counts: the poll fallback may hand over the same one again.
      if(state.pending&&time<=timeOf(state.pending))return state;
      return {...state,pending:action.snapshot,missed:state.missed+1};
    }
    return state;
  }
  window.CrucixReplayCore=Object.freeze({createState,reduce,canApplyLive});
})(window);
