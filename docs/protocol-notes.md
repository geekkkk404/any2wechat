# iLink bot 协议笔记（公开版）

> 来源：腾讯官方开源 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)（MIT）的
> `src/api/api.ts` 与 `docs/protocol_zh_CN.md`，以及 any2wechat POC 阶段的实机验证结论。
> 本文是公开笔记；实现细节以官方仓库为准。协议接口可能随腾讯侧调整而变化，不承诺永久可用。

## 基础

- Base URL：`https://ilinkai.weixin.qq.com`（登录响应可能下发 IDC 重定向 `baseurl`，需跟随）
- 传输：HTTPS + POST JSON（个别 GET）
- 请求头：
  - `Content-Type: application/json`
  - `AuthorizationType: ilink_bot_token`
  - `Authorization: Bearer <bot_token>`（鉴权接口）
  - `X-WECHAT-UIN: base64(字符串形式的随机 uint32)`
  - `iLink-App-Id: bot`
  - `iLink-App-ClientVersion: 132104`（官方插件 2.4.8 的版本编码值，`0x00MMNNPP` → 十进制）
- `base_info`：随请求携带 `{channel_version: "2.4.8", bot_agent: "<客户端标识>"}`

## 登录（扫码/授权链接）

| 步骤 | 端点 | 要点 |
|---|---|---|
| 取码 | `POST ilink/bot/get_bot_qrcode?bot_type=3`，body `{"local_token_list":[]}` | 返回 `{qrcode, qrcode_img_content}`；`qrcode_img_content` 是 `liteapp.weixin.qq.com/q/...` 授权链接，**手机微信内直接打开即可确认**（不一定需要摄像头扫码） |
| 轮询 | `GET ilink/bot/get_qrcode_status?qrcode=...[&verify_code=...]` | 长轮询 35s；状态机见下 |

状态机：`wait` → `scaned` →（可能 `need_verifycode` 数字配对码）→ `confirmed`；
分支：`expired`（刷新重取）、`verify_code_blocked`（配对码多次错）、`scaned_but_redirect`（IDC 重定向，跟 `redirect_host`）、`binded_redirect`（已绑定过）。

`confirmed` 返回：`bot_token`（凭证）+ `ilink_bot_id` + `ilink_user_id`（**扫码者即推送目标**）+ 可选 `baseurl`。

## 发送 `POST ilink/bot/sendmessage`

```json
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "<ilink_user_id>",
    "client_id": "<客户端生成、幂等用>",
    "message_type": 2,
    "message_state": 2,
    "item_list": [{ "type": 1, "text_item": { "text": "..." } }],
    "context_token": "<见下节，必须回传>"
  },
  "base_info": { "channel_version": "2.4.8", "bot_agent": "..." }
}
```

`ret !== 0` 即失败（POC 实测：`ret=-2 prepare failed` = 缺 `context_token`）。

## 收取 `POST ilink/bot/getupdates`

- body：`{get_updates_buf: <游标>, base_info}`；响应带新游标 `resp.get_updates_buf`，下轮回传
- 长轮询约 35s，超时无消息属正常
- `resp.msgs[]` 每条携带 `from_user_id` + `context_token`

## 关键机制：context_token（POC 最重要的发现）

**`context_token` 由每条下行消息下发，发送时必须原样回传**（官方代码注释 "must be echoed verbatim"）。
推论：

1. **纯"发射喇叭"形态在协议层不存在**——不收只发的 bot 发不出去
2. 产品必须是 **listen 常驻长轮询 + 发送服务** 的双任务结构：listen 不断抓新令牌落盘，发送侧每批读最新令牌
3. `ret/errcode === -14`：服务端要求会话暂停（实测语义约 1 小时），进程应暂停轮询到点恢复，而非退出

## 上线通知 `POST ilink/bot/msg/notifystart`

body 仅 `base_info`。官方 channel 启动时调用；POC 阶段未隔离验证其是否为发送硬需求，保守保留调用。

## 免责声明

any2wechat 与腾讯公司无任何关联，未获其背书或赞助。"微信 / WeChat" 为腾讯商标，此处仅作描述消息去向之用途。
使用本协议层请遵守微信相关条款；iLink 为较新接口，腾讯可随时调整。
