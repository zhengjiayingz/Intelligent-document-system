# ECharts Tooltip 提取 — 页面 + 浏览器插件 Demo

## 结构

| 路径 | 角色 |
|------|------|
| `index.html` | **第三方页**：只渲染随机 ECharts，**无提取代码** |
| `extension/` | **Chrome MV3 插件**：在页面 MAIN world 里 `showTip` + 读 tooltip DOM |

## 1. 打开「别人的」页面

```bash
npx --yes serve demos/echarts-tooltip-scrape -p 5179
```

浏览器打开：http://localhost:5179

## 2. 加载插件

1. Chrome 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选本目录下的 `extension/` 文件夹

## 3. 提取

1. 留在 http://localhost:5179 标签页
2. 点工具栏扩展图标 → **提取当前页图表**
3. 弹窗里应出现 `extracted` 列表
4. 回到页面点「揭晓真值」对比是否一致

## 说明

- 插件用 `chrome.scripting.executeScript({ world: 'MAIN' })`，才能访问页面的 `echarts` 全局对象。
- Content Script 隔离世界里看不到页面的 `echarts`，所以必须 MAIN world。
- 仍然**不**调用 `getOption()` 读源数据；数值来自 tooltip DOM。
