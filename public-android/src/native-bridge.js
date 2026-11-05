import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

async function exportBackup(filename, content) {
  if (!/^[^/\\\x00-\x1f]+\.json$/i.test(filename) || filename.includes('..')) {
    throw new Error('Invalid backup filename');
  }
  const result = await Filesystem.writeFile({
    path: `backups/${filename}`, data: content, directory: Directory.Cache,
    encoding: Encoding.UTF8, recursive: true
  });
  await Share.share({
    title: '摄影棚预约管理备份', text: '请选择安全位置保存备份。',
    url: result.uri, dialogTitle: '保存或发送预约备份'
  });
  return true;
}
if (Capacitor.isNativePlatform()) {
  App.addListener('backButton', ({ canGoBack }) => {
    window.dispatchEvent(new CustomEvent('xiamu:native-back', { detail: { canGoBack } }));
  });
}
// Keep the API name compatible with the shared web application.
window.XiamuNative = {
  isNative: Capacitor.isNativePlatform(), exportBackup, exitApp: () => App.exitApp()
};
