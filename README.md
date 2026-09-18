# 夏暮工作室预约管理系统

这是一个从零搭建的「微信原生小程序 + 微信云开发 + Vue Web 后台」项目。首版覆盖用户预约、自动算价、防撞档、管理员订单管理、改签计数和独立电脑后台。

## 目录

- `miniprogram/`：微信原生小程序，包含用户预约页和小程序管理员页。
- `cloudfunctions/bookingApi/`：云函数 API，按 `action` 路由业务能力。
- `web-admin/`：Vite + Vue 3 + TypeScript 独立 Web 后台。
- `tests/`：核心算价和档期规则测试。

## 云开发配置

1. 在微信开发者工具中导入本目录。
2. 修改 `miniprogram/utils/config.js` 中的 `envId`。
3. 修改 `web-admin/.env.example` 为 `.env.local`，填写同一个云开发环境 ID。
4. 上传并部署云函数 `bookingApi`。
5. 在云数据库中创建集合：`scenes`、`bookings`、`holidays`、`admins`。系统会使用 `booking_locks` 记录同场景同日期的并发预约锁，若控制台要求预先建集合，请一并创建。
6. 运行云函数 action `seedDefaults` 初始化场景数据，或手动导入 `cloudfunctions/bookingApi/data/defaultData.js` 里的场景。

## 云函数 actions

- `getScenes`
- `calculateBookingFee`
- `checkBookingConflict`
- `createBooking`
- `adminSearchBookings`
- `adminUpdateBooking`
- `seedDefaults`

管理员类 action 会校验 `admins` 集合中当前 `openid` 是否启用。

## 状态

- `pending`：待确认
- `deposit_paid`：已付订金
- `completed`：已完工
- `cancelled`：已取消

## 本地验证

```bash
npm.cmd test
```

## 给编程小白的 GitHub 上传方法

本项目已经初始化 Git，并准备好了公开上传所需的忽略规则。签名密钥、密码配置、Android SDK、构建缓存和依赖目录不会上传。

安卓 release 构建需要工作室自己的签名密钥。公开仓库提供了 `android-app/android/keystore.properties.example` 示例；复制为 `keystore.properties` 后填写私密信息即可。没有私钥时仍可构建本地测试包，但不要把测试包当作正式发布包。

第一次上传前，在 GitHub 网页上新建一个空仓库，建议仓库名使用 `xiamu-studio-booking`，不要勾选自动创建 README。然后在本项目文件夹打开 PowerShell，依次执行：

```bash
git config --global user.name "你的 GitHub 昵称"
git config --global user.email "你的 GitHub 邮箱"
git commit -m "发布夏暮工作室预约系统 v1.2"
git remote add origin https://github.com/你的用户名/xiamu-studio-booking.git
git push -u origin main
```

执行 `git push` 时，GitHub 可能会打开网页登录授权。上传成功后，刷新 GitHub 仓库页面，就能看到源码、测试、说明书和 v1.2 安装包。不要上传 `夏暮工作室安卓签名密钥备份-请勿发给朋友.zip`，也不要把 `android-app/android/keystore.properties` 加入提交。

如果不想使用命令行，也可以安装 GitHub Desktop，选择 `Add an Existing Repository`，指定本项目文件夹，点击 `Publish repository` 即可。

GitHub Actions 会在提交或合并请求时自动运行测试和 Web 后台构建。

Web 后台：

```bash
cd web-admin
npm.cmd install
npm.cmd run dev
```

## 业务规则

- 2 小时起租。
- 30 分钟为最小预约单位。
- 营业时间 10:00-22:00，区间外加收 30 元/小时。
- 超出场景限人数后，每人加收 50 元。
- 订金 = 该场景在预约日期类型下的 1 小时租金。
- 同场景同日期非取消订单只按实际预约时间防撞档；前后订单相隔不足 15 分钟时返回醒目的紧邻档期提醒。
- 第二次及以后改签提示加收 50 元。
