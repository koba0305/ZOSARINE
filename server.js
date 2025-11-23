import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

// ===== LEX（語彙）定義・保存まわり =====
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const fsp = fs.promises;
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ==== HTTP & WS bootstrap（必ず wss.on(...) より前に置く）====
const app = express();

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const server = http.createServer(app);


// WebSocket サーバ（/ws に集約）
const wss = new WebSocketServer({ server, path: "/ws" });

// 全クライアント送信用ヘルパ（これだけを使う）
function broadcastAll(msg) {
  const s = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client && client.readyState === client.OPEN) {
      try { client.send(s); } catch (_) {}
    }
  }
}

// ======== グループ定義 ========
const LEX_GROUPS_PRESET = {
  tomuya: { name: "トムヤ",   color: "#ff4d4f" },  // 象徴・記号系
  tyann:    { name: "チャン",   color: "#4096ff" },  // 位置・方向系
  zosan:  { name: "ゾーサン", color: "#fadb14" },  // ゾウ・音声・システム系
  yes:    { name: "テメ",     color: "#52c41a" },  // 行為・感情・意志系
  iti: { name: "べヒュー", color: "#9254de" } ,  // 数・構造系
  number: { name: "キキヤーィ", color: "#de5492ff" }   // 数・構造系
};
const DEFAULT_GROUP_ID = "symbol";


// ======== グループ割当（GROUP_RULES） ========
const GROUP_RULES = {
  // --- number（べヒュー・数）---
"ン":"number",
  "マー":"number","イヒ":"number","ツ":"number","レー":"number","ソ":"number",
  "ダラ":"number","ギッ":"number","グウ":"number","デベ":"number","ドオ":"number",

  // --- tyann（チャン・位置・方向）---
  "チャン":"tyann","バサシバサシ":"tyann","チョボ":"tyann","ヘネシヘネシ":"tyann",

  // --- tomuya（トムヤ・象徴）---
  "トムヤ":"tomuya","プッチョ":"tomuya",  "バババ":"tomuya","パロロ":"tomuya","ヘーネ":"tomuya","バーサ":"tomuya",

  // --- yes（テメ・行為）---
  "チケ":"yes","フザケ":"yes","フザケッチ":"yes","カ":"yes","オマ":"yes",
  "テメ":"yes","キキヤーィ":"yes",

  // --- zosan（ゾーサン・音声／システム）---
  "パオ":"zosan","プア":"zosan","パーナ":"zosan","シャーンシャーン":"zosan",  "べヒュー":"zosan",
  "ゾーサン":"zosan","ンシャンシャ":"zosan","ゾーサリーヌ":"zosan","パトゥ":"zosan",

  // 席ラベル（整合のために定義しておく）
  "ウホ":"iti",
  "イザ":"iti",
  "ンマ":"iti",
  "ウット":"iti"
};


// ======== LEX DB（保存先） ========
let LEXDB = {}; // { [tableId]: { seq, groups, terms:[{id,label,note,groupId,firstSeenSeq,origin}] } }
const LEX_FILE = path.join(__dirname, "data", "lexicon.json");

try {
  LEXDB = JSON.parse(await fsp.readFile(LEX_FILE, "utf8"));
} catch {
  LEXDB = {};
}

const saveLEX = async () =>
  fsp.writeFile(LEX_FILE, JSON.stringify(LEXDB, null, 2), "utf8");


// ======== 起動時シード定義 ========
const LEX_SEED_TERMS = [
  { label:"ウット",         groupId:"iti"    }, 
  { label:"ウホ",           groupId:"iti"    }, 
  { label:"イザ",           groupId:"iti"    },
  { label:"ンマ",           groupId:"iti"    },

  { label:"プッチョ",       groupId:"tomuya" },

    { label:"シャーンシャーン", groupId:"zosan"  },
  { label:"ゾーサリーヌ",   groupId:"zosan"  },
  { label:"ゾーサン",       groupId:"zosan"  }, 
  { label:"パトゥ",         groupId:"zosan"  }, 
  { label:"パオ",           groupId:"zosan"    }, 


    { label:"チケ",         groupId:"yes"    }, 
  { label:"フザケ",         groupId:"yes"    }, 
    { label:"フザケッチ",         groupId:"yes"    }, 
    { label:"ナギ",           groupId:"yes"    },
];



// 1ドキュメントを用意
function getLexDoc(tableId) {
  const id  = tableId || "DEFAULT";
  const doc = (LEXDB[id] ||= { seq: 1, groups: { ...LEX_GROUPS_PRESET }, terms: [] });
  doc.groups ||= {};
  for (const [k,v] of Object.entries(LEX_GROUPS_PRESET)) {
    if (!doc.groups[k]) doc.groups[k] = v;
  }
  doc.terms ||= [];
  return doc;
}

// 用語の追加（存在すれば既存を返す）
function ensureTerm(tableId, label, groupIdOpt, origin = "manual") {
  const doc = getLexDoc(tableId);
  const hit = doc.terms.find(t => t.label === label);
  if (hit) return hit;

  const groupId = groupIdOpt || GROUP_RULES[label] || DEFAULT_GROUP_ID;
  const id  = Math.random().toString(36).slice(2,10);
  doc.seq   = (doc.seq || 0) + 1;
  const t   = { id, label, note: "", groupId, firstSeenSeq: doc.seq, origin };
  doc.terms.push(t);
  return t;
}

// 起動時シード投入
async function seedLexicon() {
  const tableId = "DEFAULT";
  const doc = getLexDoc(tableId);
  let added = false;

  for (const { label, groupId } of LEX_SEED_TERMS) {
    if (!doc.terms.some(t => t.label === label)) {
      ensureTerm(tableId, label, groupId, "seed");
      added = true;
    }
  }

  if (added) {
    await saveLEX();
    console.log(`[LEXICON] 初期語彙 ${LEX_SEED_TERMS.length}件を投入しました。`);
  } else {
    console.log(`[LEXICON] 既存 lexicon.json に語彙があるためシード投入はスキップしました。`);
  }
}

// top-level await OK（type:module 前提）
await seedLexicon();


// ======== REST: 語彙ドキュメントを返す ========
app.get("/api/lex/:tableId", (req, res) => {
  const id = String(req.params.tableId || "").trim() || "DEFAULT";
  res.json(getLexDoc(id));
});


// ======== WS: LEX ルーム管理 ========
const LEX_ROOMS = new Map(); // tableId -> Set(ws)

function lexJoin(tableId, ws) {
  getLexDoc(tableId); // 確実に存在させる
  if (!LEX_ROOMS.has(tableId)) LEX_ROOMS.set(tableId, new Set());
  LEX_ROOMS.get(tableId).add(ws);
  ws._lexTableId = tableId;
}

function lexLeave(ws) {
  const id = ws._lexTableId;
  if (id && LEX_ROOMS.has(id)) {
    LEX_ROOMS.get(id).delete(ws);
    if (LEX_ROOMS.get(id).size === 0) LEX_ROOMS.delete(id);
  }
}

function lexBroadcast(tableId, msg, except) {
  const set = LEX_ROOMS.get(tableId);
  if (!set) return;
  const s = JSON.stringify(msg);
  for (const c of set) {
    if (c.readyState === c.OPEN && c !== except) c.send(s);
  }
}


// ======== 既知トークン集合 ＋ テキストから語を拾う ========

// 1) 既知トークン集合の構築
function buildKnownTokenSet() {
  const set = new Set();

  // 盤ラベル
  for (const v of LABELS.cols) set.add(v);
  for (const v of LABELS.rows) set.add(v);

  // 席ラベル（表示名）
  for (const k of Object.keys(SEAT_LABELS)) set.add(SEAT_LABELS[k]);

  // 方向・相対語彙
  for (const k of Object.keys(DIR_ALIASES)) set.add(k);

  // 矢印位置（チャンの3択）
  for (const k of Object.keys(ARROW_CHOICES)) set.add(k);

  // コマンド語
  for (const k of Object.keys(COMMAND_ALIASES)) set.add(k);

  // その他、よく出る固定語
  set.add("ムクン");
  set.add("トムヤムクン");
  set.add("ンシャンシャ");

  return set;
}



// 2) 任意のテキストから既知語を抽出し、初出なら lexicon に登録
async function captureLexFromText(text, tableId = "DEFAULT", origin = "log") {
  const dict = getKnownTokens();
  const hits = new Set();
  const line = String(text || "");

  for (const token of dict) {
    if (token && line.includes(token)) hits.add(token);
  }
  if (hits.size === 0) return;

  const doc = getLexDoc(tableId);
  let changed = false;

  for (const label of hits) {
    if (!doc.terms.some(t => t.label === label)) {
      ensureTerm(tableId, label, GROUP_RULES[label], origin);
      changed = true;
    }
  }

  if (changed) {
    await saveLEX();
    lexBroadcast(tableId, { type:"lex:update", payload: doc });
  }
}


// ======================= ゲーム系 定数・ラベル定義 =======================
const SIZE       = 5;
const SEATS      = ["W", "N", "E", "S"];
const SEAT_ORDER = ["W", "N", "E", "S"];
const STEP_LIMIT = 30;

const OATH_BONUS         = 1;
const OATH_FAIL_PENALTY  = -5;
const REVERSE_ALIASES    = new Set(["パオチャンカパーナ", "ぱおちゃんかぱーな"]);
const OATH_ALIASES       = new Set(["オマフザケンパオ", "おまふざけんぱお"]);
const VOW2X_ALIASES      = new Set(["ププアププア", "ぷぷあぷぷあ"]);

const LABELS = {
  cols: ["マー", "イヒ", "ツ", "レー", "ソ"],
  rows: ["ダラ", "ギッ", "グウ", "デベ", "ドオ"],
};
LABELS.col_alias = {
  A: "マー", B: "イヒ", C: "ツ", D: "レー", E: "ソ",
  "まー": "マー", "いひ": "イヒ", "つ": "ツ", "れー": "レー", "そ": "ソ"
};
LABELS.row_alias = {
  "1": "ダラ", "2": "ギッ", "3": "グウ", "4": "デベ", "5": "ドオ",
  "だら": "ダラ", "ぎっ": "ギッ", "ぐう": "グウ", "でべ": "デベ", "どお": "ドオ"
};

const SEAT_LABELS  = { N: "ウホ", E: "イザ", S: "ンマ", W: "ウット" };
const SEAT_ALIASES = { n: "N", 北: "N", e: "E", 東: "E", s: "S", 南: "S", w: "W", 西: "W" };
SEAT_ALIASES[SEAT_LABELS.N] = "N";
SEAT_ALIASES[SEAT_LABELS.E] = "E";
SEAT_ALIASES[SEAT_LABELS.S] = "S";
SEAT_ALIASES[SEAT_LABELS.W] = "W";

const ARG_ALIASES = {
  launch:  { "パオ ムクン": "pass", "パオムクン": "pass", "ぱお むくん": "pass", "ぱおむくん": "pass" },
  launch2: { "プア ムクン": "pass", "プアムクン": "pass", "ぷあ むくん": "pass", "ぷあむくん": "pass" },
};

const PLACE_PASS_ALIASES = new Set([
  "トムヤムクン", "とむやむくん",
  "ムクン", "むくん",
  "トムヤ ムクン", "トムヤ むくん", "トムヤむくん",
  "とむや ムクン", "とむやムクン",
]);

function resolveSeat(tok) {
  const k = String(tok || "").trim().toLowerCase();
  const v = SEAT_ALIASES[k] || k.toUpperCase();
  if (["N", "E", "S", "W"].includes(v)) return v;
  throw new Error(`オマ ${SEAT_LABELS.N}/${SEAT_LABELS.E}/${SEAT_LABELS.S}/${SEAT_LABELS.W} オメ`);
}
function seatLabel(s) { return SEAT_LABELS[s] || s; }

const DIR_ALIASES = {
  "バババ": "up",    "ばばば": "up",
  "パロロ": "down",  "ぱろろ": "down",
  "バーサ": "left",  "ばーさ": "left",
  "ヘーネ": "right", "へーね": "right",
};
// 値→表示ラベル（DIR / REL / ARROW）
function arrowValToLabel(v) { return ARROW_LABEL_FROM_VALUE[v] || v; }

const DIR_LABELS = (() => {
  const out = {};
  for (const [alias, canon] of Object.entries(DIR_ALIASES)) {
    if (!(canon in out)) out[canon] = alias;
  }
  out.up    = out.up    || "up";
  out.down  = out.down  || "down";
  out.left  = out.left  || "left";
  out.right = out.right || "right";
  return out;
})();
function showDir(dir) { return DIR_LABELS[dir] || dir; }

const ARROW_CHOICES = {
  "バサシバサシ": "left",   "ばさしばさし": "left",
  "チョボ":       "center", "ちょぼ":       "center",
  "ヘネシヘネシ": "right",  "へねしへねし": "right",
};

// ==== 語彙登録ヘルパ：コマンド実行時に初見登録 ====

const COMMAND_ALIASES = {
  "パオ": "launch",  "ぱお": "launch",
  "プア": "launch2", "ぷあ": "launch2",
  "トムヤ": "put",   "とむや": "put",
  "チャン": "arrow", "ちゃん": "arrow",
  "オマ": "seat",    "おま": "seat",
  "ゾーサリーヌ": "name", "ぞーさりーぬ": "name",
};

// 逆引き
const COMMAND_LABEL_FROM_VALUE = (() => {
  const o = {};
  for (const [disp, val] of Object.entries(COMMAND_ALIASES)) {
    if (!(val in o)) o[val] = disp;
  }
  return o;
})();
function cmdValToLabel(v) { return COMMAND_LABEL_FROM_VALUE[v] || v; }

// 相対方向 / 矢印の逆引き
const REL_LABELS = { up: "バババ", down: "パロロ", right: "ヘーネ", left: "バーサ" };
function relToLabel(v) { return REL_LABELS[v] || v; }

const ARROW_LABEL_FROM_VALUE = (() => {
  const o = {};
  for (const [disp, val] of Object.entries(ARROW_CHOICES)) {
    if (!(val in o)) o[val] = disp;
  }
  return o;
})();



function seatRelToAbs(seat, rel) {
  if (seat === "N") return ({ up: "down",  down: "up",   left: "right", right: "left" })[rel] || rel;
  if (seat === "S") return ({ up: "up",    down: "down", left: "left",  right: "right" })[rel] || rel;
  if (seat === "W") return ({ up: "right", down: "left", left: "up",    right: "down" })[rel] || rel;
  if (seat === "E") return ({ up: "left",  down: "right",left: "down",  right: "up" })[rel] || rel;
  return rel;
}



let _KNOWN_TOKENS = null;
function getKnownTokens() {
  if (!_KNOWN_TOKENS) _KNOWN_TOKENS = buildKnownTokenSet();
  return _KNOWN_TOKENS;
}
// --- 1行のログから既知トークンだけ抜き出すヘルパ ---
function lexTokensFromLine(line) {
  const dict = getKnownTokens();   // 既知語セット
  const hits = [];

  const text = String(line || "");
  if (!text) return hits;

  // 「既知語のうち、含まれているもの」を素直に全部拾う
  for (const token of dict) {
    if (token && text.includes(token)) {
      hits.push(token);
    }
  }
  return hits;
}

async function harvestLexFromLogLine(tableId, line) {
  const labels = lexTokensFromLine(line);
  if (!labels.length) return;

  const doc = getLexDoc(tableId);
  let changed = false;

  for (const lb of labels) {
    const label = String(lb || "").trim();
    if (!label) continue;
    if (!doc.terms.some(t => t.label === label)) {
      ensureTerm(tableId, label, GROUP_RULES[label], "log");
      changed = true;
    }
  }

  if (changed) {
    await saveLEX();
    lexBroadcast(tableId, { type: "lex:update", payload: doc });
  }
}


function extractCmdAndRest(raw) {
  const s = String(raw || "");
  const lower = s.toLowerCase();
  const keys = Object.keys(COMMAND_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (lower.startsWith(k.toLowerCase())) {
      return { cmd: COMMAND_ALIASES[k], rest: s.slice(k.length) };
    }
  }
  throw new Error("フザケ テメ");
}


function splitCellAndDir(rem) {
  if (!rem) return null;

  const sp = rem.split(/[\s,.\-_/]+/).filter(Boolean);
  if (sp.length >= 2) return [sp[0], sp.slice(1).join("")];


  for (let i = rem.length; i >= 1; i--) {
    const c = rem.slice(0, i);
    const d = rem.slice(i);
    const xy = cellToXY(c);
    const dir = normalizeDir(d);
    if (xy && DIR_VECT[dir]) return [c, d];
  }
  return null;
}



function norm(s) { return String(s || "").trim().toLowerCase(); }
function resolveCommand(tok) {
  const k = norm(tok);
  const v = COMMAND_ALIASES[k];
  if (!v) throw new Error("フザケ テメ");
  return v;
}
function resolveArg(cmd, tok) {
  if (!tok) return "";
  const tbl = ARG_ALIASES[cmd];
  if (!tbl) return null;
  const v = tbl[norm(tok)];
  return v || null;
}


const DIR_VECT = {
  up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 }
};

const COL_MAP = Object.create(null);
const ROW_MAP = Object.create(null);

function normKey(s) { return String(s || "").trim().toLowerCase(); }

function rebuildLabelMaps() {

  for (const k in COL_MAP) delete COL_MAP[k];
  for (const k in ROW_MAP) delete ROW_MAP[k];


  LABELS.cols.forEach((lab, i) => { COL_MAP[normKey(lab)] = i; });
  LABELS.rows.forEach((lab, i) => { ROW_MAP[normKey(lab)] = i; });


  Object.entries(LABELS.col_alias || {}).forEach(([alias, canon]) => {
    const i = LABELS.cols.indexOf(canon); if (i >= 0) COL_MAP[normKey(alias)] = i;
  });
  Object.entries(LABELS.row_alias || {}).forEach(([alias, canon]) => {
    const i = LABELS.rows.indexOf(canon); if (i >= 0) ROW_MAP[normKey(alias)] = i;
  });
}

rebuildLabelMaps();




function cellToXY(tok) {
  const raw = String(tok || "").trim();
  if (!raw) return null;


  const s = raw.toLowerCase();


  const sp = s.split(/[\s,.\-/_]+/).filter(Boolean);
  if (sp.length === 2) {
    const [a, b] = sp;
    // col,row
    if (a in COL_MAP && b in ROW_MAP) return { x: COL_MAP[a], y: ROW_MAP[b] };
    // row,col
    if (a in ROW_MAP && b in COL_MAP) return { x: COL_MAP[b], y: ROW_MAP[a] };
  }


  const colKeys = Object.keys(COL_MAP).sort((x, y) => y.length - x.length);
  const rowKeys = Object.keys(ROW_MAP).sort((x, y) => y.length - x.length);

  // col-first
  for (const ck of colKeys) {
    if (s.startsWith(ck)) {
      const rest = s.slice(ck.length);
      if (rest in ROW_MAP) return { x: COL_MAP[ck], y: ROW_MAP[rest] };
    }
  }
  // row-first
  for (const rk of rowKeys) {
    if (s.startsWith(rk)) {
      const rest = s.slice(rk.length);
      if (rest in COL_MAP) return { x: COL_MAP[rest], y: ROW_MAP[rk] };
    }
  }

  return null;
}


function xyLabel({ x, y }) { return `${LABELS.cols[x]}${LABELS.rows[y]}`; }


function normalizeDir(tok) {
  const k = String(tok || "").trim().toLowerCase();
  return DIR_ALIASES[k] || null;
}



const EDGE = [0, 2, 4];
const ARW_INDEX = { left: 0, center: 1, right: 2 };

function arrowIndicesForSeat(seat) {

  if (seat === "N") return [4, 2, 0];
  if (seat === "S") return [0, 2, 4];
  if (seat === "W") return [0, 2, 4];
  if (seat === "E") return [4, 2, 0];
  return [0, 2, 4];
}

function arrowXYFor(seat, tok) {
  const key0 = String(tok || "").trim().toLowerCase();
  const key = ARROW_CHOICES[key0];
  if (!key) return null;
  const i = ARW_INDEX[key];
  if (i == null) return null;
  const order = arrowIndicesForSeat(seat);
  if (seat === "N") return { x: order[i], y: 0 };
  if (seat === "S") return { x: order[i], y: SIZE - 1 };
  if (seat === "W") return { x: 0, y: order[i] };
  if (seat === "E") return { x: SIZE - 1, y: order[i] };
}





const state = {
  board: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
  players: {},
  phase: "lobby",
  turnIdx: 0,
  arrows: {},
  logs: [],
  phaseActions: {},
  oath: {},
  vow2x: {},
  reverseActive: false,
  reverseUsed: false,
  lastTurnSeat: null,
};

function resetBoard() {
  state.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  state.arrows = {};
  state.phase = "place1";

  state.turnIdx = 0;
  state.phaseActions = {};
  state.lastTurnSeat = null;
  state.oath = {};
  state.vow2x = {};
  state.reverseActive = false;
  state.reverseUsed = false;
  for (const seat of SEATS) if (state.players[seat]) state.players[seat].score ??= 0;
}
function currentTurnSeat() { return SEAT_ORDER[state.turnIdx]; }
function logTurnNow(force = false) {
  const seat = currentTurnSeat();
  if (!force && state.lastTurnSeat === seat) return;
  state.lastTurnSeat = seat;
  log(`${seatLabel(seat)}【ナギ】`);
}





// function broadcastPlayers(msg){
//   const s = JSON.stringify(msg);
//   for (const seat of SEATS){
//     const p = state.players[seat];
//     if (p && p.ws && p.ws.readyState === p.ws.OPEN){
//       try{ p.ws.send(s); }catch(_){}
//     }
//   }
// }




function seatedSeats() {
  return SEATS.filter(s => !!state.players[s]);
}
function peekTurnSeat() {
  for (let k = 0; k < SEAT_ORDER.length; k++) {
    const s = SEAT_ORDER[(state.turnIdx + k) % SEAT_ORDER.length];
    if (state.players[s]) return s;
  }
  return null;
}
function normalizeTurnIdx() {
  for (let k = 0; k < SEAT_ORDER.length; k++) {
    const s = SEAT_ORDER[state.turnIdx];
    if (state.players[s]) return;
    state.turnIdx = (state.turnIdx + 1) % SEAT_ORDER.length;
  }
}


function snapshot() {
  return {
    board: state.board,
    phase: state.phase,
    turnSeat: SEAT_ORDER[state.turnIdx] ?? null,
    arrows: state.arrows,
    reverseActive: state.reverseActive,
    labels: { cols: LABELS.cols, rows: LABELS.rows },
    seatLabels: SEAT_LABELS,
    players: Object.fromEntries(SEATS.map(seat => {
      const p = state.players[seat];
      return [seat, p ? { name: p.name ?? seat, score: p.score ?? 0 } : null];
    })),
    logs: state.logs.slice(-120),
    logEnd: state.logs.length
  };
}



function maybeStartGame() {
  if (everyoneSeated() && state.phase === "lobby") {
    resetBoard();
    log("— ダラ  (トムヤ オメ) —");
    logTurnNow(true);
    broadcastAll({ type: "state", data: snapshot() });
    return true;
  }
  return false;
}
const LEX_TABLE = "DEFAULT";  // 既に定義済みなら流用

function log(line, opts = {}) {
  const s = String(line);

  // logs に push するオブジェクトを変更
  const entry = {
    text: s,
    bold: !!opts.bold,  // ← 特定ログだけ true
    type: opts.type || null,
  };

  console.log(s);
  state.logs.push(entry);

  broadcastAll({ type: "logLine", entry });

  harvestLexFromLogLine(LEX_TABLE, s).catch(e =>
    console.error("harvestLexFromLogLine error:", e)
  );
}



function seatInUse(seat) { return !!state.players[seat]; }

function everyoneSeated() {
  return SEATS.every(seat => !!state.players[seat]);
}

function nextTurnSeat(seat) {
  const i = SEATS.indexOf(seat);
  return SEATS[(i + 1) % SEATS.length];
}
function advanceTurn() {
  state.turnIdx = (state.turnIdx + 1) % SEAT_ORDER.length;
  state.lastTurnAt = Date.now();
  broadcastAll({ type: "state", data: snapshot() });
}





function seatToInward(seat) {

  if (seat === "N") return DIR_VECT.down;
  if (seat === "S") return DIR_VECT.up;
  if (seat === "E") return DIR_VECT.left;
  if (seat === "W") return DIR_VECT.right;
}

function isEdgeCellOfSeat(seat, { x, y }) {
  if (seat === "N") return y === 0;
  if (seat === "S") return y === SIZE - 1;
  if (seat === "W") return x === 0;
  if (seat === "E") return x === SIZE - 1;
  return false;
}

function exitSeatForOutOfBounds(x, y) {
  if (y < 0) return "N";
  if (y >= SIZE) return "S";
  if (x < 0) return "W";
  if (x >= SIZE) return "E";
  return null;
}

function tryReverseDeclaration(seat, text) {
  const joined = String(text || "").replace(/[!\s]+/g, '').toLowerCase();
  if (!REVERSE_ALIASES.has(joined)) return false;
  if (state.phase !== "launch") throw new Error("フザケ パオチャンカパーナ ナギ");
  if (state.reverseUsed) throw new Error("フザケ ギッ パオチャンカパーナ");

  state.reverseActive = true;
  state.reverseUsed = true;
  log(`${seatLabel(seat)}: パオチャンカパーナ !!!!!`);
  broadcastAll({ type: "state", data: snapshot() });


  setTimeout(() => {
    try {
      handleLaunchCommon(seat, "launch");
    } catch (e) {

      const msg = String(e && e.message || e);
      if (state.players[seat]?.ws) {
        state.players[seat].ws.send(JSON.stringify({ type: "error", message: msg }));
      }
    }
  }, 1000);

  return true;
}

function traceAnimal(seat, mode = "launch") {
  const start = state.arrows[seat];
  if (!start) return { path: [], exit: "none", bends: 0, reason: "no_start" };

  let { dx, dy } = seatToInward(seat);
  let x = start.x, y = start.y;

  const seenStates = new Set();
  const path = [];
  let bends = 0;
  let seenPieces = 0;

  // === スタート位置の下にある駒を評価（ここも「遭遇」に含める）===
  {
    const under = state.board[y]?.[x];
    if (under) {
      if (mode === "launch2") {
        // 遭遇カウントのみ増やす。偶数遭遇のときだけ向き変更。
        seenPieces++;
        if (seenPieces % 2 === 0) {
          let v = DIR_VECT[under.dir];
          if (state.reverseActive) v = { dx: -v.dx, dy: -v.dy };
          if (v.dx !== dx || v.dy !== dy) bends++;
          dx = v.dx; dy = v.dy;
        }
      } else {
        // 通常のパオは必ず向きを拾う
        let v = DIR_VECT[under.dir];
        if (state.reverseActive) v = { dx: -v.dx, dy: -v.dy };
        if (v.dx !== dx || v.dy !== dy) bends++;
        dx = v.dx; dy = v.dy;
      }
    }
  }

  // 最初の1歩
  x += dx; y += dy;

  for (let stepIdx = 1; stepIdx <= STEP_LIMIT; stepIdx++) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) {
      const out = exitSeatForOutOfBounds(x, y);
      return { path, exit: out, bends, reason: "exit" };
    }

    path.push({ x, y });

    const cell = state.board[y][x];
    if (cell) {
      if (mode === "launch2") {
        // 盤内での遭遇も継続カウント。偶数遭遇で方向反映。
        seenPieces++;
        if (seenPieces % 2 === 0) {
          let v = DIR_VECT[cell.dir];
          if (state.reverseActive) v = { dx: -v.dx, dy: -v.dy };
          if (v.dx !== dx || v.dy !== dy) bends++;
          dx = v.dx; dy = v.dy;
        }
      } else {
        let v = DIR_VECT[cell.dir];
        if (state.reverseActive) v = { dx: -v.dx, dy: -v.dy };
        if (v.dx !== dx || v.dy !== dy) bends++;
        dx = v.dx; dy = v.dy;
      }
    }

    const key = `${x},${y},${dx},${dy}`;
    if (seenStates.has(key)) return { path, exit: "loop", bends, reason: "cycle" };
    seenStates.add(key);

    x += dx; y += dy;
  }
  return { path, exit: "loop", bends, reason: "step_limit" };
}




function allTurnsDoneForPhase(targetPhase) {

  if (targetPhase === "place1") {
    let count = 0; for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (state.board[y][x]) count++;
    return count >= 4;
  }
  if (targetPhase === "arrow") {
    return SEATS.every(seat => !!state.players[seat]) && Object.keys(state.arrows).length >= 4;
  }
  if (targetPhase === "place2") {
    let count = 0; for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (state.board[y][x]) count++;
    return count >= 8;
  }
  return false;
}

function markDone(seat) { state.phaseActions[seat] = true; }
function placePhaseDone() {
  const seated = seatedSeats();
  if (seated.length === 0) return false;
  return seated.every(s => !!state.phaseActions[s]);
}

function tryAdvancePhase() {
  let changed = false;
  if (state.phase === "place1" && placePhaseDone()) {
    state.phase = "arrow"; state.turnIdx = 0; state.phaseActions = {};
    log("— ギッ  (チャン オメ) —");
    logTurnNow(true);
    changed = true;
  } else if (state.phase === "arrow") {
    const seated = seatedSeats();
    const allSet = seated.length > 0 && seated.every(s => !!state.arrows[s]);
    if (allSet) {
      state.phase = "place2"; state.turnIdx = 0; state.phaseActions = {};
      log("— グウ  (トムヤ オメ) —");
      logTurnNow();
      changed = true;
    }
  } else if (state.phase === "place2" && placePhaseDone()) {
    state.phase = "launch"; state.turnIdx = 0;
    log("— デベ  (パオ オメ) —");
    logTurnNow();
    changed = true;
  }
  broadcastAll({ type: "state", data: snapshot() });
  return changed;
}

function assertTurn(seat) {
  const need = SEAT_ORDER[state.turnIdx];
  if (seat !== need) throw new Error(`${seatLabel(need)} オメ ナギ`);
}

function normalizeInput(text) {
  return String(text || "")
    .replace(/\u3000/g, " ")  // 全角スペース → 半角
    .replace(/\s+/g, " ")     // 連続スペースを 1 個に
    .trim();
}

function makeJoinedKey(text) {
  return normalizeInput(text).replace(/\s+/g, "").toLowerCase();
}

// トムヤの引数パース
// rest: ["イヒギッバババ"] でも ["イヒギッ", "バババ"] でもOK
function parsePutArgs(rest) {
  const raw = (rest || []).join("");             // ["イヒギッ","バババ"] → "イヒギッバババ"
  const s = raw.replace(/[\s\u3000]+/g, "").trim();
  if (!s) {
    throw new Error("フザケ トムヤ");
  }

  let dirTok = null;
  for (const label of Object.keys(DIR_ALIASES)) {
    if (s.endsWith(label)) {
      dirTok = label;
      break;
    }
  }
  if (!dirTok) {
    throw new Error("フザケ トムヤ (バババ/パロロ/ヘーネ/バーサ) オメ");
  }

  const cellTok = s.slice(0, s.length - dirTok.length);
  if (!cellTok) {
    throw new Error("フザケ べヒュー");
  }
  return { cellTok, dirTok };
}

function onCommand(seat, raw) {
  const norm  = normalizeInput(raw);
  if (!norm) throw new Error("テメ ナギ オメ");

  const parts = norm.split(" ");
  const cmdTok = parts[0];
  const rest   = parts.slice(1);

  const cmd = COMMAND_ALIASES[cmdTok] || cmdTok;  // "チャン" → "arrow" など
  const joined = makeJoinedKey(raw);              // oath / vow / pass 用


  // ===== オマフザケンパオ（誓い） =====
  if (OATH_ALIASES.has(joined)) {
    if (state.phase !== "arrow")         throw new Error("フザケ オマフザケンパオ ナギ");
    if (state.arrows[seat])             throw new Error("フザケ オマフザケンパオ ナギ(チャン ナギ)");
    if (state.oath[seat]?.active)       throw new Error("フザケ ギッ オマフザケンパオ");

    state.oath[seat] = { active: true, hits: 0 };
log(`${seatLabel(seat)}: オマ フザケ ン パオ`, { bold: true });

    broadcastAll({ type: "state", data: snapshot() });
    return;
  }

  // ===== ププアププア（2倍誓い） =====
  if (VOW2X_ALIASES.has(joined)) {
    if (state.phase !== "arrow")          throw new Error("フザケ ププアププア ナギ");
    if (state.arrows[seat])              throw new Error("フザケ ププアププア ナギ(チャン ナギ)");
    if (state.vow2x[seat]?.active)       throw new Error("フザケ ギッ ププアププア");

    state.vow2x[seat] = { active: true };
log(`${seatLabel(seat)}: ププアププア`, { bold: true });

    broadcastAll({ type: "state", data: snapshot() });
    return;
  }

  // ===== トムヤ ムクン（置きパス） =====
  if (PLACE_PASS_ALIASES.has(joined)) {
    if (!(state.phase === "place1" || state.phase === "place2"))
      throw new Error("フザケ ムクン ナギ");

    assertTurn(seat);
    log(`${seatLabel(seat)}: トムヤ ムクン`);
    markDone(seat);
    advanceTurn();
    if (!tryAdvancePhase()) logTurnNow();
    return;
  }

  // ===== cmd 分岐 =====

  // --- 矢印（チャン） ---
  if (cmd === "arrow") {
    if (state.phase !== "arrow") throw new Error("フザケ チャン ナギ");
    assertTurn(seat);
    if (state.arrows[seat]) throw new Error("フザケ イヒ チャン");

    const tok = parts[1];          // バサシバサシ／チョボ／ヘネシヘネシ（ひらがなでもOK）
    if (!tok) throw new Error("フザケ チャン ン ベヒュー");

    const arrowVal = ARROW_CHOICES[tok];   // "左" 系を left/center/right に正規化
    if (!arrowVal) {
      throw new Error("フザケ べヒュー チャン (バサシバサシ/チョボ/ヘネシヘネシ)");
    }

    // 安全側で tok のまま渡す
    const xy = arrowXYFor(seat, tok);
    if (!xy) {
      throw new Error("フザケ べヒュー チャン (バサシバサシ/チョボ/ヘネシヘネシ)");
    }

    state.arrows[seat] = xy;

    // ログの表示をカタカナ代表表記に統一
    const cmdLabel   = cmdValToLabel(cmd);         // "arrow" → "チャン"
    const arrowLabel = arrowValToLabel(arrowVal);  // "left" → "バサシバサシ" など

    log(`${seatLabel(seat)}: ${cmdLabel} ${arrowLabel}`);

    advanceTurn();
    if (!tryAdvancePhase()) logTurnNow();
    return;
  }

  // --- トムヤ置き ---
  if (cmd === "put") {
    if (!(state.phase === "place1" || state.phase === "place2")) {
      throw new Error("フザケ プッチョ ナギ");
    }
    assertTurn(seat);

    const { cellTok, dirTok } = parsePutArgs(rest);   // ← rest を渡せば中で正規化してくれる
    const xy = cellToXY(cellTok);
    if (!xy) throw new Error("フザケ べヒュー");
    if (state.board[xy.y][xy.x]) throw new Error("フザケ べヒュー プッチョトムヤ");

    const rel = normalizeDir(dirTok);
    if (!DIR_VECT[rel]) throw new Error("フザケ トムヤ (バババ/パロロ/ヘーネ/バーサ) オメ");

    const abs = seatRelToAbs(seat, rel);

    state.board[xy.y][xy.x] = { dir: abs, owner: seat };
    log(`${seatLabel(seat)}: トムヤ ${xyLabel(xy)} ${relToLabel(rel)}`);

    markDone(seat);
    advanceTurn();
    if (!tryAdvancePhase()) logTurnNow();
    return;
  }

  // --- 発射 ---
  if (cmd === "launch")  { handleLaunchCommon(seat, "launch",  parts[1]); return; }
  if (cmd === "launch2") { handleLaunchCommon(seat, "launch2", parts[1]); return; }

  // --- トムヤ回収 ---
  if (cmd === "pickup" || cmd === "take" || cmd === "remove") {
    if (!(state.phase === "place1" || state.phase === "place2")) throw new Error("フザケ ムクン ナギ");
    assertTurn(seat);

    const xy = cellToXY(parts[1]);
    if (!xy) throw new Error("フザケ べヒュー");
    const c = state.board[xy.y][xy.x];
    if (!c) throw new Error("フザケ トムヤ ");
    if (c.owner !== seat) throw new Error("フザケ オマ トムヤ ムクン オメ");

    state.board[xy.y][xy.x] = null;
    log(`${seatLabel(seat)}: ペピピ ${parts[1].toUpperCase()}`);

    markDone(seat);
    advanceTurn();
    if (!tryAdvancePhase()) logTurnNow();
    return;
  }

  throw new Error("フザケ テメ");
}

function addScore(seat, delta){
  if (!state.players[seat]) return;
  if (state.players[seat].score == null) state.players[seat].score = 1;
  state.players[seat].score += delta;
}
function handleLaunchCommon(seat, mode, arg) {
  if (state.phase !== "launch") throw new Error("フザケ パオ ナギ");
  assertTurn(seat);

  log(`${seatLabel(seat)}【ナギ】`);
  log(`${seatLabel(seat)}: ${mode === "launch" ? "パオ" : "プア"}`);

  const a = resolveArg(mode, arg);
  if (a === "pass") {
    log(`${seatLabel(seat)}: ${mode === "launch" ? "パオ" : "プア"} ムクン`);
    if (state.vow2x[seat]?.active) {
      state.vow2x[seat].active = false;
      log(`${seatLabel(seat)}: ププアププア ナギ`);
    }
    advanceTurn();
    if (state.turnIdx === 0) {
      state.phase = "end";
      log("— ンシャンシャ —");
    } else {
      logTurnNow();
    }
    broadcastAll({ type: "state", data: snapshot() });
    return;
  }

  if (mode === "launch" && state.vow2x[seat]?.active) {
    throw new Error("フザケ パオ : ププアププア ナギ");
  }
  if (arg) throw new Error("フザケ オマパトゥ");
  if (!state.arrows[seat]) throw new Error("フザケ チャン オメ");

  const { path: travelPath, exit, bends } = traceAnimal(seat, mode);

  // 基本点：曲がり回数+1（ループだけは固定扱い 5）
  let base = (exit === "loop") ? 5 : (bends + 1);

  // 2倍宣言（プア専用）
  if (mode === "launch2" && state.vow2x[seat]?.active) {
    base *= 2;
    log(`${seatLabel(seat)}: ププアププア イヒ`);
    state.vow2x[seat].active = false;
  }

  // スコア反映（一本化）
  if (exit === "loop") {
    // ループは撃った本人が -base
    addScore(seat, -base);
    log(`→ フザケッチ トムヤ${bends} ゾーサン-${base}`);
  } else if (["N", "E", "S", "W"].includes(exit)) {
    if (exit === seat) {
      // 自分へ帰還：自分が +base
      addScore(seat, +base);
      log(`→ ${seatLabel(exit)} トムヤ${bends} ゾーサン+${base}`);
    } else {
      // 相手に命中：命中“した相手”が -base
      addScore(exit, -base);
      log(`→ ${seatLabel(exit)} トムヤ${bends} ゾーサン-${base}`);
    }
  }

  // 経路通知（誰が減点かは exit で分かるので scoreDelta は送らない）
  broadcastAll({ type: "path", seat, path: travelPath, exit, scoreDelta: null, bends, mode });

  // 誓い：命中側（= exit）を見る
  if (["N", "E", "S", "W"].includes(exit)) {
    const o = state.oath[exit];
    if (o && o.active) {
      o.hits = (o.hits || 0) + 1;
      state.players[exit].score = (state.players[exit].score || 0) + OATH_BONUS;
      log(`${seatLabel(exit)}: パーナ +${OATH_BONUS}`);
    }
  }

  advanceTurn();
  if (state.turnIdx === 0) {
    for (const s of SEATS) {
      const o = state.oath[s];
      if (o && o.active) {
        if (!o.hits) {
          state.players[s].score = (state.players[s].score || 0) + OATH_FAIL_PENALTY;
          log(`${seatLabel(s)}: フザケ パオ チャン カ パーナ ${OATH_FAIL_PENALTY}`);
        }
        o.active = false;
      }
    }
    state.phase = "end";
    log("— ンシャンシャ —");
  } else {
    logTurnNow();
  }

  broadcastAll({ type: "state", data: snapshot() });
}




function hardReset() {
  state.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  state.arrows = {};
  state.phase = "lobby";
  state.turnIdx = 0;
  state.logs = [];
  state.phaseActions = {};
  state.players = {};


  state.reverseActive = false;
  state.reverseUsed = false;

  broadcastAll({ type: "you", seat: null });
  log("— シャーンシャーン —");
  broadcastAll({ type: "state", data: snapshot() });
  state.lastTurnSeat = null;
}

const RECONNECT_GRACE_MS = 15000;
const ghosts = new Map();
const CLOSE_GRACE_MS = 4000;
const pendingCloseTimers = new Map();

// 共有メモのルーム管理（トップレベルに置く）
const MEMO_ROOMS = new Map(); // tableId -> Set(ws)
function memoJoin(tableId, ws) {
  if (!MEMO_ROOMS.has(tableId)) MEMO_ROOMS.set(tableId, new Set());
  MEMO_ROOMS.get(tableId).add(ws);
  ws._memoTableId = tableId;
}
function memoLeave(ws) {
  const id = ws._memoTableId;
  if (id && MEMO_ROOMS.has(id)) {
    MEMO_ROOMS.get(id).delete(ws);
    if (MEMO_ROOMS.get(id).size === 0) MEMO_ROOMS.delete(id);
  }
}
function memoBroadcast(tableId, msg, except) {
  const set = MEMO_ROOMS.get(tableId);
  if (!set) return;
  const s = JSON.stringify(msg);
  for (const c of set) if (c.readyState === c.OPEN && c !== except) c.send(s);
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  const id = Math.random().toString(36).slice(2, 8);
  let mySeat = null;
  let myName = id;
  let pendingSeat = null;
  let myCid = null;
  let dcTimer = null;

  ws.send(JSON.stringify({ type: "state", data: snapshot() }));
  ws.send(JSON.stringify({ type: "hello", id }));

  // ================== message ハンドラ ==================
  ws.on("message", async (buf) => {
    let m;
    try {
      m = JSON.parse(String(buf));
    } catch {
      return;
    }

    try {
      // ===================== LEX（語彙テーブル） =====================
      // 参加（初期状態を返す）
      if (m.type === "lex:join") {
        const tableId = String(m.tableId || "").trim() || "DEFAULT";
        lexJoin(tableId, ws);
        ws.send(JSON.stringify({ type: "lex:init", payload: getLexDoc(tableId) }));
        return;
      }

      // 追加（手動・起動シード・ログ初出）※groupId は任意
      if (m.type === "lex:add" || m.type === "lex:seen") {
        const tableId = ws._lexTableId || String(m.tableId || "").trim() || "DEFAULT";
        const label   = String(m.label || "").trim();
        const groupId = m.groupId ? String(m.groupId) : undefined;
        if (!label) return;

        const doc    = getLexDoc(tableId);
        const before = doc.terms.length;
        ensureTerm(tableId, label, groupId);
        if (doc.terms.length !== before) {
          await saveLEX();
          // 自分以外へ配信（自分はローカルで即時反映している想定）
          lexBroadcast(tableId, { type: "lex:update", payload: doc }, ws);
        }
        return;
      }

      // ノート更新（右セル）
      if (m.type === "lex:updateNote") {
        const tableId = ws._lexTableId || "DEFAULT";
        const doc = getLexDoc(tableId);
        const id  = String(m.id || "");
        const t   = doc.terms.find(x => x.id === id);
        if (!t) return;
        t.note = String(m.note || "");
        await saveLEX();
        lexBroadcast(tableId, { type: "lex:update", payload: doc }, ws);
        return;
      }

      // グループ色変更
      if (m.type === "lex:setGroupColor") {
        const tableId = ws._lexTableId || "DEFAULT";
        const doc   = getLexDoc(tableId);
        const gid   = String(m.groupId || "");
        const color = String(m.color || "").trim();
        if (!doc.groups[gid] || !color) return;
        doc.groups[gid].color = color;
        await saveLEX();
        lexBroadcast(tableId, { type: "lex:update", payload: doc }, ws);
        return;
      }

      // 単語の所属グループ変更
      if (m.type === "lex:setGroup") {
        const tableId = ws._lexTableId || "DEFAULT";
        const doc = getLexDoc(tableId);
        const id  = String(m.id || "");
        const gid = String(m.groupId || "");
        const t   = doc.terms.find(x => x.id === id);
        if (!t || !doc.groups[gid]) return;
        t.groupId = gid;
        await saveLEX();
        lexBroadcast(tableId, { type: "lex:update", payload: doc }, ws);
        return;
      }

      // ===================== MEMO（共有メモ） =====================
      if (m.type === "memo:join") {
        const tableId = String(m.tableId || "").trim() || "DEFAULT";
        memoJoin(tableId, ws);
        if (!MEMODB[tableId]) {
          MEMODB[tableId] = { text: "", updatedAt: new Date().toISOString() };
        }
        ws.send(JSON.stringify({ type: "memo:init", payload: MEMODB[tableId] }));
        return;
      }

      if (m.type === "memo:patch") {
        const tableId = ws._memoTableId;
        if (!tableId) return; // join 前
        const text = String(m.text || "");
        MEMODB[tableId] = { text, updatedAt: new Date().toISOString() };
        await saveMemoDB();
        memoBroadcast(tableId, { type: "memo:update", payload: MEMODB[tableId] }, ws);
        return;
      }

      // ===================== セッション復帰 =====================
      if (m.type === "resume") {
        myCid = String(m.cid || "").slice(0, 64);

        let found = null;
        for (const s of SEATS) {
          const p = state.players[s];
          if (p && p.cid === myCid) { found = s; break; }
        }

        if (found) {
          const g = ghosts.get(myCid);
          if (g) { clearTimeout(g.timer); ghosts.delete(myCid); }

          mySeat = found;
          state.players[mySeat].ws = ws;

          ws.send(JSON.stringify({ type: "you", seat: mySeat }));
          broadcastAll({ type: "state", data: snapshot() });
        }
        return;
      }

      // ===================== ゲームユーティリティ =====================
      if (m.type === "resetGame") {
        for (const s of SEATS) if (state.players[s]) state.players[s].score = 0;

        if (!everyoneSeated()) {
          // ロビーに戻すだけ
          state.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
          state.arrows = {};
          state.phaseActions = {};
          state.turnIdx = 0;
          state.reverseActive = false;
          state.reverseUsed = false;
          state.lastTurnSeat = null;
          state.phase = "lobby";

          log("— パオシャーンシャーン —");
          broadcastAll({ type: "state", data: snapshot() });
          return;
        }

        resetBoard();
        log("— パオシャーンシャーン —");
        logTurnNow(true);
        broadcastAll({ type: "state", data: snapshot() });
        return;
      }

      // ===================== プレイヤー基本操作 =====================
      if (m.type === "name") {
        myName = String(m.name || "").slice(0, 20) || myName;
        if (mySeat && state.players[mySeat]) state.players[mySeat].name = myName;
        broadcastAll({ type: "state", data: snapshot() });
        return;
      }

      if (m.type === "seat") {
        const want = resolveSeat(m.seat);
        if (!SEATS.includes(want)) {
          throw new Error(`オマ ${SEAT_LABELS.N}/${SEAT_LABELS.E}/${SEAT_LABELS.S}/${SEAT_LABELS.W} `);
        }

        // 同じ席へ再入室（ソケット差し替え）
        if (mySeat === want && state.players[want]) {
          state.players[want].ws = ws;
          ws.send(JSON.stringify({ type: "you", seat: mySeat }));
          broadcastAll({ type: "state", data: snapshot() });
          maybeStartGame();
          return;
        }

        // 既占有席
        if (seatInUse(want)) {
          const p = state.players[want];
          if (!p) throw new Error("フザケ オマ");

          // 同一CIDなら奪還可
          if (p.cid === (myCid || "")) {
            mySeat = want;
            myName = p.name || myName;
            if (p.dcTimer) { clearTimeout(p.dcTimer); delete p.dcTimer; }
            p.ws = ws;
            p.disconnectedAt = null;
            ws.send(JSON.stringify({ type: "you", seat: mySeat }));
            broadcastAll({ type: "state", data: snapshot() });
            return;
          }

          // 一時切断猶予中
          if (!p.ws && p.disconnectedAt && Date.now() - p.disconnectedAt < RECONNECT_GRACE_MS) {
            throw new Error("フザケ オマ（再接続待ち）");
          }

          throw new Error("フザケ オマ");
        }

        // 席移動：前席を開放
        if (mySeat && mySeat !== want) {
          const prev = mySeat;
          const prevName = state.players[prev]?.name || myName || "";
          delete state.players[prev];
          log(`${seatLabel(prev)}: ${prevName} ペピピ オマ`);
        }

        mySeat = want;
        state.players[mySeat] = {
          id,
          cid: myCid || id,
          name: myName,
          ws,
          score: 0,
        };

        log(`${seatLabel(mySeat)}: ${myName} プッチョオマ`);

        ws.send(JSON.stringify({ type: "you", seat: mySeat }));
        broadcastAll({ type: "state", data: snapshot() });
        maybeStartGame();

        if (state.phase !== "lobby" && SEAT_ORDER[state.turnIdx] === mySeat) {
          logTurnNow(true);
          broadcastAll({ type: "state", data: snapshot() });
        }
        return;
      }

      // コマンド（ゲーム入力）
      if (m.type === "cmd") {
        if (!mySeat) throw new Error("シャーンシャーン オマ オメ");
        onCommand(mySeat, m.text || "");
        ws.send(JSON.stringify({ type: "ok", for: "cmd" }));
        return;
      }

      // ログ取得
      if (m.type === "logs") {
        const end   = Math.max(0, Math.min(state.logs.length, Number(m.end) || 0));
        const limit = Math.max(1, Math.min(200, Number(m.limit) || 120));
        const start = Math.max(0, end - limit);
        const lines = state.logs.slice(start, end);
        ws.send(JSON.stringify({ type: "logs", start, end, total: state.logs.length, lines }));
        return;
      }

      // 全面リセット
      if (m.type === "reset") {
        hardReset();
        return;
      }

    } catch (err) {
      // ★ エラーメッセージから語彙抽出
      await captureLexFromText(String(err.message || err));
      ws.send(JSON.stringify({
        type: "error",
        message: String(err.message || err)
      }));
    }
  }); // ← ここで ws.on("message") を閉じるのがポイント

  // ================== close ハンドラ ==================
  ws.on("close", () => {
    if (!mySeat) return;
    lexLeave(ws);
    memoLeave(ws);
    const seat = mySeat;
    const info = state.players[seat];
    const cidKey = info?.cid;

    if (info) {
      info.disconnectedAt = Date.now();
      info.ws = null;
    }

    const timer = setTimeout(() => {
      const p = state.players[seat];
      const stillWaiting =
        p && p.ws == null && p.disconnectedAt &&
        (Date.now() - p.disconnectedAt >= CLOSE_GRACE_MS);
      if (stillWaiting) {
        const name = p?.name || "";
        log(`${seatLabel(seat)}: ${name ? name + " " : ""}ぺピピ オマ`);
        delete state.players[seat];
        delete state.arrows[seat];
        delete state.phaseActions[seat];
        broadcastAll({ type: "state", data: snapshot() });
      }
      if (cidKey) pendingCloseTimers.delete(cidKey);
    }, CLOSE_GRACE_MS);

    if (cidKey) pendingCloseTimers.set(cidKey, timer);

    mySeat = null;
  });
});
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch { }
  });
}, 30000);

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("uncaughtException", (e) => {
  console.error("uncaughtException:", e);
  process.exit(1);
});

const PORT = process.env.PORT || 8080;

// ★ healthz はここで定義してしまってOK（listen より前ならどこでもいい）
app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

// ★ 起動処理をひとまとめ
async function boot() {
  // data ディレクトリの確保
  await fsp.mkdir(path.join(__dirname, "data"), { recursive: true }).catch(() => {});

  // シードが必要ならここで待つ
  await seedLexicon();

  // ★ listen はここで一回だけ
  server.listen(PORT, () => {
    console.log(`listening on http://localhost:${PORT}`, "NODE_ENV=", process.env.NODE_ENV);
  });

  server.on("error", (e) => console.error("listen error:", e));
}

boot().catch((e) => {
  console.error("boot error:", e);
  process.exit(1);
});
