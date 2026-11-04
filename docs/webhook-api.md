# webhook 契约（v1）

any2wechat 对外只暴露两个 HTTP 端点（入站推送 + 健康探针），另有可选的**出站入站转发**
（见下文 BRIDGE_RELAY_*）。任何能发 HTTP 请求的项目——监控告警、cron 脚本、CI 流水线、
TrendRadar 之类的内容聚合器——都按本契约接入。

## POST /webhook

把一条消息推送到已绑定的个人微信。

**请求体**（三选一）：

| 形式 | 示例 | 说明 |
|---|---|---|
| JSON `{title, content}` | `{"title":"磁盘告警","content":"/ 使用 92%"}` | 推荐形式；标题与正文间空一行 |
| JSON `{title, text}` | `{"title":"deploy","text":"done"}` | `text` 是 `content` 的别名 |
| 纯文本 | `服务器重启完成` | JSON 解析失败时整体作为正文 |

**约束**：请求体上限 2MB；空内容返回 400。
**分批规则**：微信单条文本有长度上限，超过 1800 字符按换行边界自动分批
（多批自动带 `【i/n】` 序号，批间隔 1.2s 串行发送）。

**响应**：

| 码 | 含义 |
|---|---|
| 202 | `{"ok":true,"batches":n}` 已受理，后台发送中 |
| 400 | `{"ok":false,"error":"empty body"}` 空内容 |
| 401 | `{"ok":false,"error":"token mismatch"}` 设置了 `BRIDGE_TOKEN` 但请求未携带 |
| 409 | `{"ok":false,"error":"..."}` 会话未绑定（先完成登录 + 微信里发一条"绑定"） |

**curl 示例**：

```bash
curl -X POST http://127.0.0.1:8788/webhook \
  -H "Content-Type: application/json" \
  -d '{"title":"标题","content":"正文"}'
```

## GET /health

存活探针 + 状态速览。

```json
{
  "ok": true,
  "hasSession": true,      // 是否已绑定
  "listening": true,       // 长轮询是否在跑
  "pausedUntil": null,     // 收到 -14 暂停时的恢复时间
  "stats": { "received": 3, "batches": 5, "failed": 0, "lastAt": "..." }
}
```

## 出站：入站转发（BRIDGE_RELAY_*，可选）

设置 `BRIDGE_RELAY_URL` 后，桥把**扫码者本人**发来的每条消息实时 POST 给宿主回调，
让宿主实现对话式指令/自动化（桥不解析消息语义，保持通用）：

```json
POST <BRIDGE_RELAY_URL>
Content-Type: application/json
Authorization: Bearer <BRIDGE_RELAY_TOKEN>   // 仅在设置该变量时携带

{ "from_user_id": "o9cq80-…@im.wechat", "text": "帮助", "received_at": "2026-11-04T14:21:07.383Z" }
```

**行为约束**：

- 只转发扫码者本人（`credentials.json.user_id`）的消息——P-35 守卫：绑定语义是
  last-message-wins，他人消息一律忽略，杜绝"抢绑定 = 抢配置"
- 按消息到达顺序**串行保序**投递；单次超时 5 秒；**失败只记日志**，绝不影响绑定/保活/发送主链路
- 回复 2xx 视为投递成功；宿主想回复用户，走既有 `POST /webhook`（同机回环）即可，桥零额外接口

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `BRIDGE_PORT` | `8788` | 监听端口 |
| `BRIDGE_HOST` | `127.0.0.1` | 监听地址；Docker 容器内须设 `0.0.0.0` |
| `BRIDGE_TOKEN` | （关闭） | 设置后 /webhook 要求鉴权（`Authorization: Bearer <token>` 或 `?token=`） |
| `BRIDGE_DATA_DIR` | `<仓库>/data` | 凭证/会话数据目录（Docker volume 挂载点） |
| `BRIDGE_RELAY_URL` | （关闭） | 设置后启用入站转发（见上文） |
| `BRIDGE_RELAY_TOKEN` | （关闭） | 入站转发的 Bearer 共享密钥 |

## 安全模型

- 默认只监听 `127.0.0.1`：仅本机进程可推送，不向局域网/公网暴露
- Docker 部署时端口只映射到宿主机回环，或完全不映射（同 compose 网络内互访）
- 跨机/容器间调用可设 `BRIDGE_TOKEN` 开启共享密钥
- 数据目录含微信账号凭证（等同账号钥匙）：勿入库、勿随镜像打包、勿放宽目录权限

## 宿主项目接线

- TrendRadar：见 [`presets/trendradar/`](../presets/trendradar/)
- 其它项目：按本契约 POST 即可；欢迎提交 PR 把你的项目加入 presets/
