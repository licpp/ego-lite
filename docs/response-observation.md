# 请求响应观察：使用与安装

构建本分支后，将 SDK 与匹配的指南一起安装；无需重新安装浏览器或迁移账号。

```sh
git clone --branch feat/token-efficient-skill https://github.com/licpp/ego-lite.git
cd ego-lite/package/ego-browser
npm ci
npm run install:local
```

若安装器提示已有本分支 overlay，先执行 `npm run uninstall:local`，再安装新版本。安装器会备份现有文件；回退执行 `npm run uninstall:local`，无需删除浏览器数据。也可不安装，仅单次运行：

```sh
ego-browser nodejs --sdk-path "$PWD/dist/out/index.js" <<'JS'
help('page.actAndWaitForResponse');
JS
```

安装后正常使用 `ego-browser nodejs`，按需 `await guide('files')` 查看响应观察示例。工具必须遵守原有任务空间和用户控制规则；本功能没有额外的抢占权限。

```js
const result = await page.actAndWaitForResponse({
  action: () => page.click('#save'),
  match: { urlIncludes: '/resume/save', method: 'POST' },
  bodyFields: ['code', 'message', 'data.id'],
  maxChars: 2000,
});
console.log(result.response);
```

先从正常 Page 操作观察到的接口确定匹配条件，不凭空猜测接口再发送请求。HTTP 200 与业务成功分开判断。出现超时或网络失败时，先查询界面/已保存记录，不能自动重试可能已生效的写操作。

完整正文按需保存：`saveBodyAs:'/absolute/new-response.json'`。返回内容仍受 `maxChars` 限制；本地文件可用限定输出的 `rg` 搜索。不会返回请求 Cookie、Authorization 或整份请求正文。

本轮方案与实现边界见 [response-observation-plan.md](response-observation-plan.md)。
