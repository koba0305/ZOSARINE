// public/client.js — transport layer (single WS with backoff + events)

(() => {

const WS_HOST = location.hostname.endsWith('github.io')
  ? 'your-app.onrender.com'
  : location.host;
const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + WS_HOST + '/ws';

const CID_KEY = "zs_cid";
const store = sessionStorage;
let cid = store.getItem(CID_KEY);
if (!cid) {
  cid = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
  store.setItem(CID_KEY, cid);
}


  // ---- 再接続バックオフ ----
  let ws = null;
  let backoff = 1000;           // 1s
  const MAX_BACKOFF = 30000;    // 30s
  let openedOnce = false;

  // ---- UI 層へ投げるイベント送出 ----
  const emit = (type, detail) =>
    window.dispatchEvent(new CustomEvent(type, { detail }));

  function connect() {
    ws = new WebSocket(WS_URL);

    ws.addEventListener("open", () => {
      backoff = 1000;
      openedOnce = true;
      // 再接続でも必ず resume → pull
      safeSend({ type: "resume", cid });
      safeSend({ type: "pull" });
      emit("zs:open", {});
    });

    ws.addEventListener("message", (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      switch (msg.type) {
        case "hello": emit("zs:hello", msg); break;
        case "you":   emit("zs:you",   msg); break;
        case "state": emit("zs:state", msg.data); break;
        case "log":   emit("zs:log",   msg.line); break;
        case "path":  emit("zs:path",  msg); break; // アニメは index 側で
        case "error": emit("zs:error", msg.message); break;
        case "logs":  emit("zs:logs",  msg); break; // 過去ログページング
        case "ok":    emit("zs:ok",    msg); break;
        default:      // 未来拡張
          emit("zs:msg", msg);
      }
    });

    ws.addEventListener("close", () => {
      // バックオフで再接続
      scheduleReconnect();
      emit("zs:close", {});
    });

    ws.addEventListener("error", () => {

      // emit("zs:error", "network error");
    });
  }

  function scheduleReconnect() {
    const delay = Math.min(backoff, MAX_BACKOFF);
    setTimeout(connect, delay);
    backoff *= 2;
  }

  function safeSend(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  // ---- UI から使う公開 API ----
  window.chooseSeat = (seat) => safeSend({ type: "seat", seat });
  window.sendCmd    = (text) => safeSend({ type: "cmd", text });
  window.resetAll   = ()     => safeSend({ type: "reset" });
  window.resetGame  = ()     => safeSend({ type: "resetGame" });
  window.pullState  = ()     => safeSend({ type: "pull" });
  window.loadLogs   = (end, limit=120) =>
    safeSend({ type: "logs", end, limit });
window.setName    = (name) => safeSend({ type: "name", name });

 window.reset = window.resetAll;
 window.cmd   = window.sendCmd;
  // ---- 保険：5分おきに /healthz を叩いて Render 等のスリープからの復帰を促す ----
  setInterval(() => { fetch("/healthz", { cache: "no-store" }).catch(() => {}); }, 5 * 60 * 1000);

  connect();
})();
