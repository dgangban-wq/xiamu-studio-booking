/* Public edition configuration: pure validation, no storage side effects. */
window.PublicConfig = (() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const defaults = {
    configured: false,
    profile: { name: '我的工作室', logo: '', phone: '', wechat: '', address: '', theme: 'teal', mode: 'light', notice: '' },
    scenes: [],
    rules: { open: '10:00', close: '22:00', minMinutes: 120, stepMinutes: 30, overtimeRate: 30, extraPersonRate: 50, depositMode: 'hours', depositValue: 1, freeChanges: 1, changeFee: 50, turnaroundMinutes: 15, closedWeekdays: [], closedDates: [], phoneRequired: true, wechatRequired: true, quickHours: [2, 4, 8], paymentMethods: ['微信', '支付宝', '现金', '银行转账'], incomeNote: '' }
  };
  const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
  const raster = value => typeof value === 'string' && (value === '' || (value.length <= 800000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)));
  const date = value => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(value+'T12:00:00Z'); return !isNaN(d) && d.toISOString().slice(0,10) === value; };
  function validate(config) {
    const errors = [];
    const fail = label => errors.push(`${label} 无效或超出限制`);
    if (!config || typeof config !== 'object') return {ok:false,errors:['配置格式无效']};
    try { if (JSON.stringify(config).length > 2000000) fail('配置总大小（最大 2MB）'); } catch { return {ok:false,errors:['配置无法序列化']}; }
    const text = (v,max,label) => { if(typeof v !== 'string' || v.length>max) fail(label); };
    const number = (v,max,label,integer=false,min=0) => { if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(integer?!Number.isInteger(v):Math.abs(v*100-Math.round(v*100))>1e-7)) fail(label); };
    const p=config.profile||{}, r=config.rules||{};
    if(typeof config.configured!=='boolean') fail('初始化状态');
    ['name','phone','wechat','address','notice'].forEach(k=>text(p[k],k==='notice'?2000:200,`profile.${k}`));
    if(!raster(p.logo)) fail('标志图片');
    if(!['teal','blue','rose','graphite'].includes(p.theme)) fail('主题');
    if(!['light','dark'].includes(p.mode)) fail('显示模式');
    const ids=new Set();
    if(!Array.isArray(config.scenes)||config.scenes.length>100) fail('场景列表');
    else config.scenes.forEach((s,i)=>{
      if(!s||typeof s!=='object') {fail(`场景 ${i}`);return;}
      if(!safeId(s.id)||ids.has(s.id)) fail('场景 ID'); ids.add(s.id);
      text(s.name,100,'场景名称'); if(!s.name?.trim()) fail('场景名称');
      ['weekdayRate','weekendRate','holidayRate'].forEach(k=>number(s[k],1000000,k));
      number(s.capacity,10000,'人数',true,1);
      if(typeof s.active!=='boolean') fail('场景启用状态');
      text(s.group,80,'共享空间');text(s.description,2000,'场景说明');
      if(!raster(s.photo)) fail('场景图片');
    });
    const time=v=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
    if(!time(r.open)||!time(r.close)||r.open>=r.close) fail('营业时间');
    number(r.minMinutes,1439,'起租分钟',true,1);number(r.stepMinutes,720,'步长分钟',true,1);
    if(![15,30,60].includes(r.stepMinutes)) fail('时间步长（仅支持 15/30/60 分钟）');
    if(r.minMinutes % r.stepMinutes !== 0) fail('起租时长必须为时间步长的整数倍');
    ['overtimeRate','extraPersonRate','changeFee'].forEach(k=>number(r[k],1000000,k));
    number(r.freeChanges,1000,'免费改签次数',true);number(r.turnaroundMinutes,1440,'周转分钟',true);
    if(!['hours','fixed','percent','none'].includes(r.depositMode)) fail('订金模式');
    number(r.depositValue,r.depositMode==='percent'?100:r.depositMode==='hours'?24:1000000,'订金值');
    if(!Array.isArray(r.closedWeekdays)||r.closedWeekdays.length>7||r.closedWeekdays.some(v=>!Number.isInteger(v)||v<0||v>6)) fail('休息星期');
    if(!Array.isArray(r.closedDates)||r.closedDates.length>3660||r.closedDates.some(v=>!date(v))) fail('休息日期');
    if(!Array.isArray(r.quickHours)||r.quickHours.length>12||r.quickHours.some(v=>typeof v!=='number'||!Number.isFinite(v)||v*60<r.minMinutes||v>=24||(v*60)%r.stepMinutes!==0)) fail('快捷时长（必须满足起租时长、时间步长且少于 24 小时）');
    if(!Array.isArray(r.paymentMethods)||r.paymentMethods.length>20||r.paymentMethods.some(v=>typeof v!=='string'||!v.trim()||v.length>50)) fail('收款方式');
    ['phoneRequired','wechatRequired'].forEach(k=>{if(typeof r[k]!=='boolean') fail(k);});text(r.incomeNote,2000,'收款备注');
    return {ok:errors.length===0,errors};
  }
  return {getDefaultConfig:()=>clone(defaults),validate,clone,safeId};
})();
