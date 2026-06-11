// レベル候補1件の検証CLI(レベル設計の反復用)。
// 実行: node tools/check-level.mjs <candidate.json>
//   candidate.json = {"name": "...", "facing": "N|E|S|W", "map": ["###", ...]}
// 標準出力に JSON 1行:
//   成功: {ok:true, pushes, moves, states, solution, nearestBoxSteps, front, width, height}
//   失敗: {ok:false, error}
// 付帯チェック(一人称プレイアビリティ):
//   nearestBoxSteps = 開始位置から「どれかの箱に隣接するマス」までの最短歩数(0=開幕隣接)
//   front           = 開始時に正面1マチにあるもの('#'壁 / '$'箱 / ' '床)

import fs from 'node:fs';
import { parseLevel, reachable, DIRS, DIR_LIST, key, unkey } from '../js/sokoban.js';
import { solve, buildMoves } from './solver.mjs';

function out(obj) {
  console.log(JSON.stringify(obj));
  process.exitCode = obj.ok ? 0 : 1;
}

function check(def) {
  const st = parseLevel(def); // バリデーション(プレイヤー1人/箱=ゴール数/外周閉鎖)

  const res = solve(def);
  if (res.error) {
    out({ ok: false, error: res.error, states: res.states });
    return;
  }
  const moves = buildMoves(def, res.pushChain);

  // 開始位置から最寄りの「箱に隣接するマス」までの歩数(箱は障害物扱い)
  const adjacent = new Set();
  for (const bk of st.boxes) {
    const [bx, bz] = unkey(bk);
    for (const dir of DIR_LIST) {
      const k = key(bx + DIRS[dir].dx, bz + DIRS[dir].dz);
      if (st.floors.has(k) && !st.boxes.has(k)) adjacent.add(k);
    }
  }
  let nearestBoxSteps = null;
  {
    let q = [key(st.player.x, st.player.z)];
    const seen = new Set(q);
    let depth = 0;
    outer: while (q.length) {
      for (const k of q) if (adjacent.has(k)) { nearestBoxSteps = depth; break outer; }
      const nq = [];
      for (const k of q) {
        const [x, z] = unkey(k);
        for (const dir of DIR_LIST) {
          const nk = key(x + DIRS[dir].dx, z + DIRS[dir].dz);
          if (seen.has(nk) || !st.floors.has(nk) || st.boxes.has(nk)) continue;
          seen.add(nk);
          nq.push(nk);
        }
      }
      q = nq;
      depth++;
    }
  }

  const f = DIRS[def.facing];
  const frontK = key(st.player.x + f.dx, st.player.z + f.dz);
  const front = st.walls.has(frontK) ? '#' : st.boxes.has(frontK) ? '$' : ' ';

  out({
    ok: true,
    pushes: res.pushChain.length,
    moves: moves.length,
    states: res.states,
    solution: moves.join(''),
    nearestBoxSteps,
    front,
    width: st.width,
    height: st.height,
  });
}

try {
  check(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
} catch (e) {
  out({ ok: false, error: e.message });
}
