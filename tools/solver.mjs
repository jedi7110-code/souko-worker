// 押し手最少 BFS ソルバー(verify-levels.mjs / check-level.mjs 共用)。
// 角デッドロック枝刈り+プレイヤー到達領域の正規化つき。

import {
  parseLevel,
  reachable,
  DIRS,
  DIR_LIST,
  key,
  unkey,
} from '../js/sokoban.js';

const MAX_STATES = 500000;

const sortedBoxKey = (boxes) => [...boxes].sort().join(';');

// プレイヤー到達領域の正規化(同じ押し局面の同一視に使う)
function canonOf(reach, width) {
  let bestV = Infinity;
  let bestK = 'none';
  for (const k of reach) {
    const [x, z] = unkey(k);
    const v = z * width + x;
    if (v < bestV) {
      bestV = v;
      bestK = k;
    }
  }
  return bestK;
}

// 角デッドロック: ゴール以外のマスで直交2方向が壁なら、その箱は二度と動かせない
function makeDeadCheck(state) {
  const w = (x, z) => state.walls.has(key(x, z));
  return (x, z) => {
    if (state.goals.has(key(x, z))) return false;
    return (
      (w(x, z - 1) && w(x - 1, z)) ||
      (w(x, z - 1) && w(x + 1, z)) ||
      (w(x, z + 1) && w(x - 1, z)) ||
      (w(x, z + 1) && w(x + 1, z))
    );
  };
}

// 押し手最少の BFS。成功なら {pushChain, states}, 失敗なら {error, states}
export function solve(def) {
  const st = parseLevel(def);
  const { floors, width, goals } = st;
  const isDead = makeDeadCheck(st);
  const allOnGoal = (boxes) => {
    for (const b of boxes) if (!goals.has(b)) return false;
    return true;
  };

  const startBoxes = new Set(st.boxes);
  const startReach = reachable(floors, startBoxes, st.player.x, st.player.z);
  const startKey = canonOf(startReach, width) + '|' + sortedBoxKey(startBoxes);

  // stateKey → {prevKey, push:{boxFromK, dir, pusherK}}
  const visited = new Map();
  visited.set(startKey, { prevKey: null });

  if (allOnGoal(startBoxes)) return { pushChain: [], states: 1 };

  let queue = [{ boxes: startBoxes, player: { ...st.player }, stateKey: startKey }];

  while (queue.length) {
    const next = [];
    for (const node of queue) {
      const reach = reachable(floors, node.boxes, node.player.x, node.player.z);
      for (const bk of node.boxes) {
        const [bx, bz] = unkey(bk);
        for (const dir of DIR_LIST) {
          const d = DIRS[dir];
          const pusherK = key(bx - d.dx, bz - d.dz);
          const tx = bx + d.dx;
          const tz = bz + d.dz;
          const targetK = key(tx, tz);
          if (!reach.has(pusherK)) continue;
          if (!floors.has(targetK) || node.boxes.has(targetK)) continue;
          if (isDead(tx, tz)) continue;

          const newBoxes = new Set(node.boxes);
          newBoxes.delete(bk);
          newBoxes.add(targetK);
          const newReach = reachable(floors, newBoxes, bx, bz);
          const stateKey = canonOf(newReach, width) + '|' + sortedBoxKey(newBoxes);
          if (visited.has(stateKey)) continue;
          visited.set(stateKey, { prevKey: node.stateKey, push: { boxFromK: bk, dir, pusherK } });
          if (visited.size > MAX_STATES) return { error: '状態数が上限を超えました', states: visited.size };

          if (allOnGoal(newBoxes)) {
            const pushChain = [];
            let k = stateKey;
            while (k) {
              const rec = visited.get(k);
              if (rec.push) pushChain.unshift(rec.push);
              k = rec.prevKey;
            }
            return { pushChain, states: visited.size };
          }
          next.push({ boxes: newBoxes, player: { x: bx, z: bz }, stateKey });
        }
      }
    }
    queue = next;
  }
  return { error: '解なし(全状態を探索済み)', states: visited.size };
}

// 箱を避けて from → to へ歩く最短経路(dir 配列)。BFS。
function walkPath(floors, boxes, from, to) {
  const toK = key(to.x, to.z);
  const fromK = key(from.x, from.z);
  if (fromK === toK) return [];
  const prev = new Map();
  prev.set(fromK, null);
  let q = [fromK];
  while (q.length) {
    const nq = [];
    for (const k of q) {
      const [x, z] = unkey(k);
      for (const dir of DIR_LIST) {
        const d = DIRS[dir];
        const nk = key(x + d.dx, z + d.dz);
        if (prev.has(nk) || !floors.has(nk) || boxes.has(nk)) continue;
        prev.set(nk, { k, dir });
        if (nk === toK) {
          const dirs = [];
          let cur = nk;
          while (prev.get(cur)) {
            dirs.unshift(prev.get(cur).dir);
            cur = prev.get(cur).k;
          }
          return dirs;
        }
        nq.push(nk);
      }
    }
    q = nq;
  }
  return null;
}

// 押しチェーン → 歩行込みの完全な手順
export function buildMoves(def, pushChain) {
  const st = parseLevel(def);
  const boxes = new Set(st.boxes);
  let player = { ...st.player };
  const moves = [];
  for (const p of pushChain) {
    const [px, pz] = unkey(p.pusherK);
    const path = walkPath(st.floors, boxes, player, { x: px, z: pz });
    if (path === null) throw new Error('経路復元に失敗');
    moves.push(...path, p.dir);
    const [bx, bz] = unkey(p.boxFromK);
    const d = DIRS[p.dir];
    boxes.delete(p.boxFromK);
    boxes.add(key(bx + d.dx, bz + d.dz));
    player = { x: bx, z: bz };
  }
  return moves;
}
