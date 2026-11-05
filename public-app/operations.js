(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const form = el('bookingForm');
  let bookingOpen = false, step = 0, resetting = false, initialDraft = '';
  let quick = getUiPreferences().quick_booking === true;
  let view = 'day', workFilter = 'today', listLimit = 30;
  const text = (tag, value, className = '') => {
    const node = document.createElement(tag); node.textContent = value; node.className = className; return node;
  };
  function button(label, icon, action, className = '') {
    const node = text('button', '', className); node.type = 'button';
    if (icon) { const glyph = document.createElement('i'); glyph.dataset.lucide = icon; node.append(glyph); }
    node.append(text('span', label)); node.addEventListener('click', action); return node;
  }
  const draft = () => JSON.stringify(formData(form));
  const dirty = () => bookingOpen && draft() !== initialDraft;
  function finance(id) {
    return window.PublicStudio.financeSummary?.(id) || {gross:0,refunded:0,net:0};
  }
  function bookingBalance(booking) {
    return booking.status === 'cancelled' ? 0 : Math.max(0, Math.round((booking.total_fee - finance(booking.id).net) * 100) / 100);
  }
  function statusLabel(booking) {
    const now = new Date(), minute = now.getHours() * 60 + now.getMinutes();
    if (booking.status === 'cancelled' || booking.status === 'completed') return statusName(booking.status);
    if (booking.date === today() && toMinutes(booking.start_time) <= minute && toMinutes(booking.end_time) > minute) {
      return toMinutes(booking.end_time) - minute <= 30 ? '即将结束' : '预约进行中';
    }
    return statusName(booking.status);
  }
  function renderWorkbench() {
    el('workbenchDate').textContent = `${today()} · ${['周日','周一','周二','周三','周四','周五','周六'][new Date().getDay()]}`;
    const snapshot = window.PublicStudio.exportBackup();
    const active = snapshot.bookings.filter(b => b.status !== 'cancelled');
    const now = new Date(), minutes = now.getHours()*60 + now.getMinutes();
    const upcoming = active.filter(b => b.status !== 'completed' && (b.date > today() || (b.date === today() && toMinutes(b.end_time) > minutes)))
      .sort((a,b) => (a.date+a.start_time).localeCompare(b.date+b.start_time));
    const next = el('workbenchNext'); next.replaceChildren();
    if (upcoming.length) {
      const b = upcoming[0];
      const info = text('div',''); info.append(text('small', b.date === today() && toMinutes(b.start_time) <= minutes ? '当前拍摄' : '下一组客户'), text('h3', `${b.start_time}–${b.end_time} · ${b.scene_name}`), text('p', `${b.date} · ${b.customer_name} · ${b.people_count} 人`));
      next.append(info, button('查看订单','arrow-up-right',()=>openOrderDetail(b)));
    } else { next.append(text('div','暂无待开始的拍摄'),button('查看档期','calendar-days',()=>switchTab('calendar',{top:true}))); }
    const todayList = active.filter(b=>b.date === today());
    const pending = active.filter(b=>b.status === 'pending');
    const due = active.filter(b=>bookingBalance(b)>0);
    const groups = {today:todayList,pending,due};
    document.querySelectorAll('[data-workbench]').forEach(b=>{
      b.classList.toggle('active',b.dataset.workbench===workFilter);
      b.setAttribute('aria-pressed',String(b.dataset.workbench===workFilter));
      b.textContent = `${{today:'今日流程',pending:'待确认',due:'待收款'}[b.dataset.workbench]} ${groups[b.dataset.workbench].length}`;
    });
    const list = el('workbenchList'); list.replaceChildren();
    const items = groups[workFilter].sort((a,b)=>(a.date+a.start_time).localeCompare(b.date+b.start_time));
    if (!items.length) list.append(text('p', {today:'今天暂无预约',pending:'暂无待确认订单',due:'暂无待收款订单'}[workFilter], 'empty-state'));
    for (const b of items.slice(0,listLimit)) {
      const row = text('article','', 'work-row');
      const body = text('div','','work-row-body');
      body.append(text('strong', `${b.start_time}–${b.end_time} · ${b.scene_name}`),text('span',`${b.customer_name} · ${b.date}`));
      const status = text('span',statusLabel(b),'status-badge'); status.dataset.status=b.status; body.append(status);
      if (workFilter === 'due') body.append(text('strong',`待收 ${money(bookingBalance(b))}`,'amount-due'));
      const warnings = getTurnaroundWarnings(b,b.id);
      if (warnings.length) body.append(text('p', warnings.map(formatTurnaroundWarning).join('\n'), 'ops-turnaround'));
      const actions=text('div','','work-row-actions');
      actions.append(button('详情','file-text',()=>openOrderDetail(b)));
      if (bookingBalance(b)>0) actions.append(button('收款','wallet',()=>openIncomeDialog(b)));
      row.append(body,actions); list.append(row);
    }
    if(items.length>listLimit) list.append(button('显示更多','chevron-down',()=>{listLimit+=30;renderWorkbench();}));
    refreshIcons();
  }

  function renderReview() {
    const input = formData(form), scene = getScene(input.scene_id);
    const review=el('bookingReview'); review.replaceChildren();
    [['置景',scene?.name||'未选择'],['档期',`${input.date} ${input.start_time}–${input.end_time}`],['客户',`${input.customer_name || '未填写'} · ${input.people_count} 人`],['联系电话',input.phone || '未填写'],['微信',input.wechat || '未填写']].forEach(([label,value])=>{
      review.append(text('dt',label),text('dd',value));
    });
    const warnings = getTurnaroundWarnings(input);
    if(warnings.length) review.append(text('dt','紧邻档期'),text('dd',warnings.map(formatTurnaroundWarning).join('\n'),'ops-turnaround'));
  }
  function renderWizard() {
    document.body.dataset.bookingOpen=String(bookingOpen);
    document.body.dataset.bookingMode=quick?'quick':'guided';
    document.body.dataset.bookingStep=String(step);
    form.hidden=!bookingOpen; el('workbench').hidden=bookingOpen;
    document.querySelector('#book > .notice').hidden=!bookingOpen;
    ['scheduleStep','customerStep','quoteStep'].forEach((id,i)=>{el(id).hidden=!quick&&step!==i;});
    el('bookingSteps').hidden=quick;
    el('guidedBooking').setAttribute('aria-pressed',String(!quick)); el('quickBooking').setAttribute('aria-pressed',String(quick));
    document.querySelectorAll('[data-booking-step]').forEach(b=>b.setAttribute('aria-current',Number(b.dataset.bookingStep)===step?'step':'false'));
    el('bookingPrevious').hidden=quick||step===0; el('bookingNext').hidden=quick||step===2;
    form.querySelector('.desktop-submit').hidden=!quick&&step!==2;
    el('bookingSubmitBar').querySelector('button').textContent=quick||step===2?'保存预约':'下一步';
    if(quick||step===2) renderReview();
  }
  function validateStep(target) {
    const input=formData(form);
    const errors=target===0 ? validateBooking(input,{skipCustomer:true}).errors : Object.values(getBookingFieldErrors(input));
    if(target===0 && hasConflict(input)) errors.push('该时段与已有订单重叠，请调整时间');
    el('bookingStepError').textContent=errors.join('；');
    if(errors.length) {el('bookingStepError').focus(); return false;}
    return true;
  }
  function advance() {
    if(!validateStep(step)) return;
    step=Math.min(2,step+1); renderWizard(); form.scrollIntoView({block:'start'});
  }
  function beginBooking(prefill = {}) {
    if(dirty()&&!confirm('当前预约尚未保存，放弃并新建预约？')) return false;
    resetting=true; form.reset(); resetting=false;
    form.querySelectorAll('[data-touched]').forEach(n=>delete n.dataset.touched);
    const rules=window.PublicStudio.getConfig().rules;
    if(prefill.scene_id) el('scene').value=prefill.scene_id;
    el('date').value=prefill.date || today();
    const start=prefill.start_time || minutesToTime(Math.ceil(toMinutes(rules.open)/rules.stepMinutes)*rules.stepMinutes);
    el('start').value=start;
    const end=toMinutes(start)+rules.minMinutes;
    el('end').value=prefill.end_time || (end<1440?minutesToTime(end):'');
    el('people').value=1; el('scene').dispatchEvent(new Event('change'));
    initialDraft=draft(); step=0; bookingOpen=true;
    el('bookingStepError').textContent='';
    switchTab('book',{top:true}); updateFeePreview(); renderWizard(); window.scrollTo(0,0); return true;
  }
  function closeBooking() {
    if(dirty()&&!confirm('预约尚未保存，确定放弃并返回工作台？')) return false;
    bookingOpen=false; renderWizard(); renderWorkbench(); return true;
  }

  function availableSlots(sceneId,date,duration,includeOvertime=false) {
    const config=window.PublicStudio.getConfig(), r=config.rules;
    if(!isDate(date)||!Number.isInteger(duration)||duration<r.minMinutes||duration%r.stepMinutes!==0) return [];
    const start=includeOvertime?0:toMinutes(r.open), end=includeOvertime?1439:toMinutes(r.close);
    const slots=[];
    for(let minute=Math.ceil(start/r.stepMinutes)*r.stepMinutes;minute+duration<=end;minute+=r.stepMinutes) {
      const input={scene_id:sceneId,date,start_time:minutesToTime(minute),end_time:minutesToTime(minute+duration),people_count:1};
      if(!validateBooking(input,{skipCustomer:true}).errors.length&&!hasConflict(input)) slots.push(input);
    }
    return slots;
  }
  function fillCalendarControls() {
    const config=window.PublicStudio.getConfig();
    const selected=el('calendarScene').value, duration=el('calendarDuration').value;
    el('calendarScene').replaceChildren(new Option('全部置景',''));
    config.scenes.forEach(s=>el('calendarScene').add(new Option(s.name+(s.active?'':'（停用）'),s.id)));
    if(config.scenes.some(s=>s.id===selected)) el('calendarScene').value=selected;
    el('calendarDuration').replaceChildren();
    [...new Set([config.rules.minMinutes,...config.rules.quickHours.map(h=>h*60)])].sort((a,b)=>a-b).forEach(m=>el('calendarDuration').add(new Option(`${m/60} 小时`,String(m))));
    if([...el('calendarDuration').options].some(o=>o.value===duration)) el('calendarDuration').value=duration;
  }
  function renderBoard() {
    const anchor=el('calendarDate').value;
    const list=el('calendarList'); list.replaceChildren(); list.classList.add('ops-calendar');
    if(!isDate(anchor)) {list.append(text('p','请选择有效日期'));return;}
    const config=window.PublicStudio.getConfig(), snapshot=window.PublicStudio.exportBackup();
    const dates=Array.from({length:view==='week'?7:1},(_,i)=>shiftDate(anchor,i));
    el('calendarRangeLabel').textContent=`${dates[0]}${view==='week'?' 至 '+dates[6]:''} · 收尾间隔仅提醒，不额外占档`;
    el('calendarPrev').setAttribute('aria-label',view==='week'?'前七天':'前一天');
    el('calendarNext').setAttribute('aria-label',view==='week'?'后七天':'后一天');
    for(const date of dates) {
      const day=text('section','','calendar-day'); day.append(text('h3',`${date} ${['周日','周一','周二','周三','周四','周五','周六'][new Date(date+'T12:00:00').getDay()]}`));
      let shown=0;
      for(const scene of config.scenes.filter(s=>!el('calendarScene').value||s.id===el('calendarScene').value)) {
        const slots=availableSlots(scene.id,date,Number(el('calendarDuration').value),el('calendarOvertime').checked);
        if(el('calendarOnlyFree').checked&&!slots.length) continue;
        shown++;
        const lane=text('div','','calendar-scene'); lane.append(text('h4',scene.name+(scene.active?'':' · 已停用')));
        const bookings=snapshot.bookings.filter(b=>b.date===date&&b.scene_id===scene.id&&b.status!=='cancelled').sort((a,b)=>a.start_time.localeCompare(b.start_time));
        const booked=text('div','','calendar-booked');
        for(const b of bookings) {
          const item=button(`${b.start_time}–${b.end_time} · ${b.customer_name} · ${statusName(b.status)}`,'calendar-check',()=>openOrderDetail(b),'calendar-booking');
          item.dataset.status=b.status; booked.append(item);
          const warnings=getTurnaroundWarnings(b,b.id);
          if(warnings.length) booked.append(text('p',warnings.map(formatTurnaroundWarning).join('\n'),'ops-turnaround'));
        }
        if(!bookings.length) booked.append(text('small','暂无预约'));
        lane.append(booked);
        const free=text('div','','calendar-free');
        const makeSlot=slot=>button(`${slot.start_time}–${slot.end_time}`,'plus',()=>beginBooking(slot),'free-slot');
        slots.slice(0,4).forEach(s=>free.append(makeSlot(s)));
        if(slots.length>4) {
          const details=document.createElement('details'); details.className='more-slots'; details.append(text('summary',`更多可约时段（${slots.length-4}）`));
          const more=text('div','','calendar-free'); slots.slice(4).forEach(s=>more.append(makeSlot(s))); details.append(more); free.append(details);
        }
        if(!slots.length) free.append(text('small',scene.active?'当前条件下无可约时段':'已停用，不接受新预约'));
        lane.append(free); day.append(lane);
      }
      if(!shown) day.append(text('p','当前筛选下没有可预约置景','empty-state'));
      list.append(day);
    }
    refreshIcons();
  }
  document.querySelectorAll('[data-workbench]').forEach(b=>b.addEventListener('click',()=>{workFilter=b.dataset.workbench;listLimit=30;renderWorkbench();}));
  el('newBooking').addEventListener('click',()=>beginBooking());
  el('closeBooking').addEventListener('click',closeBooking);
  el('bookingNext').addEventListener('click',advance);
  el('bookingPrevious').addEventListener('click',()=>{step=Math.max(0,step-1);el('bookingStepError').textContent='';renderWizard();});
  document.querySelectorAll('[data-booking-step]').forEach(b=>b.addEventListener('click',()=>{
    const target=Number(b.dataset.bookingStep);
    if(target>step && (!validateStep(0)||(target===2&&!validateStep(1)))) return;
    step=target;el('bookingStepError').textContent='';renderWizard();
  }));
  [['guidedBooking',false],['quickBooking',true]].forEach(([id,value])=>el(id).addEventListener('click',()=>{
    quick=value;step=0;updateUiPreferences({quick_booking:quick});el('bookingStepError').textContent='';renderWizard();
  }));
  form.addEventListener('submit',e=>{
    if(!quick&&step<2) {e.preventDefault();e.stopImmediatePropagation();advance();return;}
    if(!quick) {
      const input=formData(form), errors=getBookingFieldErrors(input);
      if(Object.keys(errors).length || hasConflict(input)) {
        e.preventDefault();e.stopImmediatePropagation();step=['scene','date','start','end','people'].some(k=>errors[k])||hasConflict(input)?0:1;
        renderWizard();validateStep(step);
      }
    }
  },true);
  form.addEventListener('input',()=>{if(quick||step===2)renderReview();});
  form.addEventListener('reset',()=>{if(!resetting){bookingOpen=false;step=0;queueMicrotask(renderWizard);}});
  el('continueBooking').addEventListener('click',()=>beginBooking());
  for(const [id,mode] of [['calendarDayView','day'],['calendarWeekView','week']]) el(id).addEventListener('click',()=>{
    view=mode;el('calendarDayView').setAttribute('aria-pressed',String(view==='day'));el('calendarWeekView').setAttribute('aria-pressed',String(view==='week'));renderBoard();
  });
  ['calendarScene','calendarOnlyFree','calendarDuration','calendarOvertime'].forEach(id=>el(id).addEventListener('change',renderBoard));
  for(const [id,dir] of [['calendarPrev',-1],['calendarNext',1]]) el(id).addEventListener('click',e=>{
    if(view==='week'){e.stopImmediatePropagation();changeCalendarDate(dir*7);}
  },true);
  window.addEventListener('publicstudio:render',()=>{renderWorkbench();renderWizard();});
  window.addEventListener('publicstudio:calendar',renderBoard);
  window.addEventListener('publicstudio:config',()=>{fillCalendarControls();renderBoard();renderWorkbench();});
  window.addEventListener('publicstudio:saved',()=>{bookingOpen=false;renderWizard();renderWorkbench();});
  window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderWorkbench();}});
  setInterval(()=>{if(!document.hidden&&activeTab==='book'&&!bookingOpen)renderWorkbench();},60000);
  window.PublicOperations={beginBooking,availableSlots,bookingBalance,handleBack:()=>{
    if(activeTab==='book'&&bookingOpen){closeBooking();return true;}return false;
  }};
  fillCalendarControls();renderBoard();renderWorkbench();renderWizard();
})();
