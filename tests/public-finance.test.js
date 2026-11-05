const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(initial) {
  const values = new Map();
  if (initial !== undefined) values.set('public-studio-data-v1', typeof initial === 'string' ? initial : JSON.stringify(initial));
  const storage = {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  let tail = Promise.resolve();
  const events = [];
  const ctx = {console,localStorage:storage,navigator:{locks:{request:(n,o,f)=>{const next=tail.then(f);tail=next.catch(()=>{});return next;}}},
    setTimeout,alert:()=>{},confirm:()=>true,window:{dispatchEvent:event=>events.push(event)},
    CustomEvent:function(type,options){this.type=type;this.detail=options?.detail;}};
  vm.createContext(ctx);
  for (const name of ['config.js','app.js']) {
    let code = fs.readFileSync(path.join(__dirname,'../public-app',name),'utf8');
    if (name === 'app.js') code = code.split("window.addEventListener('beforeinstallprompt'")[0];
    vm.runInContext(code,ctx);
  }
  vm.runInContext(`globalThis.api={normalizeState,normalizeIncomeRecord,createIncomeAtomically,createBookingAtomically,
    updateBookingStatusAtomically,deleteIncomeAtomically,summarizeIncome,financeTotals,openOrderDetail,renderIncome,
    applyBookingToIncomeForm,handleNativeBack,showSaveSuccess,renderAll,renderCalendar,
    getState:()=>state,setState:s=>{state=s;saveState();}}`,ctx);
  return {ctx,api:ctx.api,studio:ctx.window.PublicStudio,storage,events};
}
const payment = {date:'2026-11-06',amount:'0.30',category:'deposit'};
async function receipt(x, extra = {}) {
  const result = await x.api.createIncomeAtomically({...payment,...extra});
  assert.equal(result.ok,true);
  return result.income;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('legacy receipts retain IDs and exact cents through normal reload',async()=>{
  const x=load(); const r=await receipt(x);
  const raw=x.studio.exportBackup();
  for(const key of ['kind','refund_of','reason','voided_at','void_reason']) delete raw.incomes[0][key];
  const y=load(raw);
  assert.equal(y.studio.getRecovery(),null);
  assert.equal(y.api.getState().incomes[0].id,r.id);
  assert.equal(y.api.getState().incomes[0].kind,'receipt');
  assert.deepEqual(plain(y.studio.financeSummary()),{gross:0.3,refunded:0,net:0.3});
});

test('reject subcent zero negative non-decimal and oversized amounts without writes',async()=>{
  const x=load();
  for(const amount of [0,'0.00',-1,'0.001','1.005',0.1+0.2,NaN,Infinity,true,'1e2','',10000000.01]) {
    assert.equal((await x.api.createIncomeAtomically({...payment,amount})).ok,false,String(amount));
  }
  assert.equal(x.api.getState().incomes.length,0);
  await receipt(x,{amount:'1.01'});
  await receipt(x,{amount:'0.29'});
  assert.equal(x.studio.financeSummary().net,1.3);
});

test('partial refunds use cents, enforce reference date reason and cumulative cap',async()=>{
  const x=load(); const r=await receipt(x);
  for(const patch of [{amount:0},{amount:0.001},{date:'2026-11-05'},{reason:' '},{booking_id:'wrong'},{amount:0.31}]) {
    assert.equal((await x.studio.createRefund(r.id,{date:r.date,amount:0.1,reason:'partial',...patch})).ok,false);
  }
  assert.equal((await x.studio.createRefund('missing',{date:r.date,amount:0.1,reason:'x'})).ok,false);
  const a=await x.studio.createRefund(r.id,{date:r.date,amount:'0.10',reason:'partial'});
  assert.equal(a.ok,true);
  assert.equal((await x.studio.createRefund(a.income.id,{date:r.date,amount:0.01,reason:'x'})).ok,false);
  assert.equal((await x.studio.createRefund({refund_of:r.id,date:r.date,amount:'0.20',reason:'rest'})).ok,true);
  assert.equal((await x.studio.createRefund(r.id,{date:r.date,amount:0.01,reason:'over'})).ok,false);
  assert.deepEqual(plain(x.studio.financeSummary()),{gross:0.3,refunded:0.3,net:0});
  assert.equal(load(x.studio.exportBackup()).studio.financeSummary().net,0);
});

test('concurrent refunds and voids serialize against latest persisted balance',async()=>{
  const x=load(); const r=await receipt(x);
  const results=await Promise.all([1,2].map(()=>x.studio.createRefund(r.id,{date:r.date,amount:0.2,reason:'race'})));
  assert.equal(results.filter(r=>r.ok).length,1);
  assert.equal(x.studio.financeSummary().net,0.1);
  assert.equal((await x.studio.voidIncome(r.id,'correct')).reason,'active_refunds');
  const y=load(); const s=await receipt(y);
  const race=await Promise.all([y.studio.voidIncome(s.id,'correct'),y.studio.createRefund(s.id,{date:s.date,amount:0.2,reason:'race'})]);
  assert.equal(race[0].ok,true);assert.equal(race[1].ok,false);
});

test('void requires reason, retains all records, and refund must be voided first',async()=>{
  const x=load(); const r=await receipt(x);
  const f=(await x.studio.createRefund(r.id,{date:r.date,amount:0.1,reason:'partial'})).income;
  assert.equal((await x.api.deleteIncomeAtomically(r.id)).ok,false);
  assert.equal((await x.studio.voidIncome(r.id,'correct')).reason,'active_refunds');
  assert.equal((await x.studio.voidIncome(f.id,'incorrect refund')).ok,true);
  assert.equal(x.studio.financeSummary().net,0.3);
  assert.equal((await x.api.deleteIncomeAtomically(r.id,'incorrect receipt')).ok,true);
  assert.equal((await x.studio.voidIncome(r.id,'again')).ok,false);
  assert.equal(x.api.getState().incomes.length,2);
  const y=load(x.studio.exportBackup());
  assert.equal(y.studio.getRecovery(),null);
  assert.deepEqual(plain(y.studio.financeSummary()),{gross:0,refunded:0,net:0});
  assert.ok(y.api.getState().incomes.every(r=>r.voided_at && r.void_reason));
});

test('storage failure rolls back both refund and void',async()=>{
  const x=load(); const r=await receipt(x); const before=JSON.stringify(x.studio.exportBackup());
  x.storage.setItem=()=>{throw Error('full');};
  assert.equal((await x.studio.createRefund(r.id,{date:r.date,amount:0.1,reason:'x'})).reason,'storage');
  assert.equal((await x.studio.voidIncome(r.id,'x')).reason,'storage');
  assert.equal(JSON.stringify(x.studio.exportBackup()),before);
});

test('separate stale windows re-read shared storage before financial writes',async()=>{
  const x=load();const r=await receipt(x);const y=load(x.studio.exportBackup());
  y.ctx.localStorage=x.storage;y.ctx.navigator=x.ctx.navigator;
  const results=await Promise.all([
    x.studio.createRefund(r.id,{date:r.date,amount:0.2,reason:'window one'}),
    y.studio.createRefund(r.id,{date:r.date,amount:0.2,reason:'window two'})
  ]);
  assert.equal(results.filter(result=>result.ok).length,1);
  assert.equal(load(x.storage.getItem('public-studio-data-v1')).studio.financeSummary().net,0.1);
  assert.equal((await y.studio.voidIncome(r.id,'stale window')).reason,'active_refunds');
});

test('same-ID amount kind reference and void-state contradictions fail merge',async()=>{
  const x=load();const r=await receipt(x);await x.studio.createRefund(r.id,{date:r.date,amount:0.1,reason:'partial'});
  const original=x.studio.exportBackup();
  const changes=[s=>s.incomes[0].amount=1,s=>s.incomes[1].reason='changed',s=>{
    s.incomes[1].kind='receipt';s.incomes[1].refund_of='';
  },s=>{s.incomes[1].voided_at='2026-11-06T12:00:00Z';s.incomes[1].void_reason='changed';}];
  for(const change of changes) {
    const incoming=plain(original);change(incoming);
    assert.equal((await x.studio.importBackup(incoming,'merge')).ok,false);
    assert.deepEqual(plain(x.studio.exportBackup()),plain(original));
  }
});

test('import rejects contradictory IDs and combined over-refunds atomically',async()=>{
  const x=load(); const r=await receipt(x); const stale=x.studio.exportBackup();
  assert.equal((await x.studio.createRefund(r.id,{date:r.date,amount:0.2,reason:'x'})).ok,true);
  const incoming=plain(x.studio.exportBackup());incoming.incomes[1].id='different-refund';
  let before=JSON.stringify(x.studio.exportBackup());
  assert.equal((await x.studio.importBackup(incoming,'merge')).ok,false);
  assert.equal(JSON.stringify(x.studio.exportBackup()),before);
  const f=x.api.getState().incomes[1];await x.studio.voidIncome(f.id,'wrong');await x.studio.voidIncome(r.id,'wrong');
  before=JSON.stringify(x.studio.exportBackup());
  assert.equal((await x.studio.importBackup(stale,'merge')).ok,false);
  assert.equal(JSON.stringify(x.studio.exportBackup()),before);
  const same=await x.studio.importBackup(x.studio.exportBackup(),'merge');
  assert.equal(same.ok,true);assert.equal(same.report.skippedIncomes,2);
});

test('malformed financial backups enter recovery and imports preserve current state',async()=>{
  const x=load();const r=await receipt(x);await x.studio.createRefund(r.id,{date:r.date,amount:0.1,reason:'x'});
  const valid=plain(x.studio.exportBackup());
  const corruptions=[s=>s.incomes[1].refund_of='missing',s=>s.incomes[1].booking_id='missing',
    s=>s.incomes[1].date='2026-11-05',s=>s.incomes[1].amount=0.31,s=>s.incomes[1].reason='',
    s=>s.incomes[0].void_reason='reason without timestamp',s=>s.incomes[0].kind='unknown',
    s=>s.incomes[0].voided_at='2026-11-06T12:00:00Z',s=>s.incomes.push({...s.incomes[0]})];
  for(const corrupt of corruptions) {
    const raw=plain(valid);corrupt(raw);const serialized=JSON.stringify(raw);const y=load(raw);
    assert.equal(y.studio.getRecovery(),serialized);
    assert.equal(y.storage.getItem('public-studio-data-v1'),serialized);
    const before=JSON.stringify(x.studio.exportBackup());
    assert.equal((await x.studio.importBackup(raw,'replace')).ok,false);
    assert.equal(JSON.stringify(x.studio.exportBackup()),before);
  }
});

test('period totals attribute refunds to refund date and exclude voids',async()=>{
  const x=load();const r=await receipt(x,{date:'2026-10-31',amount:10});
  const f=await x.studio.createRefund(r.id,{date:'2026-11-06',amount:3.01,reason:'x'});
  assert.deepEqual(plain(x.api.summarizeIncome(x.api.getState().incomes,'2026-11-06')),{day:-3.01,week:-3.01,month:-3.01});
  await x.studio.voidIncome(f.income.id,'wrong');
  assert.equal(x.api.summarizeIncome(x.api.getState().incomes,'2026-11-06').day,0);
});

function dom(x) {
  class Element {
    constructor(){this.children=[];this.value='';this.dataset={};this.style={setProperty(){}};this.classList={toggle(){},add(){},remove(){}};this.handlers={};}
    append(...items){this.children.push(...items);} appendChild(item){this.children.push(item);return item;}
    get firstChild(){return this.children[0];} removeChild(item){this.children.splice(this.children.indexOf(item),1);}
    setAttribute(k,v){this[k]=v;} addEventListener(k,f){this.handlers[k]=f;}
    showModal(){this.open=true;} close(){this.open=false;} querySelector(){return new Element();}
  }
  const elements=new Map();
  x.ctx.document={getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element(),querySelectorAll:()=>[],querySelector:()=>null};
  return {elements,get:id=>x.ctx.document.getElementById(id)};
}
function allText(element){return [element.textContent||'',...element.children.map(c=>typeof c==='string'?c:allText(c))].join(' ');}

test('cancelled detail retains refund access, net totals, links and no receivable',async()=>{
  const x=load();const c=x.ctx.window.PublicConfig.getDefaultConfig();c.configured=true;
  c.scenes=[{id:'studio',name:'Studio',weekdayRate:100,weekendRate:150,holidayRate:200,capacity:4,active:true,group:'',photo:'',description:''}];
  x.api.setState(x.api.normalizeState({config:c}));
  const b=(await x.api.createBookingAtomically({scene_id:'studio',date:'2026-11-06',start_time:'10:00',end_time:'12:00',people_count:1,customer_name:'Test',phone:'13800000000',wechat:'test'})).booking;
  const r=await receipt(x,{booking_id:b.id,amount:100});await x.studio.createRefund(r.id,{date:r.date,amount:20,reason:'partial'});
  await x.api.updateBookingStatusAtomically(b.id,'cancelled');
  assert.deepEqual(plain(x.studio.financeSummary(b.id)),{gross:100,refunded:20,net:80});
  const d=dom(x);x.api.openOrderDetail(x.api.getState().bookings[0]);
  assert.doesNotMatch(allText(d.get('orderDetailContent')),/待收/);
  assert.match(allText(d.get('orderDetailContent')),/partial/);
  assert.ok(d.get('orderDetailContent').children.flatMap(e=>e.children).some(e=>e.title==='退款'));
  assert.equal(x.events.at(-1).type,'publicstudio:detail');assert.equal(x.events.at(-1).detail.bookingId,b.id);
  x.api.applyBookingToIncomeForm(b.id);assert.equal(d.get('incomeAmount').value,'');
  d.get('incomeAnchorDate').value=r.date;x.api.renderIncome();
  assert.match(allText(d.get('incomeList')),/原收款/);
  assert.match(allText(d.get('incomeList')),/退款/);
  assert.match(d.get('incomePeriodTotal').textContent,/80/);
});

test('extension hooks dispatch after render and saved, back delegates after dialogs',()=>{
  const x=load();const d=dom(x);
  vm.runInContext('renderSummary=renderOrders=renderIncome=renderHolidays=renderBackupMeta=updateFeePreview=()=>{};',x.ctx);
  d.get('calendarDate').value='2026-11-06';x.api.renderAll();
  assert.deepEqual(x.events.map(e=>e.type),['publicstudio:calendar','publicstudio:render']);
  x.api.showSaveSuccess({id:'saved',date:'2026-11-06',start_time:'10:00',end_time:'12:00',total_fee:100,deposit_amount:30});
  assert.equal(x.events.at(-1).type,'publicstudio:saved');assert.equal(x.events.at(-1).detail.bookingId,'saved');
  let calls=0;x.ctx.window.PublicOperations={handleBack:()=>{calls++;return true;}};
  x.api.handleNativeBack();assert.equal(calls,1);
  const dialog=d.get('testDialog');dialog.open=true;x.ctx.document.querySelector=()=>dialog;
  x.api.handleNativeBack();assert.equal(calls,1);assert.equal(dialog.open,false);
});
