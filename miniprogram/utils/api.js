function callBookingApi(data) {
  return wx.cloud.callFunction({
    name: 'bookingApi',
    data
  }).then((res) => res.result);
}

module.exports = {
  callBookingApi
};
