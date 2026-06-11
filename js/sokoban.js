// 倉庫番の純ロジック — three.js / DOM 非依存。
// ブラウザ(js/main.js ほか)と node(tools/verify-levels.mjs)の両方から import される。
// 座標系: x=列(東が+), z=行(南が+)。北 = -z。マップ文字列の上が北。

export const DIRS = {
  N: { dx: 0, dz: -1 },
  E: { dx: 1, dz: 0 },
  S: { dx: 0, dz: 1 },
  W: { dx: -1, dz: 0 },
};

export const DIR_LIST = ['N', 'E', 'S', 'W'];

export const key = (x, z) => `${x},${z}`;
export const unkey = (k) => k.split(',').map(Number);

// レベル定義 {name, facing, map:[string]} → 新しいゲーム状態
// 文字: # 壁 / @ プレイヤー / $ 箱 / . ゴール / * 箱onゴール / + プレイヤーonゴール
export function parseLevel(def) {
  const lines = def.map;
  const height = lines.length;
  const width = Math.max(...lines.map((l) => l.length));
  const walls = new Set();
  const goals = new Set();
  const boxes = new Set();
  let player = null;

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const ch = lines[z][x] ?? ' ';
      const k = key(x, z);
      if (ch === '#') walls.add(k);
      else if (ch === '$') boxes.add(k);
      else if (ch === '*') { boxes.add(k); goals.add(k); }
      else if (ch === '.') goals.add(k);
      else if (ch === '@' || ch === '+') {
        if (player) throw new Error(`${def.name}: プレイヤーが複数います`);
        player = { x, z };
        if (ch === '+') goals.add(k);
      } else if (ch !== ' ') {
        throw new Error(`${def.name}: 不明な文字 "${ch}" (${x},${z})`);
      }
    }
  }

  if (!player) throw new Error(`${def.name}: プレイヤー(@)がいません`);
  if (boxes.size === 0) throw new Error(`${def.name}: 箱がありません`);
  if (boxes.size !== goals.size) {
    throw new Error(`${def.name}: 箱${boxes.size}個に対しゴール${goals.size}個`);
  }

  // プレイヤーから到達できる床を flood fill(箱は通過扱い)。
  // 到達セルが外周に達したら壁で閉じていないレベルとしてエラー。
  const floors = new Set();
  const stack = [[player.x, player.z]];
  while (stack.length) {
    const [x, z] = stack.pop();
    const k = key(x, z);
    if (floors.has(k) || walls.has(k)) continue;
    if (x <= 0 || z <= 0 || x >= width - 1 || z >= height - 1) {
      throw new Error(`${def.name}: 壁で閉じていません (${x},${z})`);
    }
    floors.add(k);
    stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
  }

  for (const b of boxes) {
    if (!floors.has(b)) throw new Error(`${def.name}: プレイヤーから届かない箱 (${b})`);
  }
  for (const g of goals) {
    if (!floors.has(g)) throw new Error(`${def.name}: プレイヤーから届かないゴール (${g})`);
  }

  return {
    name: def.name,
    facing: def.facing ?? 'N',
    width,
    height,
    walls,
    goals,
    floors,
    boxes,
    player,
    moves: 0,
    pushes: 0,
    history: [],
    solved: false,
  };
}

export function isSolved(state) {
  for (const b of state.boxes) if (!state.goals.has(b)) return false;
  return true;
}

// 1手実行。成功時は状態を書き換え、アニメーション用の差分を返す。
// allowPush=false のとき箱マスへの移動はブロック(後退・横歩き用。前進だけが押せる)。
export function attemptMove(state, dir, { allowPush = true } = {}) {
  const d = DIRS[dir];
  if (!d) throw new Error(`不正な方向 ${dir}`);
  const from = { ...state.player };
  const tx = from.x + d.dx;
  const tz = from.z + d.dz;
  const tk = key(tx, tz);

  if (state.walls.has(tk)) return { ok: false, reason: 'wall' };

  if (state.boxes.has(tk)) {
    if (!allowPush) return { ok: false, reason: 'box' };
    const bx = tx + d.dx;
    const bz = tz + d.dz;
    const bk = key(bx, bz);
    if (state.walls.has(bk) || state.boxes.has(bk)) return { ok: false, reason: 'blocked' };
    state.boxes.delete(tk);
    state.boxes.add(bk);
    state.player = { x: tx, z: tz };
    state.moves += 1;
    state.pushes += 1;
    state.history.push({ px: from.x, pz: from.z, boxFromK: tk, boxToK: bk });
    state.solved = isSolved(state);
    return {
      ok: true,
      pushed: true,
      from,
      to: { x: tx, z: tz },
      boxFrom: { x: tx, z: tz },
      boxTo: { x: bx, z: bz },
      boxFromK: tk,
      boxToK: bk,
      won: state.solved,
    };
  }

  state.player = { x: tx, z: tz };
  state.moves += 1;
  state.history.push({ px: from.x, pz: from.z });
  return { ok: true, pushed: false, from, to: { x: tx, z: tz }, won: false };
}

// 1手戻す。向き(facing)は戻さない仕様。差分を返す(履歴がなければ null)。
export function undo(state) {
  const rec = state.history.pop();
  if (!rec) return null;
  const from = { ...state.player };
  state.player = { x: rec.px, z: rec.pz };
  state.moves = Math.max(0, state.moves - 1);
  let box = null;
  if (rec.boxFromK) {
    state.boxes.delete(rec.boxToK);
    state.boxes.add(rec.boxFromK);
    state.pushes = Math.max(0, state.pushes - 1);
    const [fx, fz] = unkey(rec.boxFromK);
    box = { fromK: rec.boxToK, toK: rec.boxFromK, to: { x: fx, z: fz } };
  }
  state.solved = isSolved(state);
  return { from, to: { ...state.player }, box };
}

// 箱を障害物として (fromX,fromZ) から歩いて到達できるセル集合(ソルバー用)
export function reachable(floors, boxes, fromX, fromZ) {
  const seen = new Set();
  const stack = [key(fromX, fromZ)];
  while (stack.length) {
    const k = stack.pop();
    if (seen.has(k) || !floors.has(k) || boxes.has(k)) continue;
    seen.add(k);
    const [x, z] = unkey(k);
    stack.push(key(x + 1, z), key(x - 1, z), key(x, z + 1), key(x, z - 1));
  }
  return seen;
}
