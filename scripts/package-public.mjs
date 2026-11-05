import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'public-app');
const distribution = resolve(root, 'public-distribution');
const bundle = resolve(distribution, '摄影棚预约管理-公开版1.0.2');
const web = resolve(bundle, '电脑版文件');
const files = ['index.html','app.js','config.js','config-ui.js','styles.css','lucide.min.js','contact.js','author-contact.png',
  'icon.png','manifest.webmanifest','sw.js','one-page-guide.svg','使用说明.html','一图流.html'];
const apkName = '摄影棚预约管理-v1.0.2.apk';
// Resolve all required inputs before creating the distributable bundle.
const apk = await readFile(resolve(distribution, apkName));
const assets = await Promise.all(files.map(async name => ({ name, content:await readFile(resolve(source,name)) })));
await mkdir(web,{recursive:true});
for (const {name,content} of assets) await writeFile(resolve(web,name),content);
await copyFile(resolve(distribution,apkName), resolve(bundle,'安卓手机安装-摄影棚预约管理.apk'));
for (const name of ['使用说明.html','一图流.html','one-page-guide.svg']) {
  let content = await readFile(resolve(source,name),'utf8');
  if (name==='使用说明.html') content=content.replace('href="./index.html"','href="./电脑版文件/index.html"');
  await writeFile(resolve(bundle,name),content);
}
await writeFile(resolve(bundle,'电脑双击打开.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=./电脑版文件/index.html"><title>摄影棚预约管理</title></head><body><a href="./电脑版文件/index.html">打开摄影棚预约管理</a></body></html>`);
await writeFile(resolve(bundle,'先读我-安装与数据说明.txt'),`摄影棚预约管理 · 公开版 1.0.2

安卓手机：打开“安卓手机安装-摄影棚预约管理.apk”。
电脑：完整解压后双击“电脑双击打开.html”。不要单独移动电脑版文件夹内的文件。
说明书：双击“使用说明.html”。
快速介绍：双击“一图流.html”。

首次启动填写工作室资料，添加置景和价格，检查预约规则后保存。
应用内名称和Logo可以修改；手机桌面名称和图标是统一的公开版标识。
可通过应用内“联系作者”入口查看作者二维码。
本版与夏暮专用版可以同时安装，各自独立保存数据。
导入夏暮专用版导出的JSON备份可以迁移原有订单。先备份再操作。

本软件离线运行，不需要账号和服务器，不会自动同步手机与电脑。
正常退出或重启通常不丢数据；卸载、清除数据和设备损坏可能导致丢失。
每天营业结束后，请导出备份并另存到应用之外。
正式更新请使用同一签名的安装包覆盖安装，勿先卸载旧版。

本包不含客户数据或安卓签名私钥，可转发给需要使用的朋友。
Android 最低版本以安装包要求为准。当前工程要求 Android 7.0 及以上。
本次完成自动化和浏览器测试；不同手机的文件保存、安装及返回手势仍需实际试用确认。
`);
const hashes=[];
for (const name of ['安卓手机安装-摄影棚预约管理.apk','使用说明.html','一图流.html',...files.map(f=>'电脑版文件/'+f)]) {
  hashes.push(`${createHash('sha256').update(await readFile(resolve(bundle,name))).digest('hex')}  ${name}`);
}
await writeFile(resolve(bundle,'文件校验-SHA256.txt'),hashes.join('\n')+'\n');
console.log(bundle);
