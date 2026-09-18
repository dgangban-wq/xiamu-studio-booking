const { envId } = require('./utils/config');

App({
  globalData: {
    envId
  },
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: envId,
        traceUser: true
      });
    }
  }
});
