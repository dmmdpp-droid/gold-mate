# 阿里云短信认证服务接入指南（号码认证服务 / Dypnsapi）

> 记录于 2026-06-30，黄金换算助手项目实战经验。
> 这是经过反复调试验证过的可用方案，下次接入同类需求可直接复用。

---

## 一、为什么选这个方案，而不是传统短信服务(SMS)

| 对比项 | 传统短信服务 (SMS) | 短信认证服务 (Dypnsapi) |
|---|---|---|
| 资质要求 | 必须企业资质，个人不可用 | **不需要任何资质** |
| 签名/模板 | 必须自己申请，审核1-3天 | **平台自带签名和模板，无需申请** |
| 备案要求 | 通常需要 | **不需要** |
| 验证码生成/校验逻辑 | 自己实现 | 平台代管，自己只管发送和核验结果 |
| 价格 | 约 ¥0.045/条 | 约 ¥0.04/条（100次套餐包¥3.99）|

**结论：个人/小微项目做手机号验证码登录，优先选短信认证服务，而不是传统SMS。**

阿里云的"号码认证服务"产品线下有两个子功能容易混淆：
- **号码认证**（一键登录/本机号码校验）：需要客户端SDK，H5场景必须关闭WiFi用流量，体验受限，不适合PWA
- **短信认证**（本指南用的）：纯API调用，仅服务端集成，无WiFi限制，**这才是PWA/网页项目该用的**

---

## 二、开通流程

1. 控制台地址：`https://dypns.console.aliyun.com`
2. 左侧菜单：**短信认证服务** → **短信认证概览**
3. 点击「购买短信认证套餐包」，最小规格 100次/¥3.99，12个月有效
4. 默认签名「速通互联验证码」和模板「登录/注册模板」（TemplateCode: `100001`）平台自带，**不需要自己申请**

---

## 三、获取密钥（重要：用RAM子账号，不要用主账号AccessKey）

1. 进入 RAM 访问控制：`https://ram.console.aliyun.com`
2. 身份管理 → 用户 → 创建用户
3. 登录名随意（如 `sms-auth`），勾选 **API 访问**
4. 创建时会附带创建 AccessKey，**立即复制保存**（Secret只显示一次）
5. 权限策略：创建时默认会给 `PowerUserAccess`（权限过大但能用），更安全的做法是后续单独改成 `AliyunDypnsFullAccess`（本次未实测，PowerUserAccess验证可行）

---

## 四、密钥存储 — 千万不要硬编码在代码里

**血的教训**：第一次直接把 AccessKey 写死在 `.js` 文件里，push 到 GitHub 时被 **GitHub 密钥扫描自动拦截**，返回 `403 push protection`，根本推不上去。

**正确做法**：用 Cloudflare Pages 的加密环境变量。

1. Cloudflare Dashboard → Pages项目 → Settings → 往下滚动找 **Variables and secrets**
2. 点 **+ Add**，类型选 **Secret**（不是 Text）
3. 添加两条：`ALIYUN_AK_ID`、`ALIYUN_AK_SECRET`
4. 代码里通过 `env.ALIYUN_AK_ID` 读取，不要写字面量

```js
export async function onRequestPost({ request, env }) {
  const ACCESS_KEY_ID = env.ALIYUN_AK_ID;
  const ACCESS_KEY_SECRET = env.ALIYUN_AK_SECRET;
  // ...
}
```

---

## 五、签名算法 — Cloudflare Workers 环境的坑

阿里云 OpenAPI 用的是 **RPC 签名机制（HMAC-SHA1）**，不是简单的MD5。

**注意**：`crypto.subtle.digest` 原生只支持 SHA 系列，不支持 MD5；但这次签名算法本身用的是 HMAC-SHA1，Web Crypto API 是支持的，所以可以直接用：

```js
async function hmacSha1(key, message) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const msgData = encoder.encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
```

完整签名流程（RPC签名规范）：
1. 公共参数 + 业务参数合并
2. 按 key 字典序排序
3. 构造规范化查询字符串（key=value，URL编码后用&连接）
4. 拼接 `GET&%2F&` + URL编码后的查询字符串 作为待签名串
5. 用 `AccessKeySecret + '&'` 作为HMAC密钥，对待签名串做HMAC-SHA1，Base64编码得到签名
6. 把签名作为 `Signature` 参数加入最终请求

完整代码见本项目 `functions/api/_aliyun-sign.js`（已验证可用，可直接复用）。

---

## 六、API 调用参数 — 反复踩坑的部分

### SendSmsVerifyCode（发送验证码）

**最终验证通过的参数：**

```js
{
  PhoneNumber: phone,
  SignName: '速通互联验证码',      // 平台默认签名，照抄即可
  TemplateCode: '100001',          // 平台默认模板Code
  TemplateParam: '{"code":"##code##","min":"5"}',  // 关键！
  CodeLength: '4',
  ExpireTime: '300',               // 注意是 ExpireTime 不是 ValidTime！
}
```

**踩过的坑（按时间顺序）：**

1. ❌ 不传 `TemplateParam` → 报错 `TemplateParam is mandatory for this action`
2. ❌ 传 `TemplateParam: '{"min":"5"}'`（不带code字段）→ 报错 `模版变量code内容非法`
3. ❌ 传 `TemplateParam: '{"code":"","min":"5"}'`（code传空字符串）→ 同样报错
4. ❌ 参数名用 `ValidTime` → 实际无效，真实参数名是 `ExpireTime`
5. ✅ **正确写法**：`code` 字段必须传字面量字符串 `"##code##"`（这是系统占位符标记，表示"由系统自动生成验证码填入此处"），不能传空值或具体数字

**如何确认正确参数**：去阿里云 OpenAPI Explorer 在线调试页面看，每个参数旁边都有 ⓘ 图标，点开能看到详细说明和示例值，比盲猜或查零散博客文章准确得多。
地址：`https://api.aliyun.com/api/Dypnsapi/2017-05-25/SendSmsVerifyCode`

### CheckSmsVerifyCode（核验验证码）

```js
{
  PhoneNumber: phone,
  VerifyCode: code,      // 用户输入的验证码
  VerifyId: verifyId,    // 发送时返回的 VerifyId，需要前端暂存后传回
}
```

返回结果里 `Model.VerifyResult` 为 `"PASS"` 表示核验通过。

---

## 七、调试技巧

1. **环境变量是否生效**：临时在接口里加判断，返回 `hasId`/`hasSecret`/`idLen` 这种不暴露明文但能确认是否读取到的信息，比直接猜测高效很多
2. **GitHub push 失败排查**：如果遇到 `409 Conflict` 但文件其实是新文件，大概率不是真冲突，用 `urllib.error.HTTPError` 捕获并打印 `e.read()` 看具体错误body，往往是密钥扫描拦截，而非真正的版本冲突
3. **频率限制**：短信认证服务对同一手机号有调用频率限制（`check frequency failed`），测试时每次间隔建议60秒以上

---

## 八、本项目最终落地的业务设计

- 支付成功后**强制**要求手机号登录（不可跳过，不能点击背景关闭），登录成功后自动将会员记录绑定到该手机号
- 清缓存/换机后，付费墙底部"已有会员？手机号登录"入口，验证码核验通过后自动恢复会员状态
- 设备指纹方案、激活码方案功能代码保留但前端隐藏，作为未来可能重新启用的后备方案，避免重复造轮子

