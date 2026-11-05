const { createServer } = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const dependencyRoot = process.env.STUDIO_TEST_MODULES || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(require.resolve('playwright', { paths: [dependencyRoot, process.cwd()] }));
const root = path.resolve(__dirname, '../public-app');
const output = path.resolve(__dirname, '../public-distribution/validation');
const mime = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };

async function main() {
  await fs.mkdir(output, { recursive: true });
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ headless:true, ...(process.env.STUDIO_BROWSER_CHANNEL === 'chromium' ? {} : {channel:process.env.STUDIO_BROWSER_CHANNEL || 'msedge'}) });
    for (const viewport of [{width:390,height:844},{width:1280,height:900},{width:320,height:740}]) {
      const context = await browser.newContext({ viewport, acceptDownloads:true });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion:'reduce' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', async dialog => { await dialog.accept(); });
      assert.equal((await page.goto(url)).status(), 200);
      await page.waitForFunction(() => !!window.PublicStudio);
      await page.screenshot({ path:path.join(output, `setup-${viewport.width}.png`), fullPage:true });
      await page.locator('#cfg-profile-name').fill('晴日摄影工作室');
      await page.locator('input[data-image="logo"]').setInputFiles(path.join(root, 'icon.png'));
      await page.waitForFunction(() => !document.getElementById('configDirty').textContent.includes('处理中'));
      await page.locator('#configNext').click();
      await page.locator('#configAddScene').click();
      await page.locator('#cfg-scene-0-name').fill('自然光窗景');
      await page.locator('#cfg-scene-0-weekdayRate').fill('120');
      await page.locator('#cfg-scene-0-weekendRate').fill('150');
      await page.locator('#cfg-scene-0-holidayRate').fill('180');
      await page.locator('#cfg-scene-0-capacity').fill('4');
      await page.locator('#configNext').click();
      await page.locator('#configSave').click();
      await page.waitForFunction(() => !document.getElementById('studioConfigDialog').open);
      assert.equal(await page.evaluate(() => window.PublicStudio.getConfig().profile.name), '晴日摄影工作室');
      const configResult = await page.evaluate(async () => {
        const config = window.PublicStudio.getDefaultConfig();
        config.configured = true;
        config.profile.name = '晴日摄影工作室';
        config.scenes = [
          {id:'daylight',name:'自然光窗景',weekdayRate:120,weekendRate:150,holidayRate:180,capacity:4,active:true,group:'A 棚',photo:'',description:'窗边自然光'},
          {id:'white',name:'白墙置景',weekdayRate:100,weekendRate:130,holidayRate:160,capacity:6,active:true,group:'A 棚',photo:'',description:''}
        ];
        return window.PublicStudio.saveConfig(config);
      });
      assert.equal(configResult.ok, true, JSON.stringify(configResult));
      await page.reload();
      await page.waitForFunction(() => !!window.PublicStudio);
      assert.deepEqual(await page.locator('img:visible').evaluateAll(imgs => imgs.filter(img => !img.complete || img.naturalWidth === 0).map(img => img.src)), [], 'broken images');
      await page.locator('#newBooking').click();
      await page.locator('#quickBooking').click();
      await page.locator('#scene').selectOption('daylight');
      await page.locator('#date').fill('2026-11-06');
      await page.locator('#start').fill('10:00');
      await page.locator('#end').fill('12:00');
      await page.locator('#people').fill('2');
      await page.locator('#customer').fill('测试客户');
      await page.locator('#phone').fill('13800000000');
      await page.locator('#wechat').fill('test-studio');
      await page.screenshot({ path:path.join(output, `booking-${viewport.width}.png`), fullPage:true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(overflow, false, `horizontal overflow at ${viewport.width}`);
      await page.locator('#bookingForm').evaluate(form => form.requestSubmit());
      await page.waitForFunction(() => document.getElementById('saveSuccessDialog').open);
      await page.locator('#continueBooking').click();
      // A different set in the same physical room must not accept an overlap.
      await page.locator('#scene').selectOption('white');
      await page.locator('#start').fill('11:00');
      await page.locator('#end').fill('13:00');
      await page.locator('#bookingForm').evaluate(form => form.requestSubmit());
      assert.equal(await page.evaluate(() => window.PublicStudio.exportBackup().bookings.length), 1);
      await page.reload();
      await page.locator('[data-tab="orders"]').click();
      await page.waitForFunction(() => document.body.textContent.includes('测试客户'));
      await page.screenshot({ path:path.join(output, `orders-${viewport.width}.png`), fullPage:true });
      await page.locator('[data-tab="calendar"]').click();
      await page.locator('#calendarDate').fill('2026-11-06');
      await page.locator('#calendarDate').dispatchEvent('change');
      await page.screenshot({ path:path.join(output, `calendar-${viewport.width}.png`), fullPage:true });
      await page.locator('#calendarWeekView').click();
      assert.equal(await page.locator('.calendar-day').count(),7);
      await page.locator('#calendarDayView').click();
      await page.locator('.free-slot').first().click();
      await page.locator('#guidedBooking').click();
      assert.equal(await page.locator('#start').inputValue(),'12:00');
      assert.equal(await page.locator('#customer').isVisible(),false);
      await page.locator('#bookingNext').click();
      assert.equal(await page.locator('#customer').isVisible(),true);
      await page.locator('#bookingNext').click();
      assert.ok((await page.locator('#bookingStepError').innerText()).includes('客户'));
      await page.locator('#customer').fill('分步客户');
      await page.locator('#phone').fill('13900000000');
      await page.locator('#wechat').fill('guided');
      await page.locator('#bookingNext').click();
      assert.equal(await page.locator('#quoteStep').isVisible(),true);
      await page.screenshot({path:path.join(output,`wizard-${viewport.width}.png`),fullPage:true});
      await page.locator('#bookingForm').evaluate(form=>form.requestSubmit());
      await page.waitForFunction(()=>document.getElementById('saveSuccessDialog').open);
      await page.locator('#continueBooking').click();
      await page.locator('#closeBooking').click();
      assert.equal(await page.evaluate(()=>window.PublicStudio.exportBackup().bookings.length),2);
      await page.screenshot({path:path.join(output,`workbench-${viewport.width}.png`),fullPage:true});
      await page.evaluate(()=>window.PublicConfirmation.open(window.PublicStudio.exportBackup().bookings[0].id));
      await page.locator('#confirmationPreview').waitFor({state:'visible'});
      await page.locator('#confirmationPreview').evaluate(img=>img.decode());
      assert.equal(await page.locator('#confirmationPrivate').isChecked(),false);
      const pixels=await page.locator('#confirmationPreview').evaluate(img=>{const c=document.createElement('canvas');c.width=100;c.height=100;const x=c.getContext('2d');x.drawImage(img,0,0,100,100);return [...x.getImageData(0,0,100,100).data].filter(v=>v<200).length;});
      assert.ok(pixels>100,'confirmation image must not be blank');
      const imageDownload=page.waitForEvent('download');await page.locator('#downloadConfirmation').click();
      const imageFile=await imageDownload;
      assert.equal((await fs.readFile(await imageFile.path())).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      await page.screenshot({path:path.join(output,`confirmation-${viewport.width}.png`),fullPage:true});
      await page.locator('#closeConfirmation').click();
      await page.locator('[data-tab="income"]').click();
      await page.locator('#addIncome').click();
      await page.locator('#incomeAmount').fill('120');
      await page.locator('#incomePaymentMethod').selectOption('微信');
      await page.locator('#incomeNote').fill('订金测试');
      await page.locator('#incomeForm').evaluate(form => form.requestSubmit());
      await page.waitForFunction(() => !document.getElementById('incomeDialog').open);
      assert.equal(await page.evaluate(() => window.PublicStudio.exportBackup().incomes[0].amount), 120);
      await page.locator('[data-tab="settings"]').click();
      const downloading = page.waitForEvent('download');
      await page.locator('#exportData').click();
      const download = await downloading;
      const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
      assert.equal(exported.bookings.length, 2);
      assert.equal(exported.incomes.length, 1);
      const finance=await page.evaluate(async()=>{
        const record=window.PublicStudio.exportBackup().incomes[0];
        const refund=await window.PublicStudio.createRefund(record.id,{amount:20,date:record.date,reason:'部分退款测试'});
        const summary=window.PublicStudio.financeSummary();
        const invalid=await window.PublicStudio.createRefund(record.id,{amount:101,date:record.date,reason:'超额'});
        const voided=await window.PublicStudio.voidIncome(refund.income.id,'误记退款');
        window.PublicStudio.refresh();return {ok:refund.ok,summary,invalid:invalid.ok,voided:voided.ok};
      });
      assert.deepEqual(finance,{ok:true,summary:{gross:120,refunded:20,net:100},invalid:false,voided:true});
      assert.equal(exported.config.profile.name, '晴日摄影工作室');
      await page.locator('#openStudioConfig').click();
      await page.locator('#cfg-profile-mode').check();
      await page.locator('[data-config-step="1"]').click();
      await page.locator('#cfg-scene-0-weekdayRate').fill('999');
      await page.locator('[data-config-step="2"]').click();
      await page.locator('#configSave').click();
      await page.waitForFunction(() => !document.getElementById('studioConfigDialog').open);
      await page.reload();
      assert.equal(await page.evaluate(() => window.PublicStudio.exportBackup().bookings[0].total_fee), 240);
      assert.equal(await page.locator('html').getAttribute('data-mode'), 'dark');
      await page.locator('[data-tab="settings"]').click();
      await page.screenshot({ path:path.join(output, `settings-${viewport.width}.png`), fullPage:true });
      await page.locator('#openGuideViewer').click();
      await page.locator('#guideViewerImage').evaluate(img => img.decode());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'guide overflow');
      await page.screenshot({ path:path.join(output, `guide-${viewport.width}.png`), fullPage:true });
      await page.locator('#closeGuideViewer').click();
      await page.getByRole('button', {name:'复制抖音账号', exact:true}).click();
      await page.waitForFunction(() => document.getElementById('authorCopyStatus').textContent.length > 0);
      assert.match(await page.locator('#authorCopyStatus').innerText(), /已复制：ump45大钢板（求推荐版）/);
      await page.locator('#openAuthorContact').click();
      await page.locator('#authorPoster').evaluate(img => img.decode());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'contact overflow');
      assert.equal(await page.locator('#authorPoster').evaluate(img=>img.naturalWidth>1000), true);
      await page.screenshot({path:path.join(output,`contact-${viewport.width}.png`),fullPage:false});
      await page.locator('#zoomAuthorContact').click();
      await page.waitForFunction(() => document.getElementById('zoomAuthorContact').disabled);
      await page.waitForFunction(() => {const p=document.getElementById('authorPosterPane');return p.scrollWidth>p.clientWidth;});
      assert.equal(await page.locator('#authorPosterPane').evaluate(p=>p.scrollWidth>p.clientWidth), true);
      await page.locator('#resetAuthorContact').click();
      await page.waitForFunction(() => {const p=document.getElementById('authorPosterPane');return p.scrollWidth<=p.clientWidth+1;});
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('xiamu:native-back')));
      assert.equal(await page.locator('#authorContactDialog').evaluate(d=>d.open), false, 'native back closes author dialog');
      assert.deepEqual(errors, [], 'browser errors');
      for (const doc of ['使用说明.html','一图流.html']) {
        assert.equal((await page.goto(`${url}/${encodeURIComponent(doc)}`)).status(), 200, doc);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${doc} overflow`);
      }
      if (viewport.width === 390) {
        await page.goto(url);
        await page.evaluate(() => {
          localStorage.setItem('xiamu-offline-booking-v1', 'original-data-sentinel');
          localStorage.setItem('public-studio-data-v1', '{broken');
        });
        await page.reload();
        await page.locator('#configRecovery').waitFor({state:'visible'});
        const recoveryDownload = page.waitForEvent('download');
        await page.locator('#exportRecovery').click();
        const recovered = await recoveryDownload;
        assert.equal(await fs.readFile(await recovered.path(),'utf8'), '{broken');
        await page.locator('#resetRecovery').click();
        await page.locator('#studioConfigDialog').waitFor({state:'visible'});
        assert.equal(await page.evaluate(() => localStorage.getItem('xiamu-offline-booking-v1')), 'original-data-sentinel');
        assert.deepEqual(errors, [], 'recovery browser errors');
      }
      results.push({ viewport, errors, bookingPersistsAfterReload:true, docsFit:true });
      await context.close();
    }
    const localContext = await browser.newContext();
    const localPage = await localContext.newPage();
    const localErrors=[];
    localPage.on('pageerror',e=>localErrors.push(e.message));
    await localPage.goto(require('node:url').pathToFileURL(path.join(root,'index.html')).href);
    await localPage.locator('#studioConfigDialog').waitFor({state:'visible'});
    assert.deepEqual(localErrors, [], 'double-click file startup');
    await localContext.close();
    console.log(JSON.stringify(results, null, 2));
    await fs.writeFile(path.join(output, 'browser-report.json'), JSON.stringify(results,null,2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(e => { console.error(e); process.exitCode=1; });
