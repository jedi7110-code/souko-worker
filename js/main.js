// エントリポイント: モジュールを束ね、ゲームループを回し、デバッグ用 __game を公開する。

import { LEVELS } from './levels.js';
import { parseLevel } from './sokoban.js';
import { createScene } from './scene3d.js';
import { createControls } from './controls.js';
import { createUI } from './ui.js';

const sceneApi = createScene(document.getElementById('app'));

let state = null;
let levelIndex = 0;

const ui = createUI({
  levels: LEVELS,
  onSelectLevel: (i) => loadLevel(i),
  onNextLevel: () => loadLevel((levelIndex + 1) % LEVELS.length),
  onReplayLevel: () => loadLevel(levelIndex),
});

const controls = createControls({
  getState: () => state,
  sceneApi,
  ui,
  onWin: () => {
    const { isNewBest } = ui.saveProgress(levelIndex, state.moves);
    ui.showClear({
      moves: state.moves,
      pushes: state.pushes,
      isNewBest,
      isLast: levelIndex === LEVELS.length - 1,
    });
  },
  onReset: () => loadLevel(levelIndex),
  onMenu: () => ui.openMenu(),
});

function loadLevel(i) {
  levelIndex = i;
  state = parseLevel(LEVELS[i]);
  sceneApi.loadLevel(state);
  controls.resetForLevel(state);
  ui.updateHUD(state, i);
}

loadLevel(ui.firstUnclearedIndex());
ui.maybeShowFirstHelp();

window.addEventListener('resize', () => sceneApi.onResize());

let last = performance.now();
sceneApi.renderer.setAnimationLoop((t) => {
  const dt = Math.min((t - last) / 1000, 0.05);
  last = t;
  controls.tick(dt);
  sceneApi.render();
});

// デバッグ・自動テスト用フック(E2E でソルバーの解を再生する)
window.__game = {
  loadLevel,
  step: (dir) => controls.step(dir),
  replay: (moves, opts) => controls.replay(moves, opts),
  undo: () => controls.undoAction(),
  reset: () => loadLevel(levelIndex),
  lookUp: (b, instant) => controls.lookUp(b, instant),
  pose: () => controls.pose(),
  isBusy: () => controls.isBusy(),
  // 検証用: 今のフレームを縮小JPEG(dataURL)で返す(preserveDrawingBuffer なしでも
  // render 直後なら描画バッファが有効なことを利用)
  snap: (w = 480, q = 0.7) => {
    sceneApi.render();
    const src = sceneApi.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round((src.height / src.width) * w);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  },
  __dbg: () => sceneApi,
  state: () => ({
    level: levelIndex,
    name: state.name,
    player: { ...state.player },
    facing: controls.facing(),
    boxes: [...state.boxes].sort(),
    moves: state.moves,
    pushes: state.pushes,
    solved: state.solved,
  }),
};
