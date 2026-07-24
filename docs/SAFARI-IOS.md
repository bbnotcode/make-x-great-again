# Safari Web Extension（iOS / iPadOS 18+）

MXGA 的 iOS 版本只作用于 Safari 中打开的 `x.com` / `twitter.com`，不能修改 X 原生 App 或其他 App 的内置浏览器。它复用 `extension/` 的 WXT、React 和 TypeScript 源码，并由 SwiftUI 容器 App 携带 Safari Web Extension。

## 已实现范围

- 公共黑名单内置快照、后台只读同步和离线回退；
- 本地徽标、分类策略、本地隐藏、5 秒撤销和处理记录；
- 可选的 X 原生静音 / 拉黑；
- popup、响应式管理面板和 GitHub 白名单申请；
- iPhone / iPad 深浅色、动态布局、安全区和触摸操作；
- iOS 18+，Manifest V3。

## 工程结构

```text
extension/
  └─ npm run build:safari
      └─ .output/safari-mv3

apple/MXGA/MXGA.xcodeproj
  ├─ MXGA (iOS)                      SwiftUI 启用引导
  ├─ MXGA Extension (iOS)            iOS / iPadOS Safari Extension
  ├─ MXGA (macOS)                    共存的 macOS 容器 target
  └─ MXGA Extension (macOS)          共存的 macOS 扩展 target
```

- 默认 App Bundle ID：`tv.zuoluo.mxga`
- 默认 Extension Bundle ID：`tv.zuoluo.mxga.SafariExtension`
- 可通过 `APP_BUNDLE_IDENTIFIER` 同时切换 App 与扩展的 Bundle ID 前缀
- 最低系统：iOS / iPadOS 18.0
- Swift：Swift 6，严格并发检查

原生 App 不读取 WebExtension 数据，因此不需要 App Group。扩展的设置、名单、统计和处理记录仍保存在 WebExtension 本地存储中。

## 本地签名配置

macOS 与 iOS 的四个 target 共享同一个 `apple/MXGA/MXGA.xcodeproj`，并由 `apple/Config/Signing.xcconfig` 统一注入本地签名设置。复制本地模板并填写自己的 Team ID：

```bash
cp apple/Config/Signing.local.xcconfig.example \
  apple/Config/Signing.local.xcconfig
# DEVELOPMENT_TEAM = 你的 Team ID
# APP_BUNDLE_IDENTIFIER = studio.tutu.mxga
```

`APP_BUNDLE_IDENTIFIER` 默认为 `tv.zuoluo.mxga`；扩展 ID 自动派生为
`$(APP_BUNDLE_IDENTIFIER).SafariExtension`。`Signing.local.xcconfig` 已被 Git 忽略。它会在 Xcode 中自动注入同一工程下四个 target 的 Team 与 Bundle ID，但不会影响没有该文件的无签名命令行构建；命令行显式传入的构建设置仍具有更高优先级。

## 本地构建

要求 Node.js 20+、Xcode 26 或更新版本：

```bash
npm --prefix extension install
./scripts/build-safari-ios-app.sh
```

无签名的 Simulator 产物位于：

```text
.build/safari-ios/Build/Products/Debug-iphonesimulator/MXGA.app
```

也可以先生成 WebExtension，再在 Xcode 中打开工程：

```bash
npm --prefix extension run build:safari
open apple/MXGA/MXGA.xcodeproj
```

同一个 Xcode 工程的两个 Safari Extension target 都引用被忽略的 `extension/.output/safari-mv3`，因此全新 checkout 必须先执行一次 Safari 构建。

## Simulator / 真机验证

1. 运行 `MXGA (iOS)` scheme；
2. 打开“设置”→“App”→“Safari”→“扩展”；
3. 启用 Make X Great Again，并允许访问 x.com；
4. 在 Safari 中登录并打开 x.com；
5. 验证徽标点按弹层、气泡、popup 和管理面板；
6. 分别验证本地隐藏、撤销、处理记录恢复；
7. 使用测试账号验证可选的 X 静音 / 拉黑；
8. 验证名单首次同步、热更新、离线回退和 Safari 回收后台后的恢复。

至少覆盖：

- iPhone 竖屏 / 横屏、iPad 分屏；
- 首页时间线、推文详情回复区、Profile、搜索结果和 SPA 跳转；
- 多标签页、普通 / 私密浏览、权限拒绝和允许；
- 深浅色、动态字体、Reduced Motion；
- 后台 Service Worker 回收、Safari 被系统终止后重启；
- X 原生动作的 cookie、限速、429 退避和失败降级。

> Safari 扩展只覆盖网页。用户从 Safari 跳入 X 原生 App 后，MXGA 无法继续处理页面。

## 内存策略

13 万条以上的名单不能为每条记录预先创建完整 verdict 对象。移动端索引保留紧凑 lite tuple，按 ID / handle 查到实际命中时才展开展示对象。内置快照仍保证 Service Worker 或网络暂时不可用时可以立即工作。
