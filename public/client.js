// public/client.js
const WS_URL =
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
const ws = new WebSocket(WS_URL);


const CID_KEY = "codexTilesCID";
const cid = localStorage.getItem(CID_KEY) || (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
localStorage.setItem(CID_KEY, cid);

let mySeat = null;

ws.addEventListener("open", () => {
  
  ws.send(JSON.stringify({ type: "resume", cid })); 
  ws.send(JSON.stringify({ type: "pull" }));        
});

ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);

  if (msg.type === "hello") {
    
  }
  if (msg.type === "you") {
    mySeat = msg.seat; 
    updateYou(mySeat);
  }
  if (msg.type === "state") {
    render(msg.data);  
  }
  if (msg.type === "log") {
    appendLog(msg.line);
  }
  if (msg.type === "error") {
    showError(msg.message);
  }
});

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


(() => {
  const WS_URL =
    (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
  const CID_KEY = "codexTilesCID";
  const cid =
    localStorage.getItem(CID_KEY) ||
    (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
  localStorage.setItem(CID_KEY, cid);

  let ws = null;
  let backoff = 1000;          
  const MAX_BACKOFF = 30000;   

  function connect() {
    console.log("[ws] connecting", WS_URL);
    ws = new WebSocket(WS_URL);

    ws.addEventListener("open", () => {
      console.log("[ws] open");
      backoff = 1000; 
      ws.send(JSON.stringify({ type: "resume", cid }));
      ws.send(JSON.stringify({ type: "pull" }));
    });

    ws.addEventListener("message", (e) => {
      try {
        const msg = JSON.parse(e.data);
        console.log("[ws] msg", msg.type, msg);
      } catch (err) {
        console.warn("[ws] bad json", err);
      }
    });

    ws.addEventListener("close", (e) => {
      console.warn("[ws] close", e.code, e.reason);
      scheduleReconnect();
    });

    ws.addEventListener("error", (e) => {
      console.warn("[ws] error", e);
      
      // try { ws.close(); } catch {}
    });
  }

  function scheduleReconnect() {
    const delay = Math.min(backoff, MAX_BACKOFF);
    console.log("[ws] reconnect in", delay, "ms");
    setTimeout(connect, delay);
    backoff *= 2; 
  }

  
  window.chooseSeat = (seat) => {
    if (!ws || ws.readyState !== 1) return console.warn("[chooseSeat] ws not open");
    ws.send(JSON.stringify({ type: "seat", seat })); // "N"|"E"|"S"|"W"
  };
  window.cmd = (text) => {
    if (!ws || ws.readyState !== 1) return console.warn("[cmd] ws not open");
    ws.send(JSON.stringify({ type: "cmd", text }));
  };
  window.reset = () => {
    if (!ws || ws.readyState !== 1) return console.warn("[reset] ws not open");
    ws.send(JSON.stringify({ type: "reset" }));
  };

  
  setInterval(() => {
    fetch("/healthz", { cache: "no-store" }).catch(() => {});
  }, 5 * 60 * 1000);

  connect();
})();
