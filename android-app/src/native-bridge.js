import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

async function exportBackup(filename, content) {
  const result = await Filesystem.writeFile({
    path: `backups/${filename}`,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true
  });

  await Share.share({
    title: '夏暮工作室预约备份',
    text: '请选择保存到文件、微信文件传输助手或其他安全位置。',
    url: result.uri,
    dialogTitle: '保存或发送预约备份'
  });

  return true;
}

function exitApp() {
  return App.exitApp();
}

if (Capacitor.isNativePlatform()) {
  App.addListener('backButton', ({ canGoBack }) => {
    window.dispatchEvent(new CustomEvent('xiamu:native-back', { detail: { canGoBack } }));
  });
}

window.XiamuNative = {
  isNative: Capacitor.isNativePlatform(),
  exportBackup,
  exitApp
};
