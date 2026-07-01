# PWA前沿技术调研笔记

> 调研于 2026-07-01。查阅了以下10个PWA领域公认权威的信源，重点筛选跟本项目实际场景相关的内容。
> 末尾附上对照本项目现有 `sw.js`、`manifest.json` 发现的两个可能存在的具体问题。

---

## 一、十个信源

| # | 信源 | 定位 | 为什么值得关注 |
|---|---|---|---|
| 1 | **firt.dev**（Maximiliano Firtman） | 独立专家博客 | **iOS PWA兼容性问题的头号权威**，从2011年iOS首次支持PWA相关技术起就持续追踪Apple每个版本的行为变化，是"iOS PWA有什么新坑"这类问题的第一手信息源，比二手转述文章可靠得多 |
| 2 | **web.dev**（Google官方） | 官方文档+案例研究 | Service Worker、Web App Manifest、安装引导的官方权威文档，Twitter Lite等大厂案例研究的原始出处 |
| 3 | **developer.chrome.com** | Chrome官方开发者文档 | Lighthouse审计规则、`beforeinstallprompt`最新行为变更的第一手来源 |
| 4 | **MDN Web Docs（Progressive_web_apps）** | 跨浏览器权威参考 | 不偏向单一浏览器厂商，对Service Worker生命周期、Cache API的说明最中立准确 |
| 5 | **webkit.org/blog** | Apple WebKit团队官方博客 | Safari/iOS对PWA相关API（ITP、Service Worker限制等）的官方一手说明，本轮"服务端Cookie不受7天限制"的结论正是溯源到这里 |
| 6 | **w3c.org/TR/appmanifest** | W3C标准原文 | Web App Manifest规范的权威原文，maskable图标"安全区"等细节定义的最终依据 |
| 7 | **jsmanifest.com** | 独立开发者博客 | 一线实战踩坑记录，"每次更新Service Worker务必递增缓存版本号，否则调试时怀疑人生"这类经验之谈很实在 |
| 8 | **dev.to（Frontend System Design系列）** | 社区技术文章 | 用决策树的方式梳理"什么内容该用哪种缓存策略"，结构清晰，适合直接对照自查 |
| 9 | **pwastats.com** | PWA案例数据集合站 | 收录大量带具体转化率/留存数据的PWA商业案例（本轮讨论提到的Twitter Lite、Pinterest等均出自此类信源交叉印证） |
| 10 | **digitalapplied.com（2026 PWA Performance/Development Guide系列）** | 2026年最新综合指南 | 内容较新，反映当前（2026年）行业对PWA的整体评价和工具链成熟度现状 |

---

## 二、跟本项目相关的关键发现

### 2.1 Service Worker缓存版本管理（⚠️ 对照本项目发现疑似实际问题）

多个信源反复强调同一条经验：**Service Worker的缓存名必须在每次发布新版本时递增**，否则`activate`事件里"清理旧缓存"的逻辑形同虚设——因为新旧版本用的是同一个缓存名，浏览器会认为"缓存没变"，不会触发清理，也不会用新内容覆盖旧内容。

> jsmanifest.com原话大意："每次更新Service Worker时，一定要递增缓存版本号，让activate事件能清理旧缓存，不然过期缓存会变成调试噩梦。"

**对照本项目`sw.js`**：

```js
const CACHE = 'gold-assistant-v1';
```

这个值目前是**写死的字符串，从V1开始到现在（V1.8.8）从未变过**。而`index.html`在这轮讨论里已经改了好几个版本。`sw.js`的fetch处理逻辑对"除金价API、字体之外的其他资源"（这正好包括`index.html`本身）用的是**cache-first**策略——也就是说，如果用户设备上曾经缓存过旧版本的`index.html`，理论上**会一直提供旧版本的页面，不会自动更新到最新代码**，除非用户主动强制刷新，或者恰好触发了Service Worker自身文件变化引发的重新安装（但`sw.js`本身的代码这次也没有改动，所以这个触发条件也不成立）。

**建议**：每次发布新版本时，把`CACHE`常量也同步递增（比如改成跟`CHANGELOG.md`版本号挂钩，例如`gold-assistant-v188`），这样才能确保用户设备上的缓存会被正确清理并更新到最新版本，配合"Delivery标准"里"每次代码交付自动更新CHANGELOG版本号"的习惯，可以一起做。

### 2.2 `manifest.json`的maskable图标——安全区问题（🔍 需要人工肉眼核实）

W3C规范和web.dev都强调：maskable图标需要预留"安全区"（图标内容集中在中心40%半径的圆形区域内，四周留白），否则在支持自适应图标的Android设备上，图标边缘可能被裁切掉，显示效果变差。

**对照本项目`manifest.json`**：

```json
{ "src": "icon-gold-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
{ "src": "icon-gold-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" }
```

`any`和`maskable`两个用途用的是**同一张图片文件**。如果这张图本身的核心图案（比如金币图案的边缘）贴得比较满、没有预留足够留白，在部分安卓设备上加到桌面后可能会出现图标被裁边的情况。

**建议**：不需要现在就改，但下次有空可以用Google官方工具 **Maskable.app**（`https://maskable.app/editor`）把现有图标上传上去预览一下，看看在圆形/方形遮罩下边缘会不会被切掉。如果视觉效果没问题就不用动，纯粹是个"建议核实一下"的事项，优先级不高。

### 2.3 iOS PWA的"生命周期"与"幽灵App"问题（🔍 供参考，暂无需行动）

firt.dev的历史文章记录了几个iOS PWA的老毛病，虽然发文时间较早，但其中"删除PWA后有时会留下幽灵图标/后台残留注册"这类bug断断续续在后续iOS版本里都有反复出现的报告。这跟本项目暂时关系不大（用户量级还没到需要专门排查这个的阶段），记录下来供以后万一遇到用户反馈"删了APP图标但好像还在后台"这类诡异反馈时，知道这是iOS平台的已知历史问题，不一定是自己代码的bug。

### 2.4 缓存策略速查（供以后新增功能时参考）

dev.to那篇文章给了一个简洁的决策树，可以直接套用到未来任何新接口/新资源上：

| 内容类型 | 策略 |
|---|---|
| 带内容哈希的静态资源（如`app.a1b2c3.js`） | Cache First |
| HTML页面 | Network First（带超时兜底到缓存） |
| 需要"快+新鲜"平衡的API数据 | Stale-While-Revalidate |
| 登录/支付/统计类请求 | **Network Only，永远不缓存** |
| 预缓存的App Shell | Cache Only |

**跟本项目对照**：目前`sw.js`里`/api/*`这类POST请求（`pay.js`/`notify.js`/`sms-verify.js`等）由于Cache API本身不支持匹配非GET请求，天然会穿透缓存直接走网络，这块没问题。但如果以后新增任何**GET方式的API接口**（比如未来做"查询历史价格曲线"这类只读接口），需要额外注意别让它被现在这条"除金价API/字体外一律cache-first"的兜底规则误伤，应该显式加一条"支付/账户相关接口 network-only"的规则，防止将来不小心把某个应该实时的数据缓存住。

### 2.5 PWA在2026年的行业现状（背景性了解，非本项目直接行动项）

2026年多篇综合指南反映的共识：PWA已经从"实验性技术"变成"生产标准"，主流浏览器对Service Worker/Manifest/Web Push的支持已经完整，工具链（Workbox 7、Vite/webpack集成、Chrome DevTools调试面板）已经很成熟——这跟本轮讨论中"PWA是不是成熟技术"这个问题的结论一致：技术本身没问题，主要的不确定性集中在iOS平台的特有限制上，这也跟firt.dev多年跟踪下来的观察吻合。

---

## 三、行动项汇总

| 优先级 | 事项 | 状态 |
|---|---|---|
| 中 | `sw.js`的`CACHE`常量每次发版时同步递增，避免用户设备缓存住旧版`index.html` | 📋 待实施 |
| 低 | 用Maskable.app核实一下`icon-gold-192.png`/`icon-gold-512.png`作为maskable图标时安全区是否够 | 🔍 待人工核实 |
| 低 | 未来新增GET类API接口时，记得显式排除在"通用cache-first兜底"规则之外 | 🔍 供后续开发参考 |
