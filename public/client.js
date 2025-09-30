// public/client.js
const WS_URL =
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
const ws = new WebSocket(WS_URL);

// タブ復帰用のCID（あなたのserverはresume対応済み）
const CID_KEY = "codexTilesCID";
const cid = localStorage.getItem(CID_KEY) || (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
localStorage.setItem(CID_KEY, cid);

let mySeat = null;

ws.addEventListener("open", () => {
  // 自動着席はしない。状態同期だけ
  ws.send(JSON.stringify({ type: "resume", cid })); // 復帰（同じブラウザなら席引き継ぎ）
  ws.send(JSON.stringify({ type: "pull" }));        // 最新state取得
});

ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);

  if (msg.type === "hello") {
    // 初回IDが来る（必要ならUI表示）
  }
  if (msg.type === "you") {
    mySeat = msg.seat; // nullなら観戦
    updateYou(mySeat);
  }
  if (msg.type === "state") {
    render(msg.data);  // 盤・フェーズ・点数など反映
  }
  if (msg.type === "log") {
    appendLog(msg.line);
  }
  if (msg.type === "error") {
    showError(msg.message);
  }
});

// ===== UIから呼ぶ関数（席はユーザーが選ぶ）=====
window.chooseSeat = (seat) => {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "seat", seat }));
};
window.sendCmd = (text) => {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "cmd", text }));
};
window.resetAll = () => {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "reset" }));
};
window.resetGame = () => {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "resetGame" }));
};

// ==== ここはあなたの既存UIに合わせて書き換え ====
function render(s) { /* ... */ }
function updateYou(seat) { /* ... */ }
function appendLog(line) { /* ... */ }
function showError(msg) { /* ... */ }
