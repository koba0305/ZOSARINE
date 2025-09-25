import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const SIZE = 5;
const SEATS = ["N","E","S","W"];
const SEAT_ORDER = ["N","E","S","W"];
const STEP_LIMIT = 30;

// --- OMA-FUZAKE-N-PAO（誓い） ---
const OATH_BONUS = 2;          // 象が来た回数 × 追加点
const OATH_FAIL_PENALTY = -5; // 1回も来なかったら

// --- パオチャンカパーナ（方向反転 & 自動launch） ---
const REVERSE_ALIASES = new Set(["パオチャンカパーナ","ぱおちゃんかぱーな"]);


const OATH_ALIASES = new Set([
  "オマフザケンパオ",
  "おまふざけんぱお"
]);
const VOW2X_ALIASES = new Set(["ププアププア","ぷぷあぷぷあ"]);

// ====== 可変語彙テーブル（ここだけ書き換えればOK） ======
// 盤ラベル（表示＆入力の正準）
const LABELS = {
  cols: ["マー","イヒ","ツ","レー","ソ"],
  rows: ["ダラ","ギッ","グウ","デベ","ドオ"],
};
LABELS.col_alias = {
  A:"マー", B:"イヒ", C:"ツ", D:"レー", E:"ソ",
  "まー":"マー","いひ":"イヒ","つ":"ツ","れー":"レー","そ":"ソ"
};
LABELS.row_alias = {
  "1":"ダラ","2":"ギッ","3":"グウ","4":"デベ","5":"ドオ",
  "だら":"ダラ","ぎっ":"ギッ","ぐう":"グウ","でべ":"デベ","どお":"ドオ"
};

// 席ラベル（表示用）
const SEAT_LABELS = { N:"ウホ", E:"イザ", S:"ンマ", W:"ウット" };
const SEAT_ALIASES = { n:"N", 北:"N", e:"E", 東:"E", s:"S", 南:"S", w:"W", 西:"W" }; // 入力→正準
SEAT_ALIASES[SEAT_LABELS.N] = "N";
SEAT_ALIASES[SEAT_LABELS.E] = "E";
SEAT_ALIASES[SEAT_LABELS.S] = "S";
SEAT_ALIASES[SEAT_LABELS.W] = "W";
// コマンド引数の別名（無ければ空でOK）
const ARG_ALIASES = {
   launch:  { "パオ ムクン": "pass", "パオムクン":"pass", "ぱお むくん":"pass", "ぱおむくん":"pass"  },
   launch2: { "プア ムクン": "pass", "プアムクン":"pass", "ぷあ むくん":"pass", "ぷあむくん":"pass" },
};


const PLACE_PASS_ALIASES = new Set([
  "トムヤムクン", "とむやむくん",
  "ムクン", "むくん",
  "トムヤ ムクン","トムヤ むくん","トムヤむくん",
  "とむや ムクン","とむやムクン",      
]);


function resolveSeat(tok){
  const k = String(tok||"").trim().toLowerCase();
  const v = SEAT_ALIASES[k] || (k.toUpperCase());
  if (["N","E","S","W"].includes(v)) return v;
  throw new Error(`オマ ${SEAT_LABELS.N}/${SEAT_LABELS.E}/${SEAT_LABELS.S}/${SEAT_LABELS.W} オメ`);
}
function seatLabel(s){ return SEAT_LABELS[s] || s; } // ← 表示用ユーティリティ




// コマの向き（put用）: 上下左右の別名 → "up|down|left|right"（※矢印とは別テーブル）
const DIR_ALIASES = {
  "バババ":"up",   "ばばば":"up",  
  "パロロ":"down", "ぱろろ":"down",
  "バーサ":"left", "ばーさ":"left",
  "ヘーネ":"right","へーね":"right",
};

const REL_LABELS = { up:"バババ", down:"パロロ", right:"ヘーネ", left:"バーサ" };
function showRel(rel){ return REL_LABELS[rel] || rel; }
// 表示用：正規方向 → あなたの語彙（例: up→バババ）
const DIR_LABELS = (() => {
  const out = {};
  for (const [alias, canon] of Object.entries(DIR_ALIASES)) {
    if (!(canon in out)) out[canon] = alias; // 最初に見つけた別名を採用
  }
  // 保険（未定義でも落ちないように）
  out.up    = out.up    || "up";
  out.down  = out.down  || "down";
  out.left  = out.left  || "left";
  out.right = out.right || "right";
  return out;
})();
function showDir(dir){ return DIR_LABELS[dir] || dir; }


// 矢印フェーズの三択（※方向語彙とは別！）
const ARROW_CHOICES = {
  "バサシバサシ":"left",  "ばさしばさし":"left",
  "チョボ":"center",      "ちょぼ":"center",
  "ヘネシヘネシ":"right", "へねしへねし":"right",
};

const COMMAND_ALIASES = {
  "パオ":"launch",     "ぱお":"launch",
  "プア":"launch2",    "ぷあ":"launch2",

  "トムヤ":"put",   "とむや":"put",
 // "プッチョ":"put",   "ぷっちょ":"put",
  "ペピピ":"pickup",   "ぺぴぴ":"pickup",
  "チャン":"arrow",    "ちゃん":"arrow",

  "オマ":"seat",       "おま":"seat",
  "ゾーサリーヌ":"name","ぞーさりーぬ":"name",
};



function seatRelToAbs(seat, rel){
  if (seat==="N") return ({up:"down", down:"up", left:"right", right:"left"})[rel] || rel;
  if (seat==="S") return ({up:"up",   down:"down", left:"left", right:"right"})[rel] || rel;
  if (seat==="W") return ({up:"right",down:"left", left:"up",    right:"down"})[rel] || rel;
  if (seat==="E") return ({up:"left", down:"right",left:"down",  right:"up"})[rel] || rel;
  return rel;
}


// "A1うえ" のような連結から [セル, 向き] を推測
function splitCellAndDir(rem){
  if (!rem) return null;
  // 区切りが入っていたら最初をセル、残りを向き扱い
  const sp = rem.split(/[\s,.\-_/]+/).filter(Boolean);
  if (sp.length >= 2) return [sp[0], sp.slice(1).join("")];

  // 全ての切れ目を試して、前半がセル・後半が向きになれば採用
  for (let i = rem.length; i >= 1; i--){
    const c = rem.slice(0, i);
    const d = rem.slice(i);
    const xy = cellToXY(c);
    const dir = normalizeDir(d);
    if (xy && DIR_VECT[dir]) return [c, d];
  }
  return null;
}


// 正規化ヘルパ
function norm(s){ return String(s||"").trim().toLowerCase(); }
function resolveCommand(tok){
  const k = norm(tok);
  const v = COMMAND_ALIASES[k];
 if (!v) throw new Error("フザケ テメ（未知のコマンド）"); // 日本語/カタカナ以外は不許可
 return v;
}
function resolveArg(cmd, tok){
if (!tok) return "";
 const tbl = ARG_ALIASES[cmd];
  if (!tbl) return null;          // テーブル未定義なら何も許可しない（英語pass等を弾く）
  const v = tbl[norm(tok)];
  return v || null; 
}


const DIR_VECT = {
  up:{dx:0,dy:-1}, down:{dx:0,dy:1}, left:{dx:-1,dy:0}, right:{dx:1,dy:0}
};
// 入力語をインデックスへ変換するためのマップを構築
const COL_MAP = Object.create(null);
const ROW_MAP = Object.create(null);

function normKey(s){ return String(s||"").trim().toLowerCase(); }

function rebuildLabelMaps(){
  // いったん空に
  for (const k in COL_MAP) delete COL_MAP[k];
  for (const k in ROW_MAP) delete ROW_MAP[k];

  // 正準ラベル
  LABELS.cols.forEach((lab, i)=>{ COL_MAP[normKey(lab)] = i; });
  LABELS.rows.forEach((lab, i)=>{ ROW_MAP[normKey(lab)] = i; });

  // 別名
  Object.entries(LABELS.col_alias || {}).forEach(([alias, canon])=>{
    const i = LABELS.cols.indexOf(canon); if (i>=0) COL_MAP[normKey(alias)] = i;
  });
  Object.entries(LABELS.row_alias || {}).forEach(([alias, canon])=>{
    const i = LABELS.rows.indexOf(canon); if (i>=0) ROW_MAP[normKey(alias)] = i;
  });
}

rebuildLabelMaps();

// 「A1」「甲三」「A-1」「A 1」「x,y（数値）」などを許容
// 「マー ダラ」「ダラ マー」「マーダラ」「ダラマー」「A1」「1A」「2,3」などを許容
// 「まー だら」「だら まー」「マーダラ」「ダラマー」等を許容（A1/1Aは不可）
function cellToXY(tok){
  const raw = String(tok||"").trim();
  if (!raw) return null;

  // 小文字化（日本語はそのままだけど揃えておく）
  const s = raw.toLowerCase();

  // 1) 区切りあり（スペース/カンマ/ドット/ハイフン/スラ/アンダー）
  const sp = s.split(/[\s,.\-/_]+/).filter(Boolean);
  if (sp.length === 2){
    const [a,b] = sp;
    // col,row
    if (a in COL_MAP && b in ROW_MAP) return {x: COL_MAP[a], y: ROW_MAP[b]};
    // row,col
    if (a in ROW_MAP && b in COL_MAP) return {x: COL_MAP[b], y: ROW_MAP[a]};
  }

  // 2) 連結（マーダラ／ダラマー）
  const colKeys = Object.keys(COL_MAP).sort((x,y)=> y.length - x.length);
  const rowKeys = Object.keys(ROW_MAP).sort((x,y)=> y.length - x.length);

  // col-first
  for (const ck of colKeys){
    if (s.startsWith(ck)){
      const rest = s.slice(ck.length);
      if (rest in ROW_MAP) return {x: COL_MAP[ck], y: ROW_MAP[rest]};
    }
  }
  // row-first
  for (const rk of rowKeys){
    if (s.startsWith(rk)){
      const rest = s.slice(rk.length);
      if (rest in COL_MAP) return {x: COL_MAP[rest], y: ROW_MAP[rk]};
    }
  }

  return null;
}

// 盤上座標 → ラベル文字列（ログ用）
function xyLabel({x,y}){ return `${LABELS.cols[x]}${LABELS.rows[y]}`; }

// 方向：別名を正規化
function normalizeDir(tok){
  const k = String(tok||"").trim().toLowerCase();
  return DIR_ALIASES[k] || null; // 未登録は不許可
}



const EDGE = [0,2,4];                      // 左/中/右 のインデックス
const ARW_INDEX = {left:0, center:1, right:2};
// 自分の辺を“内向きに見たとき”の左→右の順序
function arrowIndicesForSeat(seat){
  // 0,2,4 は盤面座標の並び。N/E は逆、S/W はそのまま
  if (seat === "N") return [4,2,0]; // 上辺：右→中→左（内向きに見た左が盤面右端）
  if (seat === "S") return [0,2,4]; // 下辺：左→中→右
  if (seat === "W") return [0,2,4]; // 左辺：上→中→下
  if (seat === "E") return [4,2,0]; // 右辺：下→中→上
  return [0,2,4];
}

function arrowXYFor(seat, tok){
  const key0 = String(tok||"").trim().toLowerCase();
  const key  = ARROW_CHOICES[key0];           // 日本語エイリアスのみ
 if (!key) return null;
 const i = ARW_INDEX[key];
  if (i == null) return null;
const order = arrowIndicesForSeat(seat); // ← ここがポイント
 if (seat==="N") return {x:order[i], y:0};
 if (seat==="S") return {x:order[i], y:SIZE-1};
 if (seat==="W") return {x:0,        y:order[i]};
 if (seat==="E") return {x:SIZE-1,   y:order[i]};
}


const app = express();
app.use(express.static("public"));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// ルームは1つだけのMVP
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
  reverseActive: false, // 反転中か
 reverseUsed: false,   // 今ゲームで既に使ったか
 lastTurnSeat: null,
};

function resetBoard() {
  state.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  state.arrows = {};
  state.phase = "place1";
  // state.logs = state.logs.slice(-200);
  state.turnIdx = 0;
  state.phaseActions = {};
  state.oath = {};
  state.vow2x = {};
  state.reverseActive = false;
 state.reverseUsed = false;
  for (const seat of SEATS) if (state.players[seat]) state.players[seat].score ??= 0;
}
function currentTurnSeat(){ return SEAT_ORDER[state.turnIdx]; }
function logTurnNow(){
  const seat = currentTurnSeat();
  if (!force && state.lastTurnSeat === seat) return; // 同じ席なら二重ログを抑止
  state.lastTurnSeat = seat;
  log(`${seatLabel(seat)}【ナギ】`);
}




// すべての接続へ（ロビー表示更新・着席ログ・リセットの通知はこっち）
function broadcastAll(msg){
  const s = JSON.stringify(msg);
  for (const client of wss.clients){
    if (client && client.readyState === client.OPEN){
      try{ client.send(s); }catch(_){}
    }
  }
}

// 着席済みプレイヤーだけへ（パス/置き/発進などゲーム内の細かい更新に使う）
// function broadcastPlayers(msg){
//   const s = JSON.stringify(msg);
//   for (const seat of SEATS){
//     const p = state.players[seat];
//     if (p && p.ws && p.ws.readyState === p.ws.OPEN){
//       try{ p.ws.send(s); }catch(_){}
//     }
//   }
// }

function snapshot(){
  return {
    board: state.board,
    phase: state.phase,
    turnSeat: SEAT_ORDER[state.turnIdx] ?? null,
    arrows: state.arrows,
    reverseActive: state.reverseActive,
    labels: { cols: LABELS.cols, rows: LABELS.rows }, 
    seatLabels: SEAT_LABELS,   // ★ これを追加
    players: Object.fromEntries(SEATS.map(seat=>{
      const p = state.players[seat];
      return [seat, p? {name:p.name??seat, score:p.score??0} : null];
    })),
    logs: state.logs.slice(-30)
  };
}

function log(line){
  state.logs.push(line);
  broadcastAll({ type:"log", line });  
}

function seatInUse(seat){ return !!state.players[seat]; }

function everyoneSeated(){
  return SEATS.every(seat => !!state.players[seat]);
}

function advanceTurn(){
  state.turnIdx = (state.turnIdx + 1) % SEAT_ORDER.length;
  broadcastAll({type:"state", data:snapshot()});
}

function seatToInward(seat){
  // 矢印の進行方向（内側へ）
  if (seat==="N") return DIR_VECT.down;
  if (seat==="S") return DIR_VECT.up;
  if (seat==="E") return DIR_VECT.left;
  if (seat==="W") return DIR_VECT.right;
}

function isEdgeCellOfSeat(seat, {x,y}){
  if (seat==="N") return y===0;
  if (seat==="S") return y===SIZE-1;
  if (seat==="W") return x===0;
  if (seat==="E") return x===SIZE-1;
  return false;
}

function exitSeatForOutOfBounds(x,y){
  if (y<0) return "N";
  if (y>=SIZE) return "S";
  if (x<0) return "W";
  if (x>=SIZE) return "E";
  return null;
}

function tryReverseDeclaration(seat, text){
  const joined = String(text||"").replace(/[!\s]+/g,'').toLowerCase(); // !と空白を除去
  if (!REVERSE_ALIASES.has(joined)) return false;
  if (state.phase !== "launch") throw new Error("フザケ パオチャンカパーナ ナギ");
  if (state.reverseUsed)        throw new Error("フザケ ギッ パオチャンカパーナ");

  state.reverseActive = true;
  state.reverseUsed   = true;
  log(`${seatLabel(seat)}: パオチャンカパーナ !!!!!`);
  broadcastAll({ type:"state", data:snapshot() });

  // ★ 一呼吸（1秒）置いてから自動でパオ
  setTimeout(()=>{
    try{
      handleLaunchCommon(seat, "launch");
    }catch(e){
      // 万一のエラーも通知（落ちないように）
      const msg = String(e && e.message || e);
      if (state.players[seat]?.ws){
        state.players[seat].ws.send(JSON.stringify({type:"error", message: msg}));
      }
    }
  }, 1000);

  return true;
}


// 既存の traceAnimal(seat) を丸ごと置き換え
function traceAnimal(seat, mode = "launch") {
  const start = state.arrows[seat];
  if (!start) return { path: [], exit: "none", bends: 0, reason: "no_start" };

  let { dx, dy } = seatToInward(seat);
  let x = start.x + dx;
  let y = start.y + dy;

  const seenStates = new Set(); // ループ検出
  const usedColors = new Set(); // launch2: 同じ色は2回目以降は無視
  const path = [];
  let bends = 0;

  for (let step = 0; step < STEP_LIMIT; step++) {
    // 盤外に出た＝どの辺から出たかで得点計算
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) {
      const out = exitSeatForOutOfBounds(x, y); // "N"|"E"|"S"|"W"
      return { path, exit: out, bends, reason: "exit" };
    }

    path.push({ x, y });

    // コマで曲がる処理
    const cell = state.board[y][x]; // {dir, owner}
    if (cell) {
      // launch2 では「初めての色」だけ効く
      if (mode === "launch2") {
        if (!usedColors.has(cell.owner)) {
          let v = DIR_VECT[cell.dir];
     if (state.reverseActive) v = { dx: -v.dx, dy: -v.dy }; //反転
          // 実際に向きが変わったらカウント
          if (v.dx !== dx || v.dy !== dy) bends++;
          dx = v.dx; dy = v.dy;
          usedColors.add(cell.owner);
        }
      } else {
        // 通常 launch：毎回そのコマの向きに従う
        let v = DIR_VECT[cell.dir];
     if (state.reverseActive) v = { dx: -v.dx, dy: -v.dy }; //反転
        if (v.dx !== dx || v.dy !== dy) bends++;
        dx = v.dx; dy = v.dy;
      }
    }

    // ループ検出（位置＋向きの再訪）
    const key = `${x},${y},${dx},${dy}`;
    if (seenStates.has(key)) {
      return { path, exit: "loop", bends, reason: "cycle" };
    }
    seenStates.add(key);

    // 次のマスへ
    x += dx; y += dy;
  }

  // STEP_LIMIT に達した＝帰ってこれなかった → ループ扱い
  return { path, exit: "loop", bends, reason: "step_limit" };
}



function allTurnsDoneForPhase(targetPhase){
  // place1/place2 は盤面の置かれた個数で判断、arrow は arrows 数、launch は順次実行
  if (targetPhase==="place1"){
    let count=0; for (let y=0;y<SIZE;y++) for (let x=0;x<SIZE;x++) if (state.board[y][x]) count++;
    return count>=4; // 各席1個
  }
  if (targetPhase==="arrow"){
    return SEATS.every(seat=>!!state.players[seat]) && Object.keys(state.arrows).length>=4;
  }
  if (targetPhase==="place2"){
    let count=0; for (let y=0;y<SIZE;y++) for (let x=0;x<SIZE;x++) if (state.board[y][x]) count++;
    return count>=8; // 合計8個になっていればOK
  }
  return false;
}

function markDone(seat){ state.phaseActions[seat] = true; }
function placePhaseDone(){
  return SEATS.every(seat => !!state.players[seat]) &&
         SEATS.every(seat => !!state.phaseActions[seat]);
}

function tryAdvancePhase(){
  let changed = false;
  if (state.phase==="place1" && placePhaseDone()){
    state.phase = "arrow"; state.turnIdx = 0; state.phaseActions = {};
    log("— ギッ  (チャン オメ) —");
    changed = true;
  } else if (state.phase==="arrow" && Object.keys(state.arrows).length>=4){
    state.phase = "place2"; state.turnIdx = 0; state.phaseActions = {};
    log("— グウ  (トムヤ オメ) —");
    changed = true;
  } else if (state.phase==="place2" && placePhaseDone()){
    state.phase = "launch"; state.turnIdx = 0;
    log("— デベ  (パオ オメ) —");
    changed = true;
  }
  broadcastAll({type:"state", data:snapshot()});
  logTurnNow();
}

function assertTurn(seat){
  const need = SEAT_ORDER[state.turnIdx];
  if (seat !== need) throw new Error(`${seatLabel(need)} オメ ナギ`);
}



function onCommand(seat, text){

  const raw = String(text||"").trim();

{
  const joined = String(text||"").replace(/[!\s]+/g,'').toLowerCase(); // !と空白を除去
  if (REVERSE_ALIASES.has(joined)) {
    if (state.phase !== "launch") throw new Error("フザケ パオチャンカパーナ ナギ");
    if (state.reverseUsed)        throw new Error("フザケ ギッ パオチャンカパーナ");
    state.reverseActive = true;
    state.reverseUsed   = true;
    log(`${seatLabel(seat)}: パオチャンカパーナ !!!!!`);
    broadcastAll({ type:"state", data:snapshot() });
    // 自分の手で即launch（ププアププア中のパオは禁止は handleLaunchCommon 側で弾かれる）
    handleLaunchCommon(seat, "launch");
    return; // ← onCommand 内なので合法
  }
}
  // === 誓い：オマ フザケ ン パオ（スペース/大小/かな無視） ===
  {
    const joined = raw.replace(/\s+/g, '').toLowerCase();
    if (OATH_ALIASES.has(joined)) {
      if (state.phase !== "arrow") throw new Error("フザケ オマフザケンパオ ナギ");
      if (state.arrows[seat])      throw new Error("フザケ オマフザケンパオ ナギ(チャン ナギ)");
      if (state.oath[seat]?.active) throw new Error("フザケ ギッ オマフザケンパオ");

      state.oath[seat] = { active: true, hits: 0 };
      log(`${seatLabel(seat)}: オマ フザケ ン パオ !!!!!`);
      broadcastAll({type:"state", data:snapshot()});
      return;
    }
  }
    // === ププアププア（スペース無視・ひらがなOK） ===
  {
    const joined = String(text||"").replace(/\s+/g,'').toLowerCase();
    if (VOW2X_ALIASES.has(joined)) {
      if (state.phase !== "arrow")         throw new Error("フザケ ププアププア ナギ");
      if (state.arrows[seat])              throw new Error("フザケ ププアププア ナギ(チャン ナギ)");
      if (state.vow2x[seat]?.active)       throw new Error("フザケ ギッ ププアププア");
      state.vow2x[seat] = { active: true };
      log(`${seatLabel(seat)}: ププアププア !!!!!`);
      broadcastAll({type:"state", data:snapshot()});
      return;
    }
  }
// === 置きフェーズ・パス：トムヤ ムクン（or ムクン単独） ===
{
  const joined = raw.replace(/\s+/g, '').toLowerCase();
  if (PLACE_PASS_ALIASES.has(joined)) {
    if (!(state.phase==="place1" || state.phase==="place2"))
      throw new Error("フザケ ムクン ナギ");
    assertTurn(seat);
    log(`${seatLabel(seat)}: トムヤ ムクン`);
    markDone(seat);
    advanceTurn();
    tryAdvancePhase();
    return;
  }
}


 // ===== コマンド解析（スペース有無どちらもOK） =====
  // 先頭からエイリアス最長一致で cmd を取り出し、残りを rest とする
  const { cmd, rest } = extractCmdAndRest(raw); // 例) "トムヤマーダラバババ" → {cmd:"put", rest:"マーダラバババ"}
  let parts = [cmd];
 if (rest && rest.trim()) parts.push(...rest.trim().split(/\s+/)); // 残りを空白で分割して一旦詰める
 // put は「セル+向き」を柔軟に解釈：
 //  - "マーダラバババ"（連結）
 //  - "マー ダラ バババ"（分割）
 //  - "ダラ マー バババ"（行→列の順でもOK）
 if (cmd === "put") {
   if (parts.length === 2) {
     // 連結ケース "マーダラバババ" を [セル, 向き] に割る
     const pr = splitCellAndDir(parts[1]);
     if (pr) parts = [parts[0], pr[0], pr[1]];
   } else if (parts.length >= 3) {
     // 分割ケース："マー ダラ バババ" / "ダラ マー バババ"
     const merged = parts[1] + parts[2];
     if (cellToXY(merged)) {
       const dirStr = parts.slice(3).join("");      // 向きは残りを結合
       parts = [parts[0], merged, dirStr];
     } else {
       // 既に parts[1] が "マーダラ" で、向きが分割されている場合
       const dirStr = parts.slice(2).join("");
       parts = [parts[0], parts[1], dirStr];
     }
   }
 }
  









if (cmd==="put"){
  if (!(state.phase==="place1"||state.phase==="place2")) throw new Error("フザケ プッチョ ナギ");
  assertTurn(seat);

  const xy = cellToXY(parts[1]); if (!xy) throw new Error("フザケ べヒュー");
  if (state.board[xy.y][xy.x]) throw new Error("フザケ プッチョトムヤ");

  const dirTok = parts[2]; if (!dirTok) throw new Error("フザケ キキヤーィ");

  // ① 入力→相対(up/down/left/right)
  const rel = normalizeDir(dirTok); // 既存：DIR_ALIASES を参照して正規化
  if (!DIR_VECT[rel]) throw new Error("フザケ トムヤ (バババ/パロロ/ヘーネ/バーサ) オメ");

  // ② 相対→絶対（席に応じて回転）
  const abs = seatRelToAbs(seat, rel);

  // ③ 置くのは絶対向き、ログは相対語彙で
  state.board[xy.y][xy.x] = {dir: abs, owner: seat};
  log(`${seatLabel(seat)}: トムヤ ${xyLabel(xy)} ${showRel(rel)}`);

  markDone(seat);
  advanceTurn();
  tryAdvancePhase();
  return;
}

if (cmd === "launch")  { handleLaunchCommon(seat, "launch",  parts[1]); return; }
if (cmd === "launch2") { handleLaunchCommon(seat, "launch2", parts[1]); return; }


  if (cmd==="pickup" || cmd==="take" || cmd==="remove"){
  if (!(state.phase==="place1"||state.phase==="place2")) throw new Error("フザケ ムクン ナギ");
  assertTurn(seat);
  const xy = cellToXY(parts[1]); if (!xy) throw new Error("フザケ べヒュー");
  const c = state.board[xy.y][xy.x];
  if (!c) throw new Error("フザケ トムヤ ");
  if (c.owner !== seat) throw new Error("フザケ オマ トムヤ ムクン オメ");
  state.board[xy.y][xy.x] = null;
  log(`${seatLabel(seat)}: ペピピ ${parts[1].toUpperCase()}`);
  markDone(seat);               // ← 回収も1手としてカウント
  advanceTurn();
  tryAdvancePhase();
  return;
}


if (cmd==="arrow"){
  if (state.phase!=="arrow") throw new Error("フザケ チャン ナギ");
  assertTurn(seat);
  if (state.arrows[seat]) throw new Error("フザケ チャン シャーンシャーン ヒンン");
  const tok = parts[1];
  if (!tok) throw new Error("ヒンン チャン フザケ ヘネシヘネシ チョボ バサシバサシ");

  const xy = arrowXYFor(seat, tok);
  if (!xy) throw new Error("フザケ べヒュー チャン (バサシバサシ/チョボ/ヘネシヘネシ)");

  state.arrows[seat] = xy;
  log(`${seatLabel(seat)}: チャン ${tok}`);
  advanceTurn();
  tryAdvancePhase();
  return;
}

  throw new Error("フザケ テメ"); // 未知コマンド
}

function handleLaunchCommon(seat, mode, arg){ // mode: "launch" | "launch2"
  if (state.phase !== "launch") throw new Error("フザケ パオ ナギ");
  assertTurn(seat);

  // --- ヘッダー＆手番行＆アクション行をここで先に出す ---
  log(`—(${mode==="launch" ? "パオ" : "プア"} オメ) —`);
  log(`${seatLabel(seat)}【ナギ】`);
  log(`${seatLabel(seat)}: ${mode==="launch" ? "パオ" : "プア"}`);

  // 1) pass優先
  const a = resolveArg(mode, arg);
  if (a === "pass") {
    // ここは既に「…: パオ ムクン/プア ムクン」を出したいなら↑の3行の代わりにログ調整してね
    log(`${seatLabel(seat)}: ${mode==="launch"?"パオ":"プア"} ムクン`);
    if (state.vow2x[seat]?.active) {
      state.vow2x[seat].active = false;
      log(`${seatLabel(seat)}: ププアププア ナギ`);
    }
    advanceTurn();
    if (state.turnIdx === 0) { state.phase = "end"; log("— ンシャンシャ —"); }
    broadcastAll({ type: "state", data: snapshot() });
    return;
  }

  // 2) ププアププア中はパオ禁止
  if (mode === "launch" && state.vow2x[seat]?.active) {
    throw new Error("フザケ パオ : ププアププア ナギ");
  }

  // 3) 余計な引数は不許可
  if (arg) throw new Error("フザケ オマパトゥ");

  // 4) 矢印未設定
  if (!state.arrows[seat]) throw new Error("フザケ チャン オメ");

  const { path, exit, bends } = traceAnimal(seat, mode);

  let delta = 0;
  if (exit === "loop")       delta = -5;
  else if (exit === seat)    delta = bends + 1;
  else if (["N","E","S","W"].includes(exit)) delta = -bends;

  // ププアププア：プアなら最終delta×2
  if (mode === "launch2" && state.vow2x[seat]?.active) {
    delta *= 2;
    log(`${seatLabel(seat)}: ププアププア イヒ`);
    state.vow2x[seat].active = false;
  }

  state.players[seat].score = (state.players[seat].score || 0) + delta;

  // ★ 希望フォーマット：「→ チキン bends=… scoreΔ=…」
  const showExit = (ex)=>{
    if (ex === "loop") return "チキン";       // ← 要望に合わせて "loop" を「チキン」に
    return seatLabel(ex) || ex;
  };
  log(`→ ${showExit(exit)} トムヤ${bends} ゾーサン${delta}`);

  // パス表示だけにして、ここはログだけ（DOMは animatePath が描画のみ担当）
  broadcastAll({ type: "path", seat, path, exit, scoreDelta: delta, bends, mode });

  // 誓いボーナス
  if (["N","E","S","W"].includes(exit)) {
    const o = state.oath[exit];
    if (o && o.active) {
      o.hits = (o.hits || 0) + 1;
      state.players[exit].score = (state.players[exit].score || 0) + OATH_BONUS;
      log(`${seatLabel(exit)}: パーナ +${OATH_BONUS}`);
    }
  }

  advanceTurn();
  if (state.turnIdx === 0){
    for (const s of SEATS){
      const o = state.oath[s];
      if (o && o.active){
        if (!o.hits){
          state.players[s].score = (state.players[s].score || 0) + OATH_FAIL_PENALTY;
          log(`${seatLabel(s)}: フザケ パーナ ${OATH_FAIL_PENALTY}`);
        }
        o.active = false;
      }
    }
    state.phase = "end";
    log("— ンシャンシャ —");
  }
  broadcastAll({ type:"state", data:snapshot() });
}




//   throw new Error("フザケ テメ");
// }


function hardReset(){
  state.board = Array.from({length:SIZE},()=>Array(SIZE).fill(null));
  state.arrows = {};
  state.phase = "lobby";
  state.turnIdx = 0;
  state.logs = [];
  state.phaseActions = {};
  state.players = {};

  // ★ 反転系も確実に戻す
  state.reverseActive = false;
  state.reverseUsed   = false;

  broadcastAll({ type: "you", seat: null });
  log("— シャーンシャーン —");
  broadcastAll({ type: "state", data: snapshot() });
  state.lastTurnSeat = null;
}


function sendSeat(seat,msg){
  const p = state.players[seat];
  if (p && p.ws && p.ws.readyState===p.ws.OPEN){ p.ws.send(JSON.stringify(msg)); }
}
function extractCmdAndRest(raw){
  const lower = raw.toLowerCase();
  for (const alias of Object.keys(COMMAND_ALIASES).sort((a,b)=>b.length-a.length)){
    if (lower.startsWith(alias.toLowerCase())){
      return { cmd: COMMAND_ALIASES[alias], rest: raw.slice(alias.length) };
    }
  }
  throw new Error("フザケ テメ");
}

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).slice(2,8);
  let mySeat = null;
  let myName = id;
  let pendingSeat = null;
  let myCid = null;  

  ws.send(JSON.stringify({type:"state", data:snapshot()}));
  ws.send(JSON.stringify({type:"hello", id}));

ws.on("message", (buf)=>{
  try{
    const m = JSON.parse(buf.toString());

    // フォールバック同期（ロビー監視などからの pull）
    if (m.type === "pull") {
      ws.send(JSON.stringify({ type: "state", data: snapshot() }));
      return;
    }

    // タブ復帰（同じcidなら席を引き継ぐ）
    if (m.type === "resume") {
      myCid = String(m.cid || "").slice(0, 64);
      let found = null;
      for (const s of SEATS) {
        const p = state.players[s];
        if (p && p.cid === myCid) { found = s; break; }
      }
      if (found) {
        mySeat = found;
        state.players[mySeat].ws = ws; // ソケット差し替え
        ws.send(JSON.stringify({ type:"you", seat: mySeat }));
        broadcastAll({ type:"state", data: snapshot() });
      }
      return;
    }

    // ゲームだけ最初から（席・スコアは保持）
    if (m.type === "resetGame") {
      resetBoard();
      for (const s of SEATS) if (state.players[s]) state.players[s].score = 0;
      log("— パオシャーンシャーン —");
      broadcastAll({type:"state", data:snapshot()});
      return;
    }

    if (m.type === "name"){
      myName = String(m.name||"").slice(0,20) || myName;
      if (mySeat && state.players[mySeat]) state.players[mySeat].name = myName;
      broadcastAll({type:"state", data:snapshot()});
      return;
    }

    if (m.type === "seat"){
      const want = resolveSeat(m.seat);
      if (!SEATS.includes(want)) throw new Error(`オマ ${SEAT_LABELS.N}/${SEAT_LABELS.E}/${SEAT_LABELS.S}/${SEAT_LABELS.W} `);
      if (seatInUse(want)) throw new Error("フザケ オマ");
      if (mySeat){ delete state.players[mySeat]; }
      mySeat = want;
      state.players[mySeat] = {
        id,
        cid: myCid || id,
        name: myName,
        ws,
        score: 0
      };
      log(`${SEAT_LABELS[mySeat]}  ${myName} プッチョオマ`);
      ws.send(JSON.stringify({type:"you", seat: mySeat}));

      broadcastAll({ type:"state", data: snapshot() });
      if (everyoneSeated() && state.phase==="lobby"){
        resetBoard();
        log("— ダラ  (トムヤ オメ) —");
        logTurnNow();    
        broadcastAll({ type:"state", data: snapshot() });
      }
      return;
    }

    if (m.type === "cmd"){
      if (!mySeat) throw new Error("シャーンシャーン オマ オメ");
      onCommand(mySeat, m.text || "");
      return;
    }

    if (m.type === "reset") {
      // 席ごと完全リセット（ロビーへ戻る）
      hardReset();
      return;
    }

  }catch(err){
    ws.send(JSON.stringify({type:"error", message: String(err.message||err)}));
  }
});


ws.on("close", ()=>{
  if (mySeat && state.players[mySeat]){
    state.players[mySeat].ws = null;
    state.players[mySeat].disconnectedAt = Date.now();
    log(`${seatLabel(mySeat)} (${myName}) ヒンン オマ`);
    broadcastAll({type:"state", data:snapshot()});
  }
});

});//wss.on("connection", ...) を閉じる）

const PORT = process.env.PORT || 8080;
server.listen(PORT, ()=>{
  console.log("listening on http://localhost:"+PORT);
});