# any2wechat

> 任意项目，一条 HTTP 请求，直达个人微信。

any2wechat 是一座独立开源的推送桥：任何能发 HTTP 请求的项目——热点雷达、监控告警、
cron 脚本、CI 流水线——都可通过一个 webhook 端点，把消息送达你的个人微信。

协议层基于腾讯官方 iLink bot 接口构建（实现参考 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)，MIT License），
扫码授权，单收件人设计。

## ⚠️ 免责声明 / Disclaimer

any2wechat 是独立开源项目，与腾讯公司无任何关联，亦未获其背书或赞助。
"微信 / WeChat" 为腾讯商标，此处仅作描述消息去向之用途。

any2wechat is an independent open-source project, NOT affiliated with,
endorsed by, or sponsored by Tencent. "WeChat" is a trademark of Tencent
Inc., used here solely to identify the intended destination of messages.

## 状态

✅ v0.4.7（2026-11-08）：协议层实机验证通过（扫码登录 / 长轮询收取 / 发送 / 会话令牌机制）。
文本推送（超长自动分批）、图片推送（`images`，base64 PNG ≤4 张/批）、二维码图片消息（`qr_content`）、
入站转发（把你在微信里发的消息回调给宿主项目，带失败短重试）、终端扫码登录（CJK 全角字体终端可扫）。

## 快速开始（本机裸跑）

要求 Node ≥ 22.13。运行时唯一依赖 `qrcode`（终端二维码渲染与 `qr_content` 发码用）：

```bash
npm install                     # 0. 安装依赖；不装也能跑——登录退化为纯链接，qr_content 消息不可用
node bin/login.mjs              # 1. 登录：终端出可扫二维码，手机微信扫码确认（扫不出可把链接发到手机打开）
node src/main.mjs               # 2. 启动守护进程（长轮询 + webhook 服务，默认 127.0.0.1:8788）
node bin/send-test.mjs "你好"    # 3. 手工发一条测试消息
# 4. 在微信里给 bot 发一句"绑定"完成绑定，之后任意项目即可推送：
curl -X POST http://127.0.0.1:8788/webhook -H "Content-Type: application/json" \
     -d '{"title":"标题","content":"正文"}'
# 发图（可选）：images 接受 base64 PNG 数组，≤4 张/批、单张 ≤5MB，非法字节该张跳过不影响其它媒体
curl -X POST http://127.0.0.1:8788/webhook -H "Content-Type: application/json" \
     -d '{"title":"日报配图","images":["<base64 PNG>"]}'
```

完整契约（`qr_content`、入站转发、环境变量表、安全模型）见 [docs/webhook-api.md](docs/webhook-api.md)；Docker 部署见 [docker/](docker/)；
TrendRadar 接线见 [presets/trendradar/](presets/trendradar/)。

## License

[MIT](LICENSE)

协议实现参考了 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)
（MIT License），特此声明并保留其版权。
