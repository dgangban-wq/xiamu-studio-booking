(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const themes = {teal:'#087e78', blue:'#2869ab', rose:'#ac4065', graphite:'#48545c'};
  let draft, original, step = 0, saving = false, uploadCount = 0, openedOnce = false;
  const dialog = document.createElement('dialog');
  dialog.id = 'studioConfigDialog';
  dialog.className = 'config-dialog';
  dialog.setAttribute('aria-labelledby', 'configTitle');
  dialog.innerHTML = `<form id="studioConfigForm" novalidate>
    <header class="config-header"><div><small>STUDIO BOOKING · 公开版 1.0.1</small><h2 id="configTitle">工作室配置</h2></div><button id="configClose" type="button" class="plain-icon" title="关闭配置" aria-label="关闭配置"><i data-lucide="x"></i></button></header>
    <nav class="config-steps" aria-label="配置步骤"><button type="button" data-config-step="0">1 工作室</button><button type="button" data-config-step="1">2 场景</button><button type="button" data-config-step="2">3 预约规则</button></nav>
    <div id="configErrors" class="config-errors" role="alert" tabindex="-1" hidden></div>
    <div id="configBody" class="config-body"></div>
    <footer class="config-footer"><span id="configDirty" role="status"></span><button id="configPrevious" type="button">上一步</button><button id="configNext" type="button" class="primary">下一步</button><button id="configSave" type="submit" class="primary">保存配置</button></footer>
  </form>`;
  document.body.append(dialog);
  const field = (scope, key, label, type = 'text', extra = '') => {
    const id = `cfg-${scope}-${key}`;
    const value = scope === 'scene' ? '' : draft[scope][key];
    return `<div class="field"><label for="${id}">${label}</label><input id="${id}" data-scope="${scope}" data-key="${key}" type="${type}" value="${esc(value)}" ${extra}></div>`;
  };
  const area = (scope, key, label, value = draft[scope][key]) => `<div class="field"><label for="cfg-${scope}-${key}">${label}</label><textarea id="cfg-${scope}-${key}" data-scope="${scope}" data-key="${key}" rows="3" maxlength="2000">${esc(value)}</textarea></div>`;
  const check = (key, label) => `<label class="toggle-line"><input type="checkbox" data-scope="rules" data-key="${key}" id="cfg-rules-${key}" ${draft.rules[key] ? 'checked' : ''}>${label}</label>`;
  const imageInput = (scope, key, value, index = '') => `<div class="config-image"><img src="${esc(value || './icon.png')}" alt="${key === 'logo' ? '标志' : '场景照片'}预览"><label class="file-btn"><i data-lucide="image-plus"></i>${key === 'logo' ? '上传标志' : '上传照片'}<input type="file" accept="image/png,image/jpeg,image/webp" data-image="${key}" data-index="${index}" aria-label="${key === 'logo' ? '上传标志' : '上传场景照片'}"></label><button type="button" data-remove-image="${key}" data-index="${index}" class="plain-icon" aria-label="移除图片" title="移除图片"><i data-lucide="trash-2"></i></button></div>`;
  function render() {
    $('configTitle').textContent = original.configured ? '工作室配置' : '创建你的工作室';
    dialog.querySelectorAll('[data-config-step]').forEach((b) => { b.setAttribute('aria-current', +b.dataset.configStep === step ? 'step' : 'false'); });
    $('configPrevious').hidden = step === 0;
    $('configNext').hidden = step === 2;
    $('configSave').hidden = step !== 2;
    if (step === 0) {
      $('configBody').innerHTML = `<h3>基本资料</h3>${imageInput('profile','logo',draft.profile.logo)}<div class="config-grid">${field('profile','name','工作室名称','text','required maxlength="60"')}${field('profile','phone','联系电话','tel','maxlength="30"')}${field('profile','wechat','联系微信','text','maxlength="60"')}${field('profile','address','地址','text','maxlength="200"')}</div>${area('profile','notice','预约公告')}<h3>外观</h3><div class="config-appearance"><fieldset class="config-swatches"><legend>主题色</legend>${Object.entries(themes).map(([key,color]) => `<label title="${({teal:'青绿',blue:'蓝色',rose:'玫红',graphite:'石墨'})[key]}"><input type="radio" name="theme" data-scope="profile" data-key="theme" value="${key}" ${draft.profile.theme === key ? 'checked' : ''}><span style="background:${color}" aria-label="${key}"></span></label>`).join('')}</fieldset><label class="toggle-line"><input id="cfg-profile-mode" type="checkbox" ${draft.profile.mode === 'dark' ? 'checked' : ''}>深色模式</label></div>`;
    } else if (step === 1) {
      $('configBody').innerHTML = `<div class="section-head"><h3>场景与价格</h3><button id="configAddScene" type="button"><i data-lucide="plus"></i>新增场景</button></div><div id="configScenes">${draft.scenes.map((s,i) => `<article class="config-scene" data-scene-index="${i}"><header><strong>${esc(s.name || '未命名场景')}</strong><div class="config-scene-tools">${[['up','arrow-up','上移',i === 0],['down','arrow-down','下移',i === draft.scenes.length-1],['delete','trash-2','删除场景',false]].map(([a,icon,label,disabled]) => `<button type="button" class="plain-icon" data-scene-action="${a}" data-index="${i}" title="${label}" aria-label="${label}" ${disabled ? 'disabled' : ''}><i data-lucide="${icon}"></i></button>`).join('')}<label class="toggle-line"><input type="checkbox" data-scene-key="active" data-index="${i}" ${s.active ? 'checked' : ''}>启用</label></div></header><div class="config-grid">${[['name','场景名称','text'],['group','棚位分组','text'],['weekdayRate','工作日单价（元/小时）','number'],['weekendRate','周末单价（元/小时）','number'],['holidayRate','节假日单价（元/小时）','number'],['capacity','包含人数','number']].map(([key,label,type]) => `<div class="field"><label for="cfg-scene-${i}-${key}">${label}</label><input id="cfg-scene-${i}-${key}" data-scene-key="${key}" data-index="${i}" type="${type}" value="${esc(s[key])}" ${type === 'number' ? `min="${key === 'capacity' ? 1 : 0}" step="${key === 'capacity' ? 1 : '0.01'}" required` : 'maxlength="80"'}></div>`).join('')}</div><div class="field"><label for="cfg-scene-${i}-description">场景描述</label><textarea id="cfg-scene-${i}-description" data-scene-key="description" data-index="${i}" maxlength="1000" rows="2">${esc(s.description)}</textarea></div>${imageInput('scene','photo',s.photo,i)}</article>`).join('')}</div>`;
    } else {
      const r = draft.rules;
      $('configBody').innerHTML = `<h3>营业与时长</h3><div class="config-grid">${field('rules','open','营业开始','time','required')}${field('rules','close','营业结束','time','required')}${field('rules','minMinutes','最短预约（分钟）','number','min="1" step="1" required')}${field('rules','stepMinutes','时间步长（分钟）','number','min="1" step="1" required')}${field('rules','turnaroundMinutes','收尾提醒间隔（分钟）','number','min="0" step="1" required')}${field('rules','quickHours','快捷时长（小时，逗号分隔）')}</div><h3>费用与改签</h3><div class="config-grid">${field('rules','overtimeRate','营业外加班费（元/小时）','number','min="0" step="0.01" required')}${field('rules','extraPersonRate','超出人数费用（元/人）','number','min="0" step="0.01" required')}<div class="field"><label for="cfg-rules-depositMode">订金方式</label><select id="cfg-rules-depositMode" data-scope="rules" data-key="depositMode">${[['hours','按小时单价'],['fixed','固定金额'],['percent','总额百分比'],['none','不收订金']].map(([v,l]) => `<option value="${v}" ${r.depositMode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>${field('rules','depositValue','订金数值（小时 / 元 / %）','number','min="0" step="0.01" required')}${field('rules','freeChanges','免费改签次数','number','min="0" step="1" required')}${field('rules','changeFee','超过免费次数改签费（元/次）','number','min="0" step="0.01" required')}</div><h3>休息日</h3><fieldset class="config-weekdays"><legend>每周固定休息</legend>${['日','一','二','三','四','五','六'].map((name,i) => `<label><input type="checkbox" data-weekday="${i}" ${r.closedWeekdays.includes(i) ? 'checked' : ''}>周${name}</label>`).join('')}</fieldset>${area('rules','closedDates','休息日期（YYYY-MM-DD，每行一个）',r.closedDates.join('\n'))}<h3>客户与收款</h3><div class="config-appearance">${check('phoneRequired','手机号必填')}${check('wechatRequired','微信号必填')}</div>${area('rules','paymentMethods','收款方式（每行一个）',r.paymentMethods.join('\n'))}${field('rules','incomeNote','收入默认备注','text','maxlength="200"')}`;
    }
    if (step === 0) {
      dialog.querySelectorAll('input[name="theme"]').forEach(input=>input.setAttribute('aria-label',({teal:'青绿',blue:'蓝色',rose:'玫红',graphite:'石墨'})[input.value]));
    }
    if (step === 1) {
      dialog.querySelectorAll('[data-scene-key="group"]').forEach((input) => {
        input.labels[0].textContent = '共用场地';
        const hint = document.createElement('small');
        hint.textContent = '相同名称共用一个场地，同一时段不能同时预约；独立场地留空。';
        input.after(hint);
      });
    }
    if (step === 2) {
      const oldStep = $('cfg-rules-stepMinutes');
      const stepSelect = document.createElement('select');
      stepSelect.id = oldStep.id; stepSelect.dataset.scope = 'rules'; stepSelect.dataset.key = 'stepMinutes';
      [15,30,60].forEach(value=>{ const option = new Option(`${value} 分钟`,String(value)); option.selected = draft.rules.stepMinutes === value; stepSelect.add(option); });
      oldStep.replaceWith(stepSelect);
      $('cfg-rules-minMinutes').step = String(draft.rules.stepMinutes);
      $('cfg-rules-minMinutes').min = String(draft.rules.stepMinutes);
      const preview = document.createElement('section');
      preview.className = 'config-quote';
      preview.innerHTML = `<h3>试算预约</h3><div class="config-grid"><div class="field"><label for="configQuoteScene">场景</label><select id="configQuoteScene">${draft.scenes.filter(s=>s.active).map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label for="configQuoteDate">日期</label><input id="configQuoteDate" type="date"></div><div class="field"><label for="configQuoteStart">开始</label><input id="configQuoteStart" type="time" value="${esc(draft.rules.open)}"></div><div class="field"><label for="configQuoteEnd">结束</label><input id="configQuoteEnd" type="time"></div><div class="field"><label for="configQuotePeople">人数</label><input id="configQuotePeople" type="number" min="1" value="1"></div></div><output id="configQuoteResult" aria-live="polite"></output>`;
      $('configBody').append(preview);
      const now = new Date();
      $('configQuoteDate').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const [h,m] = draft.rules.open.split(':').map(Number);
      const end = Math.min(1439,h*60+m+draft.rules.minMinutes);
      $('configQuoteEnd').value = `${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`;
      updateQuote();
    }
    window.lucide?.createIcons();
    dirtyStatus();
  }
  function dirty() { return draft && JSON.stringify(draft) !== JSON.stringify(original); }
  function updateQuote() {
    if (step !== 2 || !$('configQuoteResult')) return;
    if (!window.PublicStudio.preview) { $('configQuoteResult').textContent = '试算暂不可用'; return; }
    if (!$('configQuoteScene').value) { $('configQuoteResult').textContent = '请先添加并启用场景'; return; }
    try {
      const fee = window.PublicStudio.preview(draft,{sceneId:$('configQuoteScene').value,date:$('configQuoteDate').value,start:$('configQuoteStart').value,end:$('configQuoteEnd').value,people:Number($('configQuotePeople').value)});
      $('configQuoteResult').textContent = `预计 ¥${fee.totalFee} · 订金 ¥${fee.depositFee}${fee.warnings?.length ? '\n'+fee.warnings.join('；') : ''}`;
    } catch { $('configQuoteResult').textContent = '请先填写有效的场景和规则'; }
  }
  function dirtyStatus() { $('configDirty').textContent = uploadCount ? '图片处理中…' : dirty() ? '未保存' : '尚无修改'; }
  function errors(messages) {
    const box = $('configErrors');
    box.hidden = !messages.length;
    box.textContent = messages.join('；');
    if (messages.length) box.focus();
  }
  function open() {
    if (!window.PublicStudio || dialog.open) return;
    original = clone(window.PublicStudio.getConfig());
    draft = clone(original);
    step = 0;
    errors([]); render(); dialog.showModal(); openedOnce = true;
  }
  function close() {
    if (saving || uploadCount) return;
    if (dirty() && !window.confirm('放弃尚未保存的配置修改？')) return;
    dialog.close();
  }
  function syncField(target) {
    if (target.id === 'cfg-profile-mode') draft.profile.mode = target.checked ? 'dark' : 'light';
    else if (target.dataset.weekday !== undefined) draft.rules.closedWeekdays = [...dialog.querySelectorAll('[data-weekday]:checked')].map((e) => +e.dataset.weekday);
    else if (target.dataset.sceneKey) {
      draft.scenes[+target.dataset.index][target.dataset.sceneKey] = target.type === 'checkbox' ? target.checked : target.type === 'number' ? (target.value === '' ? null : +target.value) : target.value;
    } else if (target.dataset.scope) {
      const {scope,key} = target.dataset;
      let value = target.type === 'checkbox' ? target.checked : target.type === 'number' || key === 'stepMinutes' ? (target.value === '' ? null : +target.value) : target.value;
      if (['closedDates','paymentMethods'].includes(key)) value = value.split(/[\n,，]+/).map((s) => s.trim()).filter(Boolean);
      if (key === 'quickHours') value = value.split(/[,，\s]+/).filter(Boolean).map(Number);
      draft[scope][key] = value;
      if (key === 'stepMinutes') { $('cfg-rules-minMinutes').step = String(value); $('cfg-rules-minMinutes').min = String(value); }
    }
    dirtyStatus();
    updateQuote();
  }
  async function compress(file, logo) {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 图片');
    if (file.size > 10 * 1024 * 1024) throw new Error('原图不能超过 10 MB');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      if (img.width * img.height > 40000000) throw new Error('原图像素过大，请选择较小图片');
      const canvas = document.createElement('canvas');
      let max = logo ? 320 : 960;
      for (let pass = 0; pass < 5; pass++) {
        const scale = Math.min(1, max / Math.max(img.width,img.height));
        canvas.width = Math.max(1,Math.round(img.width * scale)); canvas.height = Math.max(1,Math.round(img.height * scale));
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height);
        const data = canvas.toDataURL('image/jpeg', 0.78 - pass * 0.08);
        if (data.length <= 100 * 1024) return data;
        max = Math.round(max * 0.75);
      }
      throw new Error('图片压缩后仍过大，请换一张图片');
    } finally { URL.revokeObjectURL(url); }
  }
  dialog.addEventListener('input', (e) => { if (e.target.type !== 'file') syncField(e.target); });
  dialog.addEventListener('change', async (e) => {
    const t = e.target;
    if (!t.dataset.image || !t.files[0]) return;
    const scene = t.dataset.image === 'photo' ? draft.scenes[+t.dataset.index] : null;
    uploadCount++; dirtyStatus();
    try {
      const data = await compress(t.files[0], !scene);
      if (scene) scene.photo = data; else draft.profile.logo = data;
      errors([]);
    } catch (error) { errors([error.message || '图片读取失败']); }
    finally { uploadCount--; render(); }
  });
  dialog.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || saving || uploadCount) return;
    if (b.id === 'configClose') close();
    if (b.id === 'configNext' || b.id === 'configPrevious' || b.dataset.configStep !== undefined) {
      step = b.dataset.configStep !== undefined ? +b.dataset.configStep : step + (b.id === 'configNext' ? 1 : -1); errors([]); render(); $('configBody').scrollTop = 0;
    }
    if (b.id === 'configAddScene') {
      draft.scenes.push({id: 'scene-' + (crypto.randomUUID?.() || Date.now().toString(36)),name:'新场景',weekdayRate:0,weekendRate:0,holidayRate:0,capacity:1,active:true,group:'',photo:'',description:''}); render();
      $('configScenes').lastElementChild.querySelector('input').focus();
    }
    if (b.dataset.sceneAction) {
      const i = +b.dataset.index, action = b.dataset.sceneAction;
      if (action === 'delete') { if (!confirm('删除这个场景？已被订单引用的场景不能删除，请取消后改为停用。')) return; draft.scenes.splice(i,1); }
      else { const j = i + (action === 'up' ? -1 : 1); [draft.scenes[i],draft.scenes[j]] = [draft.scenes[j],draft.scenes[i]]; }
      render();
    }
    if (b.dataset.removeImage) { if (b.dataset.removeImage === 'logo') draft.profile.logo = ''; else draft.scenes[+b.dataset.index].photo = ''; render(); }
  });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  $('studioConfigForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving || uploadCount) return;
    const invalid = dialog.querySelector('input:invalid');
    if (invalid) { invalid.reportValidity(); return; }
    if (JSON.stringify(draft).length > 2 * 1024 * 1024) { errors(['配置总大小不能超过 2 MB，请移除部分场景图片']); return; }
    saving = true; $('configSave').disabled = true;
    try {
      const candidate = clone(draft); candidate.configured = true;
      const result = await window.PublicStudio.saveConfig(candidate);
      if (!result.ok) { errors(result.errors || ['保存失败']); return; }
      original = clone(candidate); draft = clone(candidate); dialog.close(); apply();
    } catch (error) { errors([error.message || '保存失败，请检查本机存储空间']); }
    finally { saving = false; $('configSave').disabled = false; }
  });
  window.addEventListener('beforeunload', (e) => { if (dialog.open && dirty()) { e.preventDefault(); e.returnValue = ''; } });
  $('openStudioConfig').addEventListener('click', open);
  const recovery = document.createElement('section');
  recovery.id = 'configRecovery'; recovery.className = 'config-recovery'; recovery.hidden = true;
  recovery.setAttribute('role','alertdialog'); recovery.setAttribute('aria-modal','true'); recovery.setAttribute('aria-label','本机数据恢复'); recovery.tabIndex = -1;
  recovery.innerHTML = '<h2>本机数据暂时无法读取</h2><p>原始数据仍保留。请先导出故障数据，妥善保存后再决定是否重置；重置会清除当前无法读取的数据。</p><div class="button-row"><button id="exportRecovery" type="button">导出故障数据</button><button id="resetRecovery" type="button" class="danger">重置本机数据</button></div>';
  document.querySelector('.topbar').after(recovery);
  $('exportRecovery').addEventListener('click',async()=>{ try { const result = await window.PublicStudio.exportRecovery(); if (result && !result.ok) alert(result.errors?.join('；') || '导出失败，请勿重置数据'); } catch(error) { alert(error.message || '导出失败，请勿重置数据'); } });
  $('resetRecovery').addEventListener('click',async()=>{
    if (!confirm('请先导出并保存故障数据。确定清除当前数据并重新设置？此操作不能撤销。')) return;
    try { const result = await window.PublicStudio.resetRecovery(); if (result.ok) { openedOnce = false; apply(); } }
    catch (error) { alert(error.message || '重置失败'); }
  });
  const scenePreview = document.createElement('div');
  scenePreview.id = 'scenePublicPreview';
  scenePreview.className = 'scene-public-preview';
  $('scene').closest('.field').after(scenePreview);
  function showScene() {
    const scene = window.PublicStudio?.getConfig().scenes.find((s) => s.id === $('scene').value);
    scenePreview.replaceChildren();
    if (!scene) return;
    if (scene.photo) { const img = document.createElement('img'); img.src = scene.photo; img.alt = scene.name; scenePreview.append(img); }
    if (scene.description) { const p = document.createElement('p'); p.textContent = scene.description; scenePreview.append(p); }
  }
  $('scene').addEventListener('change',showScene);
  function apply() {
    if (!window.PublicStudio) return;
    const recovering = typeof window.PublicStudio.getRecovery === 'function' && window.PublicStudio.getRecovery() !== null;
    recovery.hidden = !recovering;
    document.querySelectorAll('.app-shell > *').forEach((el)=>{ if (el !== recovery) el.inert = recovering; });
    $('bookingSubmitBar').inert = recovering;
    $('openStudioConfig').disabled = recovering;
    if (recovering) { if (dialog.open) dialog.close(); recovery.focus(); return; }
    const config = window.PublicStudio.getConfig(), p = config.profile, r = config.rules;
    document.documentElement.dataset.mode = p.mode === 'dark' ? 'dark' : 'light';
    document.documentElement.style.setProperty('--teal', themes[p.theme] || themes.teal);
    $('studioName').textContent = p.name || '摄影棚预约管理';
    $('settingsStudioName').textContent = p.name || '摄影棚预约管理';
    $('studioContact').textContent = [p.phone, p.wechat && `微信 ${p.wechat}`, p.address].filter(Boolean).join(' · ') || '公开版 1.0.1';
    document.querySelectorAll('.brand-logo, .about-version-row img').forEach((img) => { img.src = p.logo || './icon.png'; });
    document.title = `${p.name || '摄影棚预约管理'} · 公开版 1.0.1`;
    $('appVersion').textContent = '公开版 1.0.1';
    $('studioNotice').textContent = p.notice || '暂无工作室公告。';
    $('studioRuleSummary').textContent = `营业时间 ${r.open}–${r.close}；${r.minMinutes} 分钟起约；收尾提醒间隔 ${r.turnaroundMinutes} 分钟；免费改签 ${r.freeChanges} 次，超出后每次 ¥${r.changeFee}。`;
    $('configSummary').textContent = `${config.scenes.filter((s) => s.active).length} 个启用场景 · ${r.open}–${r.close}`;
    showScene();
    document.querySelector('meta[name="theme-color"]').content = p.mode === 'dark' ? '#191d20' : '#f4f5f6';
    if (!config.configured && !openedOnce) open();
  }
  ['publicstudio:config','publicstudio:change'].forEach((name) => window.addEventListener(name,apply));
  apply();
})();
