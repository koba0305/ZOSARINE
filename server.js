import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);


const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });


app.use(express.static(path.join(__dirname, "public")));
app.get("/healthz", (_,res)=>res.send("ok"));


const SIZE = 5;
const SEATS = ["N","E","S","W"];
const SEAT_ORDER = ["N","E","S","W"];
const STEP_LIMIT = 30;


const OATH_BONUS = 1;         
const OATH_FAIL_PENALTY = -5; 


const REVERSE_ALIASES = new Set(["パオチャンカパーナ","ぱおちゃんかぱーな"]);


const OATH_ALIASES = new Set([
  "オマフザケンパオ",
  "おまふざけんぱお"
]);
const VOW2X_ALIASES = new Set(["ププアププア","ぷぷあぷぷあ"]);



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


const SEAT_LABELS = { N:"ウホ", E:"イザ", S:"ンマ", W:"ウット" };
const SEAT_ALIASES = { n:"N", 北:"N", e:"E", 東:"E", s:"S", 南:"S", w:"W", 西:"W" }; 
SEAT_ALIASES[SEAT_LABELS.N] = "N";
SEAT_ALIASES[SEAT_LABELS.E] = "E";
SEAT_ALIASES[SEAT_LABELS.S] = "S";
SEAT_ALIASES[SEAT_LABELS.W] = "W";

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
function seatLabel(s){ return SEAT_LABELS[s] || s; } 





const DIR_ALIASES = {
  "バババ":"up",   "ばばば":"up",  
  "パロロ":"down", "ぱろろ":"down",
  "バーサ":"left", "ばーさ":"left",
  "ヘーネ":"right","へーね":"right",
};

const REL_LABELS = { up:"バババ", down:"パロロ", right:"ヘーネ", left:"バーサ" };
function showRel(rel){ return REL_LABELS[rel] || rel; }

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
function showDir(dir){ return DIR_LABELS[dir] || dir; }



const ARROW_CHOICES = {
  "バサシバサシ":"left",  "ばさしばさし":"left",
  "チョボ":"center",      "ちょぼ":"center",
  "ヘネシヘネシ":"right", "へねしへねし":"right",
};

const COMMAND_ALIASES = {
  "パオ":"launch",     "ぱお":"launch",
  "プア":"launch2",    "ぷあ":"launch2",

  "トムヤ":"put",   "とむや":"put",
 
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


function extractCmdAndRest(raw){
  const s = String(raw || "");
  const lower = s.toLowerCase();
  
  const keys = Object.keys(COMMAND_ALIASES).sort((a,b)=> b.length - a.length);
  for (const k of keys){
    if (lower.startsWith(k.toLowerCase())){
      return { cmd: COMMAND_ALIASES[k], rest: s.slice(k.length) };
    }
  }
  throw new Error("フザケ テメ"); 
}


function splitCellAndDir(rem){
  if (!rem) return null;
  
  const sp = rem.split(/[\s,.\-_/]+/).filter(Boolean);
  if (sp.length >= 2) return [sp[0], sp.slice(1).join("")];

  
  for (let i = rem.length; i >= 1; i--){
    const c = rem.slice(0, i);
    const d = rem.slice(i);
    const xy = cellToXY(c);
    const dir = normalizeDir(d);
    if (xy && DIR_VECT[dir]) return [c, d];
  }
  return null;
}



function norm(s){ return String(s||"").trim().toLowerCase(); }
function resolveCommand(tok){
  const k = norm(tok);
  const v = COMMAND_ALIASES[k];
 if (!v) throw new Error("フザケ テメ（未知のコマンド）"); 
 return v;
}
function resolveArg(cmd, tok){
if (!tok) return "";
 const tbl = ARG_ALIASES[cmd];
  if (!tbl) return null;          
  const v = tbl[norm(tok)];
  return v || null; 
}


const DIR_VECT = {
  up:{dx:0,dy:-1}, down:{dx:0,dy:1}, left:{dx:-1,dy:0}, right:{dx:1,dy:0}
};

const COL_MAP = Object.create(null);
const ROW_MAP = Object.create(null);

function normKey(s){ return String(s||"").trim().toLowerCase(); }

function rebuildLabelMaps(){
  
  for (const k in COL_MAP) delete COL_MAP[k];
  for (const k in ROW_MAP) delete ROW_MAP[k];

  
  LABELS.cols.forEach((lab, i)=>{ COL_MAP[normKey(lab)] = i; });
  LABELS.rows.forEach((lab, i)=>{ ROW_MAP[normKey(lab)] = i; });

  
  Object.entries(LABELS.col_alias || {}).forEach(([alias, canon])=>{
    const i = LABELS.cols.indexOf(canon); if (i>=0) COL_MAP[normKey(alias)] = i;
  });
  Object.entries(LABELS.row_alias || {}).forEach(([alias, canon])=>{
    const i = LABELS.rows.indexOf(canon); if (i>=0) ROW_MAP[normKey(alias)] = i;
  });
}

rebuildLabelMaps();




function cellToXY(tok){
  const raw = String(tok||"").trim();
  if (!raw) return null;

  
  const s = raw.toLowerCase();

  
  const sp = s.split(/[\s,.\-/_]+/).filter(Boolean);
  if (sp.length === 2){
    const [a,b] = sp;
    // col,row
    if (a in COL_MAP && b in ROW_MAP) return {x: COL_MAP[a], y: ROW_MAP[b]};
    // row,col
    if (a in ROW_MAP && b in COL_MAP) return {x: COL_MAP[b], y: ROW_MAP[a]};
  }

  
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


function xyLabel({x,y}){ return `${LABELS.cols[x]}${LABELS.rows[y]}`; }


function normalizeDir(tok){
  const k = String(tok||"").trim().toLowerCase();
  return DIR_ALIASES[k] || null; 
}



const EDGE = [0,2,4];                      
const ARW_INDEX = {left:0, center:1, right:2};

function arrowIndicesForSeat(seat){
  
  if (seat === "N") return [4,2,0]; 
  if (seat === "S") return [0,2,4]; 
  if (seat === "W") return [0,2,4]; 
  if (seat === "E") return [4,2,0]; 
  return [0,2,4];
}

function arrowXYFor(seat, tok){
  const key0 = String(tok||"").trim().toLowerCase();
  const key  = ARROW_CHOICES[key0];           
 if (!key) return null;
 const i = ARW_INDEX[key];
  if (i == null) return null;
const order = arrowIndicesForSeat(seat); 
 if (seat==="N") return {x:order[i], y:0};
 if (seat==="S") return {x:order[i], y:SIZE-1};
 if (seat==="W") return {x:0,        y:order[i]};
 if (seat==="E") return {x:SIZE-1,   y:order[i]};
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
function currentTurnSeat(){ return SEAT_ORDER[state.turnIdx]; }
function logTurnNow(force = false){
  const seat = currentTurnSeat();
  if (!force && state.lastTurnSeat === seat) return; 
  state.lastTurnSeat = seat;
  log(`${seatLabel(seat)}【ナギ】`);
}





function broadcastAll(msg){
  const s = JSON.stringify(msg);
  for (const client of wss.clients){
    if (client && client.readyState === client.OPEN){
      try{ client.send(s); }catch(_){}
    }
  }
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




function seatedSeats(){
  return SEATS.filter(s => !!state.players[s]);
}
function peekTurnSeat(){ 
  for (let k=0;k<SEAT_ORDER.length;k++){
    const s = SEAT_ORDER[(state.turnIdx + k) % SEAT_ORDER.length];
    if (state.players[s]) return s;
  }
  return null; 
}
function normalizeTurnIdx(){ 
  for (let k=0;k<SEAT_ORDER.length;k++){
    const s = SEAT_ORDER[state.turnIdx];
    if (state.players[s]) return;
    state.turnIdx = (state.turnIdx + 1) % SEAT_ORDER.length;
  }
}


function snapshot(){
  return {
    board: state.board,
    phase: state.phase,
    turnSeat: SEAT_ORDER[state.turnIdx] ?? null,   
    arrows: state.arrows,
    reverseActive: state.reverseActive,
    labels: { cols: LABELS.cols, rows: LABELS.rows },
    seatLabels: SEAT_LABELS,
    players: Object.fromEntries(SEATS.map(seat=>{
      const p = state.players[seat];
      return [seat, p? {name:p.name??seat, score:p.score??0} : null];
    })),
    logs: state.logs.slice(-120),
    logEnd: state.logs.length
  };
}



function maybeStartGame(){
  if (everyoneSeated() && state.phase === "lobby"){
    resetBoard();
    log("— ダラ  (トムヤ オメ) —");
    logTurnNow(true);
    broadcastAll({ type:"state", data:snapshot() });
    return true;
  }
  return false;
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
  const joined = String(text||"").replace(/[!\s]+/g,'').toLowerCase(); 
  if (!REVERSE_ALIASES.has(joined)) return false;
  if (state.phase !== "launch") throw new Error("フザケ パオチャンカパーナ ナギ");
  if (state.reverseUsed)        throw new Error("フザケ ギッ パオチャンカパーナ");

  state.reverseActive = true;
  state.reverseUsed   = true;
  log(`${seatLabel(seat)}: パオチャンカパーナ !!!!!`);
  broadcastAll({ type:"state", data:snapshot() });

  
  setTimeout(()=>{
    try{
      handleLaunchCommon(seat, "launch");
    }catch(e){
      
      const msg = String(e && e.message || e);
      if (state.players[seat]?.ws){
        state.players[seat].ws.send(JSON.stringify({type:"error", message: msg}));
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

  
  
  
  {
    const under = state.board[y]?.[x];
    if (under) {
      let v = DIR_VECT[under.dir];
      if (state.reverseActive) v = { dx: -v.dx, dy: -v.dy };
      if (v.dx !== dx || v.dy !== dy) bends++;
      dx = v.dx; dy = v.dy;
    }
  }

  
  x += dx; y += dy;

  
  for (let stepIdx = 1; stepIdx <= STEP_LIMIT; stepIdx++) {
    
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) {
      const out = exitSeatForOutOfBounds(x, y);
      return { path, exit: out, bends, reason: "exit" };
    }

    path.push({ x, y });

    const cell = state.board[y][x]; // {dir, owner}
    if (cell) {
      if (mode === "launch2") {
        if (stepIdx % 2 === 0) {
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
    if (seenStates.has(key)) {
      return { path, exit: "loop", bends, reason: "cycle" };
    }
    seenStates.add(key);

    x += dx; y += dy;
  }

  return { path, exit: "loop", bends, reason: "step_limit" };
}


function allTurnsDoneForPhase(targetPhase){
  
  if (targetPhase==="place1"){
    let count=0; for (let y=0;y<SIZE;y++) for (let x=0;x<SIZE;x++) if (state.board[y][x]) count++;
    return count>=4; 
  }
  if (targetPhase==="arrow"){
    return SEATS.every(seat=>!!state.players[seat]) && Object.keys(state.arrows).length>=4;
  }
  if (targetPhase==="place2"){
    let count=0; for (let y=0;y<SIZE;y++) for (let x=0;x<SIZE;x++) if (state.board[y][x]) count++;
    return count>=8; 
  }
  return false;
}

function markDone(seat){ state.phaseActions[seat] = true; }
function placePhaseDone(){
  const seated = seatedSeats();
  if (seated.length === 0) return false;
  return seated.every(s => !!state.phaseActions[s]);
}

function tryAdvancePhase(){
  let changed = false;
  if (state.phase==="place1" && placePhaseDone()){
    state.phase = "arrow"; state.turnIdx = 0; state.phaseActions = {};
    log("— ギッ  (チャン オメ) —");
    logTurnNow(true);
    changed = true;
  } else if (state.phase==="arrow"){
    const seated = seatedSeats();
    const allSet = seated.length>0 && seated.every(s => !!state.arrows[s]); 
    if (allSet){
      state.phase = "place2"; state.turnIdx = 0; state.phaseActions = {};
      log("— グウ  (トムヤ オメ) —");
      logTurnNow();
      changed = true;
    }
  } else if (state.phase==="place2" && placePhaseDone()){
    state.phase = "launch"; state.turnIdx = 0;
    log("— デベ  (パオ オメ) —");
    logTurnNow();
    changed = true;
  }
  broadcastAll({type:"state", data:snapshot()});
  return changed;
}

function assertTurn(seat){
  const need = SEAT_ORDER[state.turnIdx];
  if (seat !== need) throw new Error(`${seatLabel(need)} オメ ナギ`);
}




function onCommand(seat, text){

  const raw = String(text||"").trim();


 if (tryReverseDeclaration(seat, text)) return;

  
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

{
  const joined = raw.replace(/\s+/g, '').toLowerCase();
  if (PLACE_PASS_ALIASES.has(joined)) {
    if (!(state.phase==="place1" || state.phase==="place2"))
      throw new Error("フザケ ムクン ナギ");
    assertTurn(seat);
    log(`${seatLabel(seat)}: トムヤ ムクン`);
    markDone(seat);
    advanceTurn();
  if (!tryAdvancePhase()) logTurnNow();
    return;
  }
}


 
  
  const { cmd, rest } = extractCmdAndRest(raw);
  let parts = [cmd];
 if (rest && rest.trim()) parts.push(...rest.trim().split(/\s+/));




function parsePutArgs(rest){
  const restJoined = (rest || "").replace(/[\s,.\-/_]+/g, ""); 
  
  const pr = splitCellAndDir(restJoined);
  if (pr) return { cellTok: pr[0], dirTok: pr[1] };

  
  let parts2 = [];
  if (rest && rest.trim()) parts2 = rest.trim().split(/\s+/);

  if (parts2.length === 1){
    const pr2 = splitCellAndDir(parts2[0]);
    if (pr2) return { cellTok: pr2[0], dirTok: pr2[1] };
  } else if (parts2.length >= 2){
    const maybeCell = parts2[0] + parts2[1]; 
    if (cellToXY(maybeCell)){
      return { cellTok: maybeCell, dirTok: parts2.slice(2).join("") };
    } else {
      const pr3 = splitCellAndDir(parts2[1]);
      if (pr3) return { cellTok: parts2[0] + pr3[0], dirTok: pr3[1] };
    }
  }
  throw new Error("フザケ べヒュー"); 
}






if (cmd === "put") {
  if (!(state.phase==="place1" || state.phase==="place2")) throw new Error("フザケ プッチョ ナギ");
  assertTurn(seat);

  const { cellTok, dirTok } = parsePutArgs(rest);
  const xy  = cellToXY(cellTok);         if (!xy)           throw new Error("フザケ べヒュー");
  if (state.board[xy.y][xy.x])           throw new Error("フザケ プッチョトムヤ");

  const rel = normalizeDir(dirTok);      if (!DIR_VECT[rel]) throw new Error("フザケ トムヤ (バババ/パロロ/ヘーネ/バーサ) オメ");
  const abs = seatRelToAbs(seat, rel);

  state.board[xy.y][xy.x] = { dir: abs, owner: seat };
  log(`${seatLabel(seat)}: トムヤ ${xyLabel(xy)} ${showRel(rel)}`);

  markDone(seat);
  advanceTurn();
  if (!tryAdvancePhase()) logTurnNow();  
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
  markDone(seat);               
  advanceTurn();
  if (!tryAdvancePhase()) logTurnNow();
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
  if (!tryAdvancePhase()) logTurnNow();
  return;
}

  throw new Error("フザケ テメ"); 
}
function handleLaunchCommon(seat, mode, arg){ 
  if (state.phase !== "launch") throw new Error("フザケ パオ ナギ");
  assertTurn(seat);

  

  log(`${seatLabel(seat)}【ナギ】`);
  log(`${seatLabel(seat)}: ${mode==="launch" ? "パオ" : "プア"}`);

  
  const a = resolveArg(mode, arg);
  if (a === "pass") {
    log(`${seatLabel(seat)}: ${mode==="launch" ? "パオ" : "プア"} ムクン`);
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

  
  const { path, exit, bends } = traceAnimal(seat, mode);

  let delta = 0;
  if (exit === "loop")       delta = -5;
  else if (exit === seat)    delta = bends + 1;
  else if (["N","E","S","W"].includes(exit)) delta = -bends;

  
  if (mode === "launch2" && state.vow2x[seat]?.active) {
    delta *= 2;
    log(`${seatLabel(seat)}: ププアププア イヒ`);
    state.vow2x[seat].active = false;
  }

  state.players[seat].score = (state.players[seat].score || 0) + delta;

  const showExit = (ex)=> ex === "loop" ? "チキン" : (seatLabel(ex) || ex);
  log(`→ ${showExit(exit)} トムヤ${bends} ゾーサン${delta}`);

  
  broadcastAll({ type: "path", seat, path, exit, scoreDelta: delta, bends, mode });

  
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
  } else {
    logTurnNow();
  }

  
  broadcastAll({ type:"state", data:snapshot() });
}




function hardReset(){
  state.board = Array.from({length:SIZE},()=>Array(SIZE).fill(null));
  state.arrows = {};
  state.phase = "lobby";
  state.turnIdx = 0;
  state.logs = [];
  state.phaseActions = {};
  state.players = {};

  
  state.reverseActive = false;
  state.reverseUsed   = false;

  broadcastAll({ type: "you", seat: null });
  log("— シャーンシャーン —");
  broadcastAll({ type: "state", data: snapshot() });
  state.lastTurnSeat = null;
}

const RECONNECT_GRACE_MS = 15000;
const ghosts = new Map();
const CLOSE_GRACE_MS = 4000;             
const pendingCloseTimers = new Map();
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  const id = Math.random().toString(36).slice(2,8);
  let mySeat = null;
  let myName = id;
  let pendingSeat = null;
  let myCid = null; 
  let dcTimer = null; 

  ws.send(JSON.stringify({type:"state", data:snapshot()}));
  ws.send(JSON.stringify({type:"hello", id}));

ws.on("message", (buf)=>{
  try{
    const m = JSON.parse(buf.toString());

    
    if (m.type === "pull") {
      ws.send(JSON.stringify({ type: "state", data: snapshot() }));
      return;
    }

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

    ws.send(JSON.stringify({ type:"you", seat: mySeat }));
    broadcastAll({ type:"state", data: snapshot() });
  }
  return;
}





if (m.type === "resetGame") {
  
  for (const s of SEATS) if (state.players[s]) state.players[s].score = 0;

  if (!everyoneSeated()){
    
    state.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    state.arrows = {};
    state.phaseActions = {};
    state.turnIdx = 0;
    state.reverseActive = false;
    state.reverseUsed   = false;
    state.lastTurnSeat  = null;
    state.phase = "lobby";

    log("— パオシャーンシャーン —");
    broadcastAll({type:"state", data:snapshot()});
    return;
  }

  resetBoard();
  log("— パオシャーンシャーン —");
  logTurnNow(true);
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
  if (!SEATS.includes(want)) {
    throw new Error(`オマ ${SEAT_LABELS.N}/${SEAT_LABELS.E}/${SEAT_LABELS.S}/${SEAT_LABELS.W} `);
  }

  if (mySeat === want && state.players[want]){
    state.players[want].ws = ws;
    ws.send(JSON.stringify({ type:"you", seat: mySeat }));
    broadcastAll({ type:"state", data: snapshot() });
    maybeStartGame();
    return;
  }

if (seatInUse(want)) {
 const p = state.players[want];
 if (!p) throw new Error("フザケ オマ");
 
 if (p.cid === (myCid || "")) {
   
   mySeat = want;
   myName = p.name || myName;
   if (p.dcTimer) { clearTimeout(p.dcTimer); delete p.dcTimer; }
   p.ws = ws;
   p.disconnectedAt = null;
   ws.send(JSON.stringify({type:"you", seat: mySeat}));
   broadcastAll({ type:"state", data:snapshot() });
   return;
 }

 if (!p.ws && p.disconnectedAt && Date.now() - p.disconnectedAt < RECONNECT_GRACE_MS) {
   throw new Error("フザケ オマ（再接続待ち）");
 }

 throw new Error("フザケ オマ");
 }

  if (mySeat){ delete state.players[mySeat]; }

  
  mySeat = want;
  state.players[mySeat] = {
    id,
    cid: myCid || id,
    name: myName,
    ws,
    score: 0, 
  };

  log(`${SEAT_LABELS[mySeat]}: ${myName} プッチョオマ`);

  ws.send(JSON.stringify({ type:"you", seat: mySeat }));
  broadcastAll({ type:"state", data: snapshot() });
  maybeStartGame();

  if (state.phase !== "lobby" && SEAT_ORDER[state.turnIdx] === mySeat) {
    logTurnNow(true);
    broadcastAll({ type:"state", data: snapshot() });
  }
  return;
}


    if (m.type === "cmd"){
      if (!mySeat) throw new Error("シャーンシャーン オマ オメ");
      onCommand(mySeat, m.text || "");
 ws.send(JSON.stringify({ type: "ok", for: "cmd" }));
 return;
}

    if (m.type === "reset") {
      
      hardReset();
      return;
    }

  }catch(err){
    ws.send(JSON.stringify({type:"error", message: String(err.message||err)}));
  }
});


ws.on("close", ()=>{
  if (!mySeat) return;

  const seat   = mySeat;
  const info   = state.players[seat];
  const oldWs  = info?.ws || ws;
  const cidKey = info?.cid;
  const timer = setTimeout(()=>{
    const stillSame = state.players[seat] && state.players[seat].ws === oldWs;
    if (stillSame) {
      const name = state.players[seat]?.name || "";
      log(`${seatLabel(seat)}: ${name ? name + " " : ""}ヒンン オマ`); 

      delete state.players[seat];
      delete state.arrows[seat];
      delete state.phaseActions[seat];

      broadcastAll({ type:"state", data: snapshot() });
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
    try { ws.ping(); } catch {}
  });
}, 30000);

process.on("unhandledRejection", (e)=>console.error("unhandledRejection:", e));
process.on("uncaughtException", (e)=>{ console.error("uncaughtException:", e); process.exit(1); });

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log("listening on http://localhost:"+PORT, "NODE_ENV=", process.env.NODE_ENV);
});
server.on("error", (e)=>console.error("listen error:", e));