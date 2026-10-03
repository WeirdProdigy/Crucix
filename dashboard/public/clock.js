(function(window){
  'use strict';
  // The dashboard's "now". Every "how old is this / is it still fresh" computation reads CrucixClock.now() instead of Date.now(), so a
  // sweep replay can freeze it at the snapshot's own time (live sources are then judged as of that snapshot) and release it afterwards.
  // Timers, animation and request ids are not ages of data and keep using real time.
  let frozenAt=null;
  const now=()=>frozenAt===null?Date.now():frozenAt;
  function freeze(ms){
    if(typeof ms!=='number'||!Number.isFinite(ms))throw new TypeError('CrucixClock.freeze needs a finite number of milliseconds');
    frozenAt=ms;
  }
  const release=()=>{frozenAt=null;};
  window.CrucixClock={now,freeze,release,frozen:()=>frozenAt!==null};
})(window);
