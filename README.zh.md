# dsh-a2a-client

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![A2A 1.0](https://img.shields.io/badge/protocol-A2A%201.0-4C6EF5.svg)](https://a2a-protocol.org)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

[English](https://github.com/ilyshkafox/dsh-a2a-client/blob/main/README.md) | [Русский](https://github.com/ilyshkafox/dsh-a2a-client/blob/main/README.ru.md) | **中文**

DeepSeek Harness 的 [Agent2Agent (A2A) 1.0](https://a2a-protocol.org) 客户端。
它把远程智能体接入模型，并提供 **A2A** 面板：无需编辑文件即可添加、检查和删除
智能体。

模型获得三个工具——查看智能体卡片、发送消息、处理任务；你获得侧边栏面板。
没有任何依赖，只用内置的 `fetch` 和 `node:crypto`。

传输为基于 HTTP 的 JSON-RPC 2.0，带 `a2a-version: 1.0` 头和可选的
`authorization: Bearer`；方法有 `SendMessage`、`SendStreamingMessage`（SSE）、
`GetTask`、`CancelTask`、`ListTasks`。智能体卡片缓存 30 秒。

## 安装

包名是 `dsh-a2a-client`。安装会同时启用 bundle：`dsh plugin add` 会添加 profile
依赖以及 `dsh.profile.bundles` 中的条目。

### web profile

```sh
dsh plugin --profile web add dsh-a2a-client                      # 从 npm
dsh plugin --profile web add github:ilyshkafox/dsh-a2a-client    # 从 git
```

重启 DSH：侧边栏出现 **A2A** 面板，聊天中出现对应工具。

### 桌面版

桌面版管理自己的 profile：先启动应用一次以创建 profile，退出应用，再运行随应用
附带的 `dsh` 命令——profile 锁和已加载的 bundle 都属于正在运行的应用。

```sh
dsh plugin --profile desktop add dsh-a2a-client
```

然后重新启动应用。单独从 npm 安装的 `dsh` 不接受 `desktop` profile：只有应用
自带的命令才能管理它。

### 「插件」面板

**插件** → 安装，目标为 `dsh-a2a-client`（npm）或
`github:ilyshkafox/dsh-a2a-client`（git）。面板会检查仓库与 DSH 版本、显示进度，
并说明是否需要重启。

### 手动安装

在 profile 的 `package.json`（`~/.dsh/profiles/web/package.json`）中加入两项，
然后执行 `pnpm install`：

```json
{
  "dependencies": { "dsh-a2a-client": "github:ilyshkafox/dsh-a2a-client" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-a2a-client"] } }
}
```

本地目录使用 `"dsh-a2a-client": "link:/dsh-a2a-client/的/绝对路径"`。

### 第一个智能体

打开 **A2A** → **添加智能体**，填写名称、AgentCard 地址，需要时再填令牌。卡片会
立即读取，因此地址或令牌有误时不会保存。

固定在完整 40 位提交上的 git 安装可用面板的**更新**按钮升级；分支或标签需要
重新安装。

## 配置

智能体存放在 profile 的注册表 `a2a-client.json` 中，由面板维护。文件尚未存在
时，智能体来自插件的 `config`：

```yaml
config:
  defaultAgent: my-agent        # a2a_send 与 a2a_task 默认使用的智能体
  tokenEnv: A2A_AUTH_TOKEN      # 共享的密钥引用（可选）
  timeoutMs: 180000             # 一次 HTTP 调用
  agents:
    - name: my-agent
      cardUrl: https://agent.example.com/.well-known/agent-card.json
      tokenEnv: A2A_TOKEN_MY_AGENT
      timeoutMs: 120000
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `name` | — | 工具使用的智能体名称：最多 64 个字符，允许字母、数字、空格、`_`、`.`、`-` |
| `cardUrl` | — | AgentCard 的绝对 `http://` 或 `https://` 地址 |
| `tokenEnv` | `A2A_TOKEN_<名称>` | 密钥引用：环境变量或 DSH 凭据存储中的条目 |
| `token` | 空 | 直接写在配置里的令牌；优先级低于凭据存储和环境变量 |
| `timeoutMs` | `180000` | 对该智能体一次 HTTP 调用的超时 |
| `enabled` | `true` | 停用的智能体仍会列出，但不再探测 |
| `allowCrossOriginToken` | `false` | 允许把令牌发往与卡片不同 origin 的 JSON-RPC endpoint |

### 令牌

每个智能体有自己的密钥。引用名由智能体名称推导：`A2A_TOKEN_<名称>`，转为大写，
并把拉丁字母和数字以外的字符替换为 `_`——`prod agent` 得到
`A2A_TOKEN_PROD_AGENT`。

在面板中输入的令牌保存到 **DSH 凭据存储**（`ctx.credentials`，
`~/.dsh/.credentials.yaml`），而不是 `a2a-client.json`。查找顺序：

1. DSH 凭据存储——面板保存的值。
2. 进程环境变量和 `.env`。
3. 配置或 `a2a-client.json` 中的 `token` 字段——只读，用于迁移前写入的记录。

## 工具

| 工具 | 参数 | 用途 |
| --- | --- | --- |
| `a2a_agents` | `agent?`、`refresh?` | 列出智能体：名称、卡片、技能、接口 |
| `a2a_send` | `text`（必填）、`agent?`、`contextId?`、`stream?`、`timeoutSec?` | 发送消息并返回最终答复 |
| `a2a_task` | `action`（必填：`get`、`cancel`、`list`）、`taskId?`、`agent?`、`contextId?` | 读取、取消或列出任务 |

`a2a_send` 通过 `contextId` 延续对话：它随答复返回，并按「会话 + 智能体」记忆，
因此下一次调用无需手动传上下文。

## 面板

侧边栏的 **A2A** 以卡片形式列出智能体：名称、连接状态、卡片描述和地址。智能体
弹窗显示元数据、卡片本身、技能列表和测试消息；旁边是添加、编辑和删除。

智能体分两级：profile 全局的，以及工作区本地的
（`<workspace>/.dsh/a2a-client.json`）。面板的修改立即保存，重启后仍然有效。
面板语言跟随 DSH——俄语、英语或中文，在**设置 → 通用 → 语言**中切换，无需重启。

## 安全

- 面板路由 `/a2a-client/api` 由 DSH 自带的 `ctx.connection.requestRejection`
  保护：Host 与 Origin 校验（抵御 DNS rebinding）以及浏览器会话认证。
- loopback 名称只接受 `127/8` 字面量、`localhost` 或 `::1`；`127.evil.com`
  这类名称会被拒绝。
- 令牌不会发往与卡片不同的 origin，也不会通过明文 `http://` 发往远程主机；
  修改 `cardUrl` 后需要重新提供令牌。
- 卡片只跟随同源重定向；JSON-RPC POST 不跟随任何重定向。
- 卡片、JSON-RPC 与 SSE 响应分别限制为 1 / 4 / 8 MB。
- 智能体输出被包在 `--- 外部 A2A 数据 ---` 边界内：它是数据，不是指令。请按
  不可信文本对待。

## 开发

没有依赖，也不需要构建。修改 `client.js` 后刷新页面生效，修改 `index.js` 后
重启 DSH 生效。

```sh
npm test        # locale 与 security 两套测试
npm run check   # 两半部分的语法检查
npm publish     # 先执行 check 和 test（prepublishOnly）
```

`package.json` 的 `files` 就是 npm 包的全部内容：`index.js`、`client.js`、
`cordis.patch.yml`、`locale/*.json`、`icon.svg`，以及 npm 自动加入的 README 与
许可证。新增运行时文件时，要同时加入 `files` 和 `exports`。

## 许可证

[MIT](LICENSE)
