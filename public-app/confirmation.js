(() => {
  'use strict';
  const dialog=document.createElement('dialog');
  dialog.id='confirmationDialog'; dialog.className='confirmation-dialog';
  dialog.setAttribute('aria-labelledby','confirmationTitle');
  dialog.innerHTML='<header><h2 id="confirmationTitle">预约确认单</h2><button type="button" id="closeConfirmation" class="plain-icon" title="关闭确认单" aria-label="关闭确认单"><i data-lucide="x"></i></button></header><label class="toggle-line"><input id="confirmationPrivate" type="checkbox">包含客户姓名、手机号和微信号</label><p id="confirmationStatus" role="status" aria-live="polite"></p><img id="confirmationPreview" alt="预约确认单预览" hidden><footer><div class="button-row"><button id="downloadConfirmation" type="button"><i data-lucide="download"></i>保存图片</button><button id="shareConfirmation" type="button" class="primary"><i data-lucide="share-2"></i>分享确认单</button></div></footer>';
  document.body.append(dialog);
  const get=id=>document.getElementById(id);
  let bookingId='', generation=0, png='', busy=false;
  function wrap(ctx,value,width) {
    const lines=[];
    for(const paragraph of String(value||'').slice(0,5000).split('\n')) {
      let line='';
      for(const character of paragraph) {
        if(line&&ctx.measureText(line+character).width>width){lines.push(line);line=character;}else line+=character;
      }
      lines.push(line);
    }
    return lines;
  }
  function enable() {
    get('downloadConfirmation').disabled=!png||busy;
    get('shareConfirmation').disabled=!png||busy;
    get('confirmationPrivate').disabled=busy;
    get('closeConfirmation').disabled=busy;
  }
  async function render() {
    const token=++generation; png=''; enable();get('confirmationPreview').hidden=true;
    get('confirmationStatus').textContent='正在生成确认单…';
    const state=window.PublicStudio.exportBackup(), booking=state.bookings.find(b=>b.id===bookingId);
    if(!booking){get('confirmationStatus').textContent='订单不存在，请关闭后刷新';return;}
    const profile=state.config.profile;
    const sums=window.PublicStudio.financeSummary(booking.id);
    const canvas=document.createElement('canvas'); canvas.width=1000;
    let ctx=canvas.getContext('2d');
    const pending=Math.max(0,Math.round((booking.total_fee-sums.net)*100)/100);
    const rows=[['预约编号',booking.id],['订单状态',statusName(booking.status)],['置景',booking.scene_name],['日期',booking.date],['时间',`${booking.start_time}–${booking.end_time}`],['拍摄人数',`${booking.people_count} 人`],['预计费用',money(booking.total_fee)],['应付订金',money(booking.deposit_amount)],['累计收款',money(sums.gross)],['累计退款',money(sums.refunded)],['净收款',money(sums.net)]];
    if(booking.status!=='cancelled') rows.push(['待收金额',money(pending)]);
    else rows.push(['预约说明','此订单已取消，不占用档期；退款以实际流水为准。']);
    if(get('confirmationPrivate').checked) rows.push(['客户姓名',booking.customer_name],['手机号',booking.phone||'未填写'],['微信号',booking.wechat||'未填写']);
    if(profile.address) rows.push(['工作室地址',profile.address]);
    if(profile.phone) rows.push(['工作室电话',profile.phone]);
    if(profile.wechat) rows.push(['工作室微信',profile.wechat]);
    ctx.font='28px "Microsoft YaHei", sans-serif';
    const measured=rows.map(([label,value])=>({label,lines:wrap(ctx,value,660)}));
    const noticeLines=wrap(ctx,profile.notice||'请与工作室核对预约信息，以双方确认为准。',880);
    ctx.font='bold 38px "Microsoft YaHei", sans-serif';
    const titleLines=wrap(ctx,profile.name||'摄影棚预约管理',740);
    const headerHeight=100+titleLines.length*50;
    canvas.height=headerHeight+160+measured.reduce((sum,row)=>sum+Math.max(64,row.lines.length*40+24),0)+noticeLines.length*40+180;
    ctx=canvas.getContext('2d'); ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#087e78';ctx.fillRect(0,0,1000,12);
    let logo;
    try {logo=new Image();logo.src=profile.logo||'./icon.png';await logo.decode();}catch{logo=null;}
    if(token!==generation||!dialog.open)return;
    if(logo){const ratio=Math.min(100/logo.naturalWidth,100/logo.naturalHeight);ctx.drawImage(logo,60,50,logo.naturalWidth*ratio,logo.naturalHeight*ratio);}
    ctx.fillStyle='#183b48';ctx.font='bold 38px "Microsoft YaHei", sans-serif';
    titleLines.forEach((line,i)=>ctx.fillText(line,190,85+i*50));
    let y=headerHeight;ctx.font='bold 34px "Microsoft YaHei", sans-serif';ctx.fillText('预约确认单',60,y+35);y+=75;
    ctx.font='24px "Microsoft YaHei", sans-serif';ctx.fillStyle=booking.status==='cancelled'?'#b23838':'#536b77';
    ctx.fillText(booking.status==='pending'?'待确认 · 本单不代表已收款':booking.status==='cancelled'?'已取消 · 请勿凭此单到店履约':'预约信息 · 收款以实际流水为准',60,y);y+=30;
    for(const row of measured){
      ctx.strokeStyle='#e2e9e9';ctx.beginPath();ctx.moveTo(60,y);ctx.lineTo(940,y);ctx.stroke();
      ctx.font='26px "Microsoft YaHei", sans-serif';ctx.fillStyle='#637680';ctx.fillText(row.label,60,y+40);
      ctx.font='28px "Microsoft YaHei", sans-serif';ctx.fillStyle='#183b48';
      row.lines.forEach((line,i)=>ctx.fillText(line,280,y+40+i*40));
      y+=Math.max(64,row.lines.length*40+24);
    }
    y+=45;ctx.fillStyle='#183b48';ctx.font='bold 28px "Microsoft YaHei", sans-serif';ctx.fillText('预约须知',60,y);y+=45;
    ctx.font='28px "Microsoft YaHei", sans-serif';ctx.fillStyle='#637680';
    noticeLines.forEach(line=>{ctx.fillText(line,60,y);y+=40;});
    y+=45;ctx.font='22px "Microsoft YaHei", sans-serif';ctx.fillText(`生成于 ${new Date().toLocaleString('zh-CN')} · 此图片不自动更新`,60,y);
    png=canvas.toDataURL('image/png');get('confirmationPreview').src=png;get('confirmationPreview').hidden=false;
    get('confirmationStatus').textContent=get('confirmationPrivate').checked?'含客户隐私信息，请核对接收人。':'客户姓名及联系方式已隐藏。';enable();
  }
  function open(id){bookingId=id;get('confirmationPrivate').checked=false;dialog.showModal();render().catch(()=>{get('confirmationStatus').textContent='生成失败，请重试';});refreshIcons();}
  const filename=()=>`预约确认单-${bookingId}.png`;
  async function deliver(share){
    if(!png||busy)return;
    busy=true;enable();
    try {
      if(window.XiamuNative?.isNative){await window.XiamuNative.shareImage(filename(),png);get('confirmationStatus').textContent='已打开系统分享，请选择接收人或保存位置。';}
      else {
        const blob=await (await fetch(png)).blob();const file=new File([blob],filename(),{type:'image/png'});
        if(share&&navigator.canShare?.({files:[file]})) {await navigator.share({files:[file],title:'预约确认单'});get('confirmationStatus').textContent='分享操作已完成。';}
        else {const link=document.createElement('a');const url=URL.createObjectURL(blob);link.href=url;link.download=filename();link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);get('confirmationStatus').textContent='图片下载已发起，请在下载列表中查看。';}
      }
    } catch(error){get('confirmationStatus').textContent=error.name==='AbortError'||/cancel/i.test(error.message)?'已取消分享，订单未改变。':'未能分享，请检查存储权限后重试。';}
    finally{busy=false;enable();}
  }
  get('closeConfirmation').addEventListener('click',()=>{if(!busy)dialog.close();});
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  dialog.addEventListener('close',()=>{generation++;png='';get('confirmationPreview').removeAttribute('src');});
  get('confirmationPrivate').addEventListener('change',()=>render().catch(()=>{get('confirmationStatus').textContent='生成失败，请重新打开';}));
  get('downloadConfirmation').addEventListener('click',()=>deliver(false));
  get('shareConfirmation').addEventListener('click',()=>deliver(true));
  window.addEventListener('publicstudio:detail',event=>{
    const b=document.createElement('button');b.type='button';b.id='openConfirmation';b.innerHTML='<i data-lucide="share-2"></i>预览 / 分享确认单';
    b.addEventListener('click',()=>{get('orderDetailDialog').close();open(event.detail.bookingId);});
    get('orderDetailContent').append(b);refreshIcons();
  });
  window.PublicConfirmation={open};
})();
