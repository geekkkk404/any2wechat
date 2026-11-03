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

🚧 初期开发中。协议层已完成实机验证（扫码登录 / 长轮询收取 / 发送 / 会话令牌机制），
产品化整合进行中。安装与使用文档将在首个可用版本发布时提供。

## License

[MIT](LICENSE)

协议实现参考了 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)
（MIT License），特此声明并保留其版权。
