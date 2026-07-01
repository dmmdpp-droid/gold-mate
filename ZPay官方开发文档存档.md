# ZPay 官方开发文档存档

> 存档于 2026-06-30，源自 [https://z-pay.cn/doc.html](https://z-pay.cn/doc.html)。
> 存档目的：官网文档内容今后可能变化或改版，这里保留一份当前版本的完整快照，避免以后排查问题时反复去官网翻找。
> 如与官网最新内容有出入，以官网为准；如需查证更新，可直接访问上方链接核对。

---

## 一、页面跳转支付（收银台跳转）

**请求URL**：`https://zpayz.cn/submit.php`

**请求方法**：POST 或 GET（推荐POST，不容易被劫持或屏蔽）
此接口可用于用户前台直接发起支付，使用form表单跳转或拼接成url跳转。

**请求参数**：

| 参数 | 名称 | 类型 | 必填 | 描述 | 范例 |
|---|---|---|---|---|---|
| name | 商品名称 | String | 是 | 需体现出具体售卖的商品，否则容易被封 | iPhone17苹果手机 |
| money | 订单金额 | String | 是 | 最多保留两位小数 | 5.67 |
| type | 支付方式 | String | 是 | 支付宝：alipay 微信支付：wxpay | alipay |
| out_trade_no | 商户订单号 | Num | 是 | 每个商品不可重复，最多32位 | 201911914837526544601 |
| notify_url | 异步通知页面 | String | 是 | 交易信息回调页面，**不支持带参数** | http://www.aaa.com/bbb.php |
| pid | 商户唯一标识 | String | 是 | 一串字母数字组合 | 201901151314084206659771 |
| cid | 支付渠道ID | String | 否 | **支持填写多个，使用,隔开，如果不填则随机调用** | 1234 |
| param | 附加内容 | String | 否 | 会通过notify_url原样返回 | 金色 256G |
| return_url | 跳转页面 | String | 是 | 交易完成后浏览器跳转，**不支持带参数** | http://www.aaa.com/ccc.php |
| sign | 签名 | String | 是 | 用于验证信息正确性，采用md5加密 | 28f9583617d9caf66834292b6ab1cc89 |
| sign_type | 签名方法 | String | 是 | 默认为MD5 | MD5 |

**成功返回**：直接跳转到付款页面（该页面为收银台，直接访问这个url即可进行付款）

**失败返回**：`{"code":"error","msg":"具体的错误信息"}`

---

## 二、API接口支付

**请求URL**：`https://zpayz.cn/mapi.php`

**请求方法**：POST（form-data）

**请求参数**：

| 字段名 | 变量名 | 必填 | 类型 | 示例值 | 描述 |
|---|---|---|---|---|---|
| 商户ID | pid | 是 | String | 20220715225121 | |
| 支付渠道ID | cid | 否 | String | 1234 | **支持填写多个，使用,隔开，如果不填则随机调用** |
| 支付方式 | type | 是 | String | alipay | 支付宝：alipay 微信支付：wxpay |
| 商户订单号 | out_trade_no | 是 | String | 20160806151343349 | 每个商品不可重复，最多32位 |
| 异步通知地址 | notify_url | 是 | String | http://www.pay.com/notify_url.php | 服务器异步通知地址 |
| 商品名称 | name | 是 | String | iPhone17苹果手机 | 需体现出具体售卖的商品，否则容易被封 |
| 商品金额 | money | 是 | String | 1.00 | 单位：元，最大2位小数 |
| 用户IP地址 | clientip | 是 | String | 192.168.1.100 | 用户发起支付的IP地址 |
| 设备类型 | device | 否 | String | pc | 根据当前用户浏览器的UA判断，传入用户所使用的浏览器或设备类型，**默认为pc**（本项目H5支付必须显式传 `h5`，否则默认pc会导致微信内跳转异常，详见项目内《ZPay第三方支付接入指南》坑1/坑2） |
| 业务扩展参数 | param | 否 | String | 没有请留空 | 支付后原样返回 |
| 签名字符串 | sign | 是 | String | 202cb962ac59075b964b07152d234b70 | 签名算法参考本文档"五、MD5签名算法" |
| 签名类型 | sign_type | 是 | String | MD5 | 默认为MD5 |

**成功返回**：

| 字段名 | 变量名 | 类型 | 示例值 | 描述 |
|---|---|---|---|---|
| 返回状态码 | code | Int | 1 | 1为成功，其它值为失败 |
| 返回信息 | msg | String | | 失败时返回原因 |
| ZPAY订单号 | O_id | String | 123456 | ZPAY订单号 |
| 订单号 | trade_no | String | 20160806151343349 | 支付订单号 |
| 支付跳转url | payurl | String | https://xxx.cn/pay/wxpay/202010903/ | 如果返回该字段，则直接跳转到该url支付 |
| 支付跳转url2 | payurl2 | String | https://xxx.cn/pay/wxpay/202010903/ | **如果需要使用微信H5支付，请使用该url**（不是payurl） |
| 二维码链接 | qrcode | String | https://xxx.cn/pay/wxpay/202010903/ | 如果返回该字段，则根据该url生成二维码 |
| 二维码图片 | img | String | https://zpayz.cn/qrcode/123.jpg | 该字段为付款二维码的图片地址 |

**失败返回**：`{"code":"error","msg":"具体的错误信息"}`

---

## 三、微信小程序支付

第一步：使用"API接口支付"获取到 `O_id` 参数

第二步：跳转 ZPAY 收银台小程序，appid: `wxa9882fcbc23a0181`

```js
wx.navigateToMiniProgram({
    appId: 'wxa9882fcbc23a0181',
    path: 'pages/pay/pay?type=wxapp&O_id=123456', // 替换为第一步获取到的O_id
    fail(res) { wx.showToast({ title: res.errMsg, icon: 'none' }); },
    success(res) { wx.showToast({ title: 'ok', icon: 'none' }); },
});
```

支付成功或取消，会跳回小程序并携带参数：
- 成功：`extraData: { status: 'success' }`
- 取消：`extraData: { status: 'cancel' }`

---

## 四、查询类接口

### 查询zpay账户余额

`GET https://zpayz.cn/api.php?act=balance&pid={商户ID}&key={商户密钥}`

返回：`code`（1成功）、`msg`、`balance`（账户余额）

### 查询单个订单

`GET https://zpayz.cn/api.php?act=order&pid={商户ID}&key={商户密钥}&out_trade_no={商户订单号}`

（`trade_no` 与 `out_trade_no` 二选一）

返回字段：`trade_no`、`out_trade_no`、`type`、`pid`、`addtime`、`endtime`、`name`、`money`、`status`（1成功/0未支付）、`param`、`buyer`

### 提交订单退款

`POST https://zpayz.cn/api.php?act=refund`

参数：`pid`、`key`（商户密钥，明文传递，注意接口安全）、`trade_no`/`out_trade_no`（二选一）、`money`（退款金额，大多数通道需与原订单金额一致）

返回：`code`（1成功）、`msg`

---

## 五、支付结果通知（异步回调 / 页面跳转通知）

**请求方式**：服务器异步通知（notify_url）、页面跳转通知（return_url），均为 **GET** 请求

**参数**：

| 参数 | 名称 | 类型 | 描述 |
|---|---|---|---|
| pid | 商户ID | String | |
| name | 商品名称 | String | 不超过100字 |
| money | 订单金额 | String | 最多保留两位小数 |
| out_trade_no | 商户订单号 | String | 商户系统内部的订单号 |
| trade_no | 易支付订单号 | String | ZPay侧订单号 |
| param | 业务扩展参数 | String | 原样返回 |
| trade_status | 支付状态 | String | **只有 `TRADE_SUCCESS` 是成功** |
| type | 支付方式 | String | alipay / wxpay |
| sign | 签名 | String | 参考MD5签名算法 |
| sign_type | 签名类型 | String | 默认MD5 |

**验证方法**：按签名算法自行计算签名，与收到的 `sign` 比对一致即视为官方真实通知。

**⚠️ 注意事项（务必遵守，否则会被反复重试骚扰）**：

1. **收到回调后必须返回精确的字符串 `success`**（不能是JSON、不能带多余字符、大小写敏感），否则ZPay判定通知失败
2. 同样的通知可能多次发送，商户系统必须能正确处理重复通知（幂等）
3. 推荐做法：收到通知先检查业务数据状态判断是否已处理过，未处理过再处理；处理前后要用数据锁做并发控制，避免函数重入导致数据混乱
4. **必须做签名验证**，并校验订单金额是否与商户侧一致，防止"假通知"导致资金损失
5. **重试策略**：如果响应不含 `success` 或超过5秒未返回，判定通知失败，按 **0/15/15/30/180/1800/1800/1800/1800/3600（单位：秒）** 的节奏重新发起通知（间隔逐渐拉长到最长半小时/1小时一次），不保证最终一定成功

---

## 六、MD5签名算法

1. 将发送或接收到的**所有**参数按参数名 ASCII 码从小到大排序（a-z），**`sign`、`sign_type`、和空值不参与签名**
2. 将排序后的参数拼接成 URL 键值对格式，例如 `a=b&c=d&e=f`，**参数值不要进行 url 编码**
3. 将拼接好的字符串与商户密钥 KEY 进行 MD5 加密得出 `sign`：
   `sign = md5( a=b&c=d&e=f + KEY )`
   （`+` 为各语言的字符串拼接符，不是字面字符；md5结果为小写）
4. 具体示例代码可下载SDK查看（官网提供 PHP/JAVA/NODE/PYTHON/C++/ASP 版本demo）

---

## 七、本项目实际接入落地记录

以上是官网文档快照。本项目实际接入过程中踩过的坑、以及针对Cloudflare Pages Functions环境的适配细节，记录在同目录下的 **《ZPay第三方支付接入指南.md》**，包括：

- `device` 参数选型（H5支付必须传 `h5` 并优先取 `payurl2`）
- 微信支付V1/V2接口套餐差异（V1不支持H5，V2才支持）
- Cloudflare Pages Functions 不支持 `node:crypto`，需要纯JS实现MD5（`functions/api/_md5.js`）
- 自实现MD5的稀疏数组bug及修复过程
- 商户密钥两端加密无法核对时，重置密钥同步双端的排查方法
- iOS微信支付完成后无法自动跳回浏览器的系统级限制及 `visibilitychange` 应对方案

两份文档配合看：这份是**官方接口规范**，另一份是**本项目的实战经验和已知问题**。
