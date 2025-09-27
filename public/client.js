// public/client.js
const WS_URL =
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";

const ws = new WebSocket(WS_URL);

ws.addEventListener("open", () => {
  // 空席に自動着席（固定したいなら seat:"N" など）
  ws.send(JSON.stringify({ type: "seat", seat: "N" })); // 例: Nに座る
  // 空席自動なら ws.send(JSON.stringify({ type: "pull" })); だけでもOK
});

ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "state") {
    // ここで画面描画
    console.log("STATE", msg.data);
  }
  if (msg.type === "log") {
    console.log("LOG", msg.line);
  }
  if (msg.type === "error") {
    console.warn("ERROR", msg.message);
  }
});

// テスト用（適宜ボタンにバインド）
window.cmd = (text) => ws.readyState === 1 && ws.send(JSON.stringify({ type: "cmd", text }));
window.reset = () => ws.readyState === 1 && ws.send(JSON.stringify({ type: "reset" }));
