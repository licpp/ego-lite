# ego-lite 操作可靠性与 token 优化方案

## 目标与本轮范围

最近招聘表单操作的主要成本并非输入文字，而是反复确认：点击是否触发请求、保存为什么失败、附件是否真正关联、页面异步重置后是否仍是同一个输入框。先提供可靠且紧凑的网络证据，再在上面构建站点适配。

本轮实现 **被动请求响应关联**，不是实现所有站点的自动保存成功判定器。通过原有 Page 操作触发一次动作，监听实际产生的请求；不重发、不拦截改写、不通过内部接口代替界面操作。

| 优化项 | 状态 | 实现/边界 |
| --- | --- | --- |
| 按需指南、限长/增量快照、本地快照搜索 | 前序分支已实现 | 沿用已有功能 |
| 可复用日期填写 | 前序分支部分实现 | 已有原生/可编辑与部分中文 UI 日期；Ant Design、jQuery UI 适配另列后续 |
| 动作与响应关联 | 本轮实现 | `actAndWaitForResponse` 与 `actAndWaitForResponses` |
| 响应输出限长、选 JSON 字段、本地保存完整正文 | 本轮实现 | 默认正文预算 4000 字符，不重复输出原文和解析值 |
| 上传与记录保存两步验证 | 本轮提供基础 | 同时观察两个响应，调用方比较上传 ID 与记录关联 ID |
| 通用业务成功判定 | 后续站点适配 | `code:0`、`success:true` 等没有跨站统一含义 |
| DOM toast/校验错误统一观察器 | 后续 | 无匹配请求也可能是前端校验拦截，仍需局部 DOM 观察 |
| 选择器可见性筛选、导航/关闭完成等待、动态控件稳定等待 | 后续 | 不混入本轮网络层，避免扩大回归面 |

## API

```js
const { response } = await page.actAndWaitForResponse({
  action: () => page.click('#save'),
  match: { urlIncludes: '/resume/save', method: 'POST' },
  bodyFields: ['code', 'message', 'data.id'],
  maxChars: 2000,
  timeout: 10000,
});
console.log(response);
```

`match` 至少包含 `urlIncludes` 或 `urlExact`；可叠加 `method`、CDP `resourceType`、`postDataIncludes`。请求正文仅用于匹配，不出现在结果中。HTTP 方法匹配不区分大小写，其余字符串精确/字面匹配，不执行正则或表达式。

多个请求按 `matches` 顺序返回，每个匹配器选择动作窗口内第一个匹配请求。同一个请求可满足重叠匹配器；若要求不同请求，使用互斥的 URL/方法/正文条件。

```js
const { responses: [upload, save] } = await page.actAndWaitForResponses({
  action: () => page.setInputFiles('#certificate', ['/absolute/certificate.pdf']),
  matches: [
    { urlIncludes: '/upload', method: 'POST' },
    { urlIncludes: '/resume/save', method: 'POST' },
  ],
  bodyFields: ['code', 'data.attachmentId'],
});
// 若上传与保存是两个独立按钮，分别调用单响应 API；两次都检查业务结果及关联 ID。
```

本例仅适用于文件选择会自动触发上传和保存的页面。若页面只上传而不保存，等待第二个请求会超时；框架不会替用户点击另一个按钮。

## 结果语义

- `actionResult`：原动作返回值，不改变已有 click/setInputFiles 回执。
- `response.state`：`finished` 或 `failed`，仅表示网络生命周期。
- `httpStatus/httpOk`：HTTP 状态及是否为 2xx，绝不推断业务成功。
- `body.kind`：`json/text/binary/omitted/unavailable`。
- 完整且在预算内的 JSON 返回 `body.json`；超过预算仅返回 `body.text` 片段，并标记 `truncated:true`，片段可能不是合法 JSON。
- `bodyFields` 是最多 32 个自有属性的点路径，只提取实际存在的字段。缺失不代表业务成功或失败。
- `includeBody:false` 不读取正文。二进制不把 base64 塞入上下文。
- `saveBodyAs` 仅用于单响应，保存完整原始正文（base64 解码）；要求新建绝对路径、父目录存在，权限 0600，不覆盖已有文件。正文可能含个人信息，请按任务需要保存。
- `maxChars` 限制正文，不限制整个结果的结构开销。默认 4000，上限 100000。大于 200 万字符的正文不做 JSON 解析，返回限长文本；原始正文仍可写入指定本地文件。

## 可靠性设计

1. 在原有 native gate 和控制检查下发现 Page/子 frame 会话并启用 Network。
2. 订阅事件，然后紧贴动作前打开匹配窗口，动作只调用一次。
3. 只接收该 Page 树事件，使用 sessionId + requestId 避免跨 iframe ID 碰撞，不消费 `page.events()` 的队列。
4. 先观察请求，再接收响应，等 `loadingFinished` 后读取正文。早于动作开始的请求不纳入。
5. 重定向沿同一请求继续观察，返回最终响应和已观察的重定向链。`loadingFailed` 单独返回失败证据。
6. 错误、完成和超时均解除订阅。动作抛错不重试；用户控制/任务结束错误原样传播。
7. 超时抛出 `EGO_RESPONSE_TIMEOUT`，带按匹配器排序的 `partialResponses`。**超时不意味着提交未生效，不能据此自动再次保存。**
8. CDP 正文被回收、下载响应不可读等情况返回 `unavailable`。若取消发生在正文等待期间，不再启动本地文件写入。

匹配属于时间窗口加条件相关性，并不证明请求一定由该点击因果触发。相同接口后台轮询可能干扰；应尽量指定方法及业务标识，必要时结合界面确认。独立 worker、新弹出页面不属于当前 Page frame 树；流式或尚未完成正文消费的响应可能超时，框架不会主动消费网页自己的流来改变页面行为。框架不解析站点加密响应，也不自动确认招聘承诺等用户决策。

## 验收与后续

单元测试覆盖匹配、旧请求排除、业务错误保留、多请求顺序、frame session 隔离、重定向、网络失败、超时部分结果、正文限长/字段选择、文件独占创建、取消及控制错误。浏览器 E2E 使用本地表单验证真实点击、文件上传、附件关联、响应落盘和事件队列不被消费；不会操作招聘网站的真实个人资料。

2026-10-22 验证结果：`npm test` 567/567 通过；后续补充的 schema 校验连同响应观察测试 14/14 通过；`npm run e2e` 76/76 通过、1359 条断言，其中新增响应观察用例 19 条断言。

后续优先级：P1 通用 DOM 反馈观察器；P1 日期控件适配；P1 可见性选择器与导航竞态；P2 站点保存/上传适配包。前序限长与本地搜索继续保留，不用网络正文取代必要的页面观察。

安装与回退见 [response-observation.md](response-observation.md)。
