# 四川麻将私人房间

## 启动

请在本项目目录 `E:\project\majiang` 打开终端，执行：

```powershell
npm start
```

然后访问 `http://localhost:3000`。

如果浏览器之前已经打开过页面，请先停止旧服务（终端按 `Ctrl+C`），再重新执行 `npm start`，最后在浏览器按 `Ctrl+F5` 强制刷新。

> 不要直接双击 `index.html`。需要通过 `http://localhost:3000` 访问，才能使用私人房间、实时房间同步和自动计分服务。

## 功能

- 创建与加入六位房间号私人房间
- 实时同步房间成员和积分
- 房主可单人开始对局，牌桌其余位置由 AI 补齐
- 换三张、定缺、简化牌桌试玩
- 胡牌结算和自动积分变动

## 文件说明

- `server.js`：Node.js 服务端
- `public/index.html`：网页界面和牌桌逻辑
- `public/server-client.js`：浏览器与服务端连接逻辑
- `package.json`：启动配置

