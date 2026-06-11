// 入力 → コマンドキュー → トゥイーン実行のステートマシン。
// 論理(sokoban.js)は即時確定し、見た目(カメラ・箱メッシュ)だけを補間する。
// Undo/リセットは「キュー全破棄 → トゥイーン即終端 → 論理適用」の順を厳守。

import { attemptMove, undo as sokoUndo } from './sokoban.js';
import { BOX, FOV, FOV_LOOKUP, NECK_Y, NECK_BACK, EYE_OFF_Y, EYE_OFF_Z } from './scene3d.js';

const FACINGS = ['N', 'E', 'S', 'W'];
// 北=-Z がヨー0。E は -90°(three.js のカメラは -Z 向きが正面)
const YAW = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 };
const DUR = { move: 160, push: 210, turn: 150, undo: 130, bump: 130 };
const QUEUE_MAX = 2; // キーボード入力の先行入力数

// 押し中のカメラ引き: 箱が画面いっぱいだと押している実感が出ないため、
// 視点を少し後ろ・下へ引いて「床 + 箱の足元 + 自分の両手」を同時に見せる
const PUSH_VIEW_BACK = 0.32;  // 後退量(m)。これ以上引く/下げると自分の胴体が画面下に映り込む
const PUSH_VIEW_PITCH = 0.2;  // 下向き角(rad)。目線が低い(≈1.15m)ぶん浅くても床が見える

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function createControls({ getState, sceneApi, ui, onWin, onReset, onMenu }) {
  let facing = 'N';
  let yawAnim = 0;                // 描画用ヨー(トゥイーン中の値)
  let pos = { wx: 0, wz: 0 };     // 描画用ワールド座標
  let tween = null;
  let queue = [];
  let locked = false;             // クリア後の入力ロック
  let speedScale = 1;             // リプレイ用の倍速
  let stepCounter = 0;            // 移動トゥイーンごとに増える歩数ID

  // 進行方向が体の向きに対して前か後ろか(±1)。横歩きは前扱い
  function moveSignOf(fromW, toW) {
    const dot = (toW.wx - fromW.wx) * -Math.sin(yawAnim) + (toW.wz - fromW.wz) * -Math.cos(yawAnim);
    return dot < -1e-6 ? -1 : 1;
  }

  // カメラ視点まわり
  let lookT = 0;                  // 0=正面, 1=真上(Space)
  let lookTarget = 0;
  let pushView = 0;               // 0=通常, 1=押し中の引き視点
  let fovCur = FOV;
  let dragging = false;
  let yawOff = 0;
  let pitchOff = 0;
  let lastPose = { pitch: 0, yaw: 0, yawOff: 0, pitchOff: 0, lookT: 0, fov: FOV };

  const worldOf = (cell) => ({ wx: sceneApi.worldX(cell.x), wz: sceneApi.worldZ(cell.z) });

  function resetForLevel(state) {
    facing = state.facing;
    yawAnim = YAW[facing];
    pos = worldOf(state.player);
    queue = [];
    tween = null;
    locked = false;
    lookTarget = 0;
    pushView = 0;
    yawOff = 0;
    pitchOff = 0;
    speedScale = 1;
    sceneApi.avatar.reset(); // テレポートで腕の構え・歩行状態を持ち越さない
  }

  // ---- コマンド実行 ----

  function dirFor(type) {
    const i = FACINGS.indexOf(facing);
    if (type === 'F') return facing;
    if (type === 'B') return FACINGS[(i + 2) % 4];
    if (type === 'SL') return FACINGS[(i + 3) % 4];
    if (type === 'SR') return FACINGS[(i + 1) % 4];
    return facing;
  }

  function startTurnTween() {
    tween = { type: 'turn', t: 0, dur: DUR.turn * speedScale, from: yawAnim, to: YAW[facing] };
  }

  function startNext() {
    if (tween || locked) return;
    const cmd = queue.shift();
    if (!cmd) {
      speedScale = 1; // リプレイが終わったら通常速度へ
      return;
    }

    if (cmd.type === 'TL' || cmd.type === 'TR') {
      const i = FACINGS.indexOf(facing);
      facing = FACINGS[(i + (cmd.type === 'TR' ? 1 : 3)) % 4];
      startTurnTween();
      return;
    }
    if (cmd.type === 'turnTo') {
      if (facing !== cmd.facing) {
        facing = cmd.facing;
        startTurnTween();
      } else {
        startNext();
      }
      return;
    }

    // 移動系。前進(F)とリプレイ(ABS)だけが箱を押せる
    const dir = cmd.type === 'ABS' ? cmd.dir : dirFor(cmd.type);
    const allowPush = cmd.type === 'F' || cmd.type === 'ABS';
    const state = getState();
    const res = attemptMove(state, dir, { allowPush });

    if (!res.ok) {
      // ブロック: 行こうとした方向に小さくバンプ。前方(押し)の失敗だけ両手を構える
      const d = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[dir];
      tween = { type: 'bump', t: 0, dur: DUR.bump * speedScale, dx: d[0], dz: d[1], raiseArms: allowPush };
      return;
    }

    ui.updateHUD(state);
    const fromW = { ...pos };
    const toW = worldOf(res.to);
    tween = {
      type: 'move',
      t: 0,
      dur: (res.pushed ? DUR.push : DUR.move) * speedScale,
      fromW,
      toW,
      won: res.won,
      stepId: ++stepCounter,                    // 歩の左右交互の境界をアバターに明示
      moveSign: moveSignOf(fromW, toW),         // 後退歩きはスイング反転
    };
    if (res.pushed) {
      const mesh = sceneApi.rekeyBox(res.boxFromK, res.boxToK);
      tween.boxMesh = mesh;
      tween.boxFromW = { wx: mesh.position.x, wz: mesh.position.z };
      tween.boxToW = worldOf(res.boxTo);
    }
    if (res.won) {
      // 論理的に勝った瞬間に入力を締める(トゥイーン完了後にオーバーレイ)
      locked = true;
      queue = [];
    }
  }

  function finishTween(tw) {
    if (tw.type === 'turn') {
      yawAnim = angleLerp(tw.from, tw.to, 1);
    } else if (tw.type === 'move') {
      pos = { ...tw.toW };
      if (tw.boxMesh) {
        tw.boxMesh.position.set(tw.boxToW.wx, BOX / 2, tw.boxToW.wz);
        sceneApi.refreshGoalGlow(getState());
      }
      if (tw.won) setTimeout(() => onWin(), 380);
    }
  }

  // 進行中トゥイーンを即終端(Undo/リセット前の整合化)
  function snapTween() {
    if (!tween) return;
    const tw = tween;
    tween = null;
    finishTween(tw);
  }

  function undoAction() {
    if (locked || ui.isModalOpen()) return;
    const state = getState();
    if (state.history.length === 0) return; // 戻すものがなければ進行中の見た目もそのまま
    queue = [];
    // 移動トゥイーンはスナップせずその場から巻き戻す(論理とrekeyは開始時に適用済み)。
    // ターンだけは向きが確定しないため即終端する。
    if (tween && tween.type === 'move') tween = null;
    else snapTween();
    const rec = sokoUndo(state);
    ui.updateHUD(state);
    const fromW = { ...pos };
    const toW = worldOf(state.player);
    tween = {
      type: 'move',
      t: 0,
      dur: DUR.undo,
      fromW,
      toW,
      won: false,
      stepId: ++stepCounter,
      moveSign: moveSignOf(fromW, toW),
    };
    if (rec.box) {
      const mesh = sceneApi.rekeyBox(rec.box.fromK, rec.box.toK);
      tween.boxMesh = mesh;
      tween.boxFromW = { wx: mesh.position.x, wz: mesh.position.z };
      tween.boxToW = worldOf(rec.box.to);
    }
  }

  function enqueueKey(cmd) {
    if (locked || queue.length >= QUEUE_MAX) return;
    queue.push(cmd);
  }

  // ---- 入力 ----

  function onKeyDown(e) {
    if (ui.isModalOpen()) return; // モーダル中のキーは ui 側が処理
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': e.preventDefault(); enqueueKey({ type: 'F' }); break;
      case 'KeyS': case 'ArrowDown': e.preventDefault(); enqueueKey({ type: 'B' }); break;
      case 'KeyA': case 'ArrowLeft': e.preventDefault(); enqueueKey({ type: 'TL' }); break;
      case 'KeyD': case 'ArrowRight': e.preventDefault(); enqueueKey({ type: 'TR' }); break;
      case 'KeyQ': enqueueKey({ type: 'SL' }); break;
      case 'KeyE': enqueueKey({ type: 'SR' }); break;
      case 'KeyZ': case 'Backspace': e.preventDefault(); if (!e.repeat) undoAction(); break;
      case 'KeyR': if (!e.repeat) onReset(); break;
      case 'Space': e.preventDefault(); lookTarget = 1; break;
      case 'Escape': if (!e.repeat) onMenu(); break;
      case 'KeyH': if (!e.repeat) ui.toggleHelp(); break;
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') lookTarget = 0; // モーダル中でも解除だけは通す
  }

  const canvas = sceneApi.renderer.domElement;

  function onPointerDown(e) {
    if (e.button !== 0 || ui.isModalOpen()) return;
    dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 合成イベント等は無視 */ }
  }
  function onPointerMove(e) {
    if (!dragging) return;
    yawOff = Math.max(-1.2, Math.min(1.2, yawOff - e.movementX * 0.004));
    pitchOff = Math.max(-1.3, Math.min(1.3, pitchOff - e.movementY * 0.004));
  }
  function onPointerUp() {
    dragging = false; // オフセットは tick 内でスプリングで0へ
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  // ---- 毎フレーム ----

  function tick(dt) {
    if (!tween) startNext();

    let bumpX = 0;
    let bumpZ = 0;

    if (tween) {
      tween.t += dt * 1000;
      const k = easeInOut(Math.min(1, tween.t / tween.dur));
      if (tween.type === 'turn') {
        yawAnim = angleLerp(tween.from, tween.to, k);
      } else if (tween.type === 'move') {
        pos.wx = lerp(tween.fromW.wx, tween.toW.wx, k);
        pos.wz = lerp(tween.fromW.wz, tween.toW.wz, k);
        if (tween.boxMesh) {
          tween.boxMesh.position.set(
            lerp(tween.boxFromW.wx, tween.boxToW.wx, k),
            BOX / 2,
            lerp(tween.boxFromW.wz, tween.boxToW.wz, k)
          );
        }
      } else if (tween.type === 'bump') {
        const a = Math.sin(Math.PI * Math.min(1, tween.t / tween.dur)) * 0.13;
        bumpX = tween.dx * a;
        bumpZ = tween.dz * a;
      }
      if (tween.t >= tween.dur) {
        const tw = tween;
        tween = null;
        finishTween(tw);
        startNext(); // 隙間なく次のコマンドへ
      }
    }

    // 押し中(押そうとしてブロックされた時も)は引き視点へ。立ち上がりは速く、戻りはゆっくり
    const pushingView =
      !!tween &&
      ((tween.type === 'move' && tween.boxMesh) || (tween.type === 'bump' && tween.raiseArms));
    pushView += ((pushingView ? 1 : 0) - pushView) * Math.min(1, dt * (pushingView ? 10 : 4));

    // Space 見上げ(クリティカルダンプ風の補間)
    lookT += (lookTarget - lookT) * Math.min(1, dt * 8);
    // 見上げ中は FOV_LOOKUP へ遷移して盤面全体を映りやすく
    const targetFov = lerp(FOV, FOV_LOOKUP, lookT);
    if (Math.abs(targetFov - fovCur) > 0.02) {
      fovCur += (targetFov - fovCur) * Math.min(1, dt * 8);
      sceneApi.camera.fov = fovCur;
      sceneApi.camera.updateProjectionMatrix();
    }

    // ドラッグ解放後はオフセットをスプリングで戻す
    if (!dragging) {
      const decay = Math.exp(-9 * dt);
      yawOff *= decay;
      pitchOff *= decay;
    }

    // 押し中の下向きと引きは、Space見上げ中は無効化(lookT で打ち消す)
    const pushK = pushView * (1 - lookT);
    const pitch = Math.max(
      -1.35,
      Math.min(Math.PI / 2, lookT * (Math.PI / 2) + pitchOff - PUSH_VIEW_PITCH * pushK)
    );
    const yawView = yawAnim + yawOff;
    lastPose = { pitch, yaw: yawView, yawOff, pitchOff, lookT, pushView, fov: fovCur };

    // カメラ = 首関節(体軸の少し後ろ・高さ NECK_Y)を中心に目が回る「首を動かす」感覚。
    // 見上げると視点がわずかに後上方へ動き、首をそらした体勢になる。
    const wxB = pos.wx + bumpX;
    const wzB = pos.wz + bumpZ;
    const neckX = wxB + Math.sin(yawAnim) * NECK_BACK;
    const neckZ = wzB + Math.cos(yawAnim) * NECK_BACK;
    const ey = EYE_OFF_Y * Math.cos(pitch) + EYE_OFF_Z * Math.sin(pitch);
    const ez = EYE_OFF_Y * Math.sin(pitch) - EYE_OFF_Z * Math.cos(pitch);
    const cam = sceneApi.camera;
    const back = PUSH_VIEW_BACK * pushK; // 視線方向の逆へ水平に引く
    cam.position.set(
      neckX + ez * Math.sin(yawView) + Math.sin(yawView) * back,
      NECK_Y + ey,
      neckZ + ez * Math.cos(yawView) + Math.cos(yawView) * back
    );
    cam.rotation.set(pitch, yawView, 0);

    // アバター更新: 体=論理の向き、首・頭=実際の視線(鏡に首の動きが映る)
    let mode = 'idle';
    let modePhase = 0; // 脚を動かすのは移動トゥイーンだけ(turn/bumpで足踏みさせない)
    let stepId = null;
    let moveSign = 1;
    if (tween) {
      if (tween.type === 'move') {
        mode = tween.boxMesh ? 'push' : 'walk';
        modePhase = Math.min(1, tween.t / tween.dur);
        stepId = tween.stepId;
        moveSign = tween.moveSign;
      } else if (tween.type === 'bump' && tween.raiseArms) {
        mode = 'push'; // 押し失敗: 両手だけ構える
      }
    }
    sceneApi.avatar.update(dt, {
      wx: wxB,
      wz: wzB,
      bodyYaw: yawAnim,
      lookYaw: yawOff,
      lookPitch: pitch,
      mode,
      modePhase,
      stepId,
      moveSign,
    });
  }

  // ---- デバッグ/リプレイ用 ----

  function step(dir) {
    queue.push({ type: 'turnTo', facing: dir }, { type: 'ABS', dir });
  }

  function replay(moves, { fast = true } = {}) {
    if (locked) return;
    queue = [];
    speedScale = fast ? 0.45 : 1;
    for (const ch of moves) step(ch);
  }

  return {
    resetForLevel,
    tick,
    undoAction,
    step,
    replay,
    lookUp: (b, instant = false) => {
      lookTarget = b ? 1 : 0;
      if (instant) lookT = lookTarget; // テスト・デバッグ用に即座に反映
    },
    facing: () => facing,
    pose: () => ({ ...lastPose }),
    isBusy: () => tween !== null || queue.length > 0,
  };
}
