// 全レベルの可解性を BFS(押し手最少)で機械検証するツール。
// 実行: node tools/verify-levels.mjs
// 出力: 各レベルの可否・最少押し数・完全な手順(歩行込み)。失敗があれば exit 1。
// 手順はゲーム本体の attemptMove で再生して二重検証する。

import { parseLevel, attemptMove, isSolved } from '../js/sokoban.js';
import { LEVELS } from '../js/levels.js';
import { solve, buildMoves } from './solver.mjs';

let allOk = true;

LEVELS.forEach((def, i) => {
  try {
    const res = solve(def);
    if (res.error) throw new Error(res.error);
    const moves = buildMoves(def, res.pushChain);

    // ゲームエンジンで再生して二重検証
    const game = parseLevel(def);
    for (const dir of moves) {
      const r = attemptMove(game, dir);
      if (!r.ok) throw new Error(`エンジン再生に失敗: ${moves.join('')} の ${dir}`);
    }
    if (!isSolved(game)) throw new Error('再生後に未クリア(エンジンとソルバーの不一致)');

    console.log(
      `✓ L${i + 1}「${def.name}」 可解 — 最少押し ${res.pushChain.length} / 総手数 ${moves.length} / 探索 ${res.states} 状態`
    );
    console.log(`  解: ${moves.join('')}`);
  } catch (e) {
    allOk = false;
    console.error(`✗ L${i + 1}「${def.name}」 ${e.message}`);
  }
});

console.log(allOk ? '\nすべてのレベルが可解です。' : '\n修正が必要なレベルがあります。');
process.exitCode = allOk ? 0 : 1;
