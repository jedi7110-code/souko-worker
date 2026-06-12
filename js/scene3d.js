// 3Dシーン構築: 床・壁・箱・ゴール・ライト・鏡天井・鏡専用アバター。
// 論理状態(sokoban.js)とメッシュの対応は boxMeshes(key→Mesh)で管理する。

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { key } from './sokoban.js';

export const CELL = 2;      // 1マスの一辺(m)
export const BOX = 1.8;     // 箱の一辺。目線(≈1.15m = NECK_Y + EYE_OFF_Y)よりはるかに高く、圧迫感を出す
export const WALL_H = 4.6;  // 壁の高さ。箱1.8mの2.5倍超で本物の倉庫の通路感を出す。鏡の高さ(ceilH)も連動して上げたので鏡越し俯瞰の読みやすさは維持

// ---- 手続きテクスチャ ----

function makeCrateTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#a8794a';
  g.fillRect(0, 0, 256, 256);
  // 板目
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 ? '#9e6f42' : '#a8794a';
    g.fillRect(0, i * 43, 256, 43);
    g.fillStyle = 'rgba(60, 35, 15, 0.35)';
    g.fillRect(0, i * 43, 256, 2);
  }
  // 木目ノイズ
  for (let i = 0; i < 240; i++) {
    g.fillStyle = `rgba(70, 40, 15, ${Math.random() * 0.09})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 4, 1);
  }
  // 外枠と補強板
  g.strokeStyle = '#7a5230';
  g.lineWidth = 20;
  g.strokeRect(10, 10, 236, 236);
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(18, 18); g.lineTo(238, 238);
  g.moveTo(238, 18); g.lineTo(18, 238);
  g.stroke();
  g.strokeStyle = 'rgba(255, 220, 160, 0.16)';
  g.lineWidth = 3;
  g.strokeRect(21, 21, 214, 214);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 壁テクスチャ: 倉庫の波板鋼板(コルゲート)風。壁の面はセル幅2m×高さ4.6mで
// 縦長なので、キャンバスも縦長(256×512)にして縦の波板が引き伸ばされないようにする
function makeWallTexture() {
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  // ベース: 鋼板のブルーグレー縦グラデーション
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#5a6275');
  grad.addColorStop(1, '#3e4452');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // 縦の波板(コルゲート): 約16px周期。各山の片側に明るいハイライト、反対側に暗い
  // シャドウを縦線で入れて、鋼板が波打って見える立体感を出す
  const period = 16;
  for (let x = 0; x < W; x += period) {
    g.fillStyle = 'rgba(255, 255, 255, 0.12)';
    g.fillRect(x + 2, 0, 2, H);           // 山の左側=ハイライト
    g.fillStyle = 'rgba(0, 0, 0, 0.22)';
    g.fillRect(x + period - 3, 0, 2, H);  // 谷の右側=シャドウ
  }

  // 横の継ぎ目: 高さ1/3・2/3にシーム線+その上にボルト列(明点+暗縁)
  for (const sy of [H / 3, (H * 2) / 3]) {
    g.fillStyle = 'rgba(10, 14, 22, 0.55)';
    g.fillRect(0, sy - 1, W, 3);
    for (let bx = period / 2; bx < W; bx += period * 2) {
      g.fillStyle = 'rgba(0, 0, 0, 0.5)';
      g.beginPath();
      g.arc(bx, sy - 5, 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(210, 220, 235, 0.6)';
      g.beginPath();
      g.arc(bx, sy - 5, 1.6, 0, Math.PI * 2);
      g.fill();
    }
  }

  // 汚れ: 白の微小ドット(下地のムラ)+錆色の小斑点を少量
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.05})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(110, 70, 40, ${0.1 + Math.random() * 0.2})`;
    g.beginPath();
    g.arc(Math.random() * W, Math.random() * H, 1.5 + Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }

  // 最下部約14%: 黄/黒の45°ハザードストライプ帯(幅16px交互)。黄は少し暗めにして
  // 浮きすぎないように。帯の上端に暗い境界線を引く
  const hazTop = Math.round(H * 0.86);
  g.save();
  g.beginPath();
  g.rect(0, hazTop, W, H - hazTop);
  g.clip();
  g.fillStyle = '#1a1a18';
  g.fillRect(0, hazTop, W, H - hazTop);
  g.strokeStyle = '#c9a227'; // 少し暗めの黄
  g.lineWidth = 16;
  for (let d = -H; d < W + H; d += 32) {
    g.beginPath();
    g.moveTo(d, hazTop);
    g.lineTo(d + (H - hazTop), H);
    g.stroke();
  }
  g.restore();
  g.fillStyle = 'rgba(10, 14, 22, 0.7)';
  g.fillRect(0, hazTop - 1, W, 3); // 帯の上端の暗い境界線

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// レベルごとの床: 到達可能マスだけタイル模様を描く(鏡から見たとき盤面が読める)。
// 打ちっぱなしコンクリート風: 控えめなグレーのチェッカー+シミ+塗装の目地+安全ライン
function makeFloorTexture(state) {
  const px = 64;
  const c = document.createElement('canvas');
  c.width = state.width * px;
  c.height = state.height * px;
  const g = c.getContext('2d');
  g.fillStyle = '#14171f'; // 床以外の背景はそのまま
  g.fillRect(0, 0, c.width, c.height);
  const has = (x, z) => state.floors.has(key(x, z));
  for (let z = 0; z < state.height; z++) {
    for (let x = 0; x < state.width; x++) {
      if (!has(x, z)) continue;
      const ox = x * px, oz = z * px;
      // コンクリートグレーの控えめなチェッカー
      g.fillStyle = (x + z) % 2 ? '#34373f' : '#2f323a';
      g.fillRect(ox + 1, oz + 1, px - 2, px - 2);
      // タイルごとの汚れ・シミ(暗い半透明の小矩形・点を数個)
      const stains = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < stains; i++) {
        g.fillStyle = `rgba(0, 0, 0, ${0.04 + Math.random() * 0.08})`;
        const sw = 4 + Math.random() * 14;
        const sh = 4 + Math.random() * 14;
        g.fillRect(ox + 4 + Math.random() * (px - 8 - sw), oz + 4 + Math.random() * (px - 8 - sh), sw, sh);
      }
      // 塗装の目地らしく白枠線は残しつつ透明度を下げる
      g.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      g.strokeRect(ox + 2.5, oz + 2.5, px - 5, px - 5);
      // 到達可能エリアの外周(隣が床でない辺)に黄色の控えめな安全ライン。
      // 倉庫らしさと、壁が高くなった分の鏡俯瞰時の壁際の読みやすさに効く
      g.strokeStyle = 'rgba(201, 162, 39, 0.5)';
      g.lineWidth = 2;
      g.beginPath();
      if (!has(x, z - 1)) { g.moveTo(ox + 3, oz + 3); g.lineTo(ox + px - 3, oz + 3); }       // 上辺
      if (!has(x, z + 1)) { g.moveTo(ox + 3, oz + px - 3); g.lineTo(ox + px - 3, oz + px - 3); } // 下辺
      if (!has(x - 1, z)) { g.moveTo(ox + 3, oz + 3); g.lineTo(ox + 3, oz + px - 3); }       // 左辺
      if (!has(x + 1, z)) { g.moveTo(ox + px - 3, oz + 3); g.lineTo(ox + px - 3, oz + px - 3); } // 右辺
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- 人型アバター(鏡+一人称の body awareness 両対応) ----
// レイヤー設計(ニアプレーン検算済み):
//   頭・首・肩まわり・上腕・胸上部 = layer 1 のみ(鏡専用。カメラが頭の中にあるため)
//   胴下部・骨盤・脚・前腕・手     = layer 0+1(見下ろすと自分の体が見え、押すと両腕が視界に入る)
// 規約: rotation.y=0 で -Z(北)向き。四肢はピボット=関節、メッシュを -Y にぶら下げる。
//       rot.x 正 = 肢端が前へ / 首・頭の rot.x 正 = 上を向く(カメラと同符号)。

// 体格スケール: 素体リグ(RIG の寸法で組む)を一律に縮め、目の高さを
// 箱(1.8m)の中心 0.9m より少し上 ≈1.15m に置く。箱・セル・壁はそのままなので
// 箱がいっそうそびえて見える。カメラ定数も同率で導出するため、鏡の中の姿・
// 両手押しの構図・首ピボットの整合はスケール前と変わらない
const BODY_SCALE = 0.72;
const RIG = { neckY: 1.45, neckBack: 0.1, eyeY: 0.15, eyeZ: 0.08 }; // スケール前のリグ寸法

export const NECK_Y = RIG.neckY * BODY_SCALE;       // 首関節の高さ(カメラの首ピボットと共有)
export const NECK_BACK = RIG.neckBack * BODY_SCALE; // 体軸はセル中心より少し後ろ(一人称で胸が映り込みすぎない)
export const EYE_OFF_Y = RIG.eyeY * BODY_SCALE;     // 首関節→目の高さ
export const EYE_OFF_Z = RIG.eyeZ * BODY_SCALE;     // 首関節→目の前方距離

function buildAvatar() {
  const M = {
    skin: new THREE.MeshStandardMaterial({ color: 0xe8b48e, emissive: 0x96603c, emissiveIntensity: 0.25, roughness: 0.6 }),
    jacket: new THREE.MeshStandardMaterial({ color: 0xff7b39, emissive: 0xff5a1f, emissiveIntensity: 0.38, roughness: 0.5 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x4a3526, emissive: 0x2a1d12, emissiveIntensity: 0.3, roughness: 0.85 }),
    shoes: new THREE.MeshStandardMaterial({ color: 0x26201c, roughness: 0.9 }),
    cap: new THREE.MeshStandardMaterial({ color: 0xffc83c, emissive: 0xcc8f1a, emissiveIntensity: 0.45, roughness: 0.55, side: THREE.DoubleSide }),
    hair: new THREE.MeshStandardMaterial({ color: 0x3a2a1c, emissive: 0x1f150c, emissiveIntensity: 0.2, roughness: 0.9 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.35 }),
  };

  const root = new THREE.Group();
  root.scale.setScalar(BODY_SCALE); // リグはスケール前の寸法で組み、ここで一括縮小
  const body = new THREE.Group();
  body.position.z = RIG.neckBack;
  root.add(body);

  const mk = (geo, mat, parent, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // 腰 → 骨盤・両脚
  const hips = new THREE.Group();
  hips.position.set(0, 0.93, 0);
  body.add(hips);
  const pelvis = mk(new THREE.SphereGeometry(0.16, 12, 10), M.pants, hips, 0, -0.05, 0);
  pelvis.scale.set(1.15, 0.72, 0.85);

  const thighGeo = new THREE.CapsuleGeometry(0.072, 0.27, 4, 10);
  const shinGeo = new THREE.CapsuleGeometry(0.055, 0.28, 4, 10);
  const footGeo = new THREE.BoxGeometry(0.1, 0.06, 0.23);
  const mkLeg = (sx) => {
    const thigh = new THREE.Group();
    thigh.position.set(sx * 0.09, -0.05, 0);
    hips.add(thigh);
    mk(thighGeo, M.pants, thigh, 0, -0.205, 0);
    const shin = new THREE.Group();
    shin.position.set(0, -0.41, 0);
    thigh.add(shin);
    mk(shinGeo, M.pants, shin, 0, -0.195, 0);
    mk(footGeo, M.shoes, shin, 0, -0.44, -0.05);
    return { thigh, shin };
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  // 胴(前傾ピボット)
  const torso = new THREE.Group();
  torso.position.set(0, 0.07, 0);
  hips.add(torso);
  const torsoMesh = mk(new THREE.CapsuleGeometry(0.155, 0.22, 4, 12), M.jacket, torso, 0, 0.13, 0.02);
  torsoMesh.scale.set(1.25, 1, 0.8); // 胸郭の楕円化。鏡専用(上端が目線に近いため)
  const torsoLow = mk(new THREE.CapsuleGeometry(0.14, 0.1, 4, 12), M.jacket, torso, 0, 0.04, 0.01);
  torsoLow.scale.set(1.2, 1, 0.8);   // 一人称で見える胸下部(上端 y≈1.23 でニアクリップ安全)
  const shoulderBar = mk(new THREE.CapsuleGeometry(0.065, 0.27, 4, 8), M.jacket, torso, 0, 0.38, 0);
  shoulderBar.rotation.z = Math.PI / 2;

  // 腕(肩=layer1、肘から先=一人称でも見える)
  const deltoidGeo = new THREE.SphereGeometry(0.068, 10, 8);
  const upperArmGeo = new THREE.CapsuleGeometry(0.05, 0.18, 4, 8);
  const forearmGeo = new THREE.CapsuleGeometry(0.043, 0.17, 4, 8);
  const handGeo = new THREE.SphereGeometry(0.05, 10, 8);
  const mirrorOnlyMeshes = [torsoMesh, shoulderBar];
  const mkArm = (sx) => {
    const upper = new THREE.Group();
    upper.position.set(sx * 0.2, 0.38, 0);
    torso.add(upper);
    mirrorOnlyMeshes.push(
      mk(deltoidGeo, M.jacket, upper, 0, 0, 0),
      mk(upperArmGeo, M.jacket, upper, 0, -0.14, 0)
    );
    const fore = new THREE.Group();
    fore.position.set(0, -0.28, 0);
    upper.add(fore);
    mk(forearmGeo, M.skin, fore, 0, -0.13, 0);
    const hand = mk(handGeo, M.skin, fore, 0, -0.3, -0.015);
    hand.scale.set(0.85, 0.7, 1.25);
    return { upper, fore };
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  // 首・頭(全て鏡専用)。YXZ: ヨー→ピッチの順で首をかしげない
  const neck = new THREE.Group();
  neck.position.set(0, 0.45, 0);
  neck.rotation.order = 'YXZ';
  torso.add(neck);
  mk(new THREE.CylinderGeometry(0.05, 0.058, 0.1, 10), M.skin, neck, 0, 0.045, 0);
  const head = new THREE.Group();
  head.position.set(0, 0.1, 0);
  head.rotation.order = 'YXZ';
  neck.add(head);
  const headMesh = mk(new THREE.SphereGeometry(0.12, 16, 12), M.skin, head, 0, 0, 0);
  headMesh.scale.set(1, 1.12, 1.02);
  const eyeGeo = new THREE.SphereGeometry(0.02, 8, 6);
  for (const sx of [-1, 1]) {
    const e = mk(eyeGeo, M.eye, head, sx * 0.047, 0.028, -0.112);
    e.scale.set(1, 1.3, 0.55);
  }
  const nose = mk(new THREE.ConeGeometry(0.02, 0.05, 8), M.skin, head, 0, -0.01, -0.135);
  nose.rotation.x = -Math.PI / 2;
  mk(new THREE.BoxGeometry(0.05, 0.012, 0.01), M.eye, head, 0, -0.055, -0.114);
  mk(new THREE.BoxGeometry(0.18, 0.09, 0.06), M.hair, head, 0, -0.025, 0.115);
  // 帽子: 真上の鏡から「向き」を読む主シルエット(黄色い円+前方のつば)
  const capDome = mk(new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.cap, head, 0, 0.035, 0);
  capDome.scale.set(1, 0.8, 1.04);
  mk(new THREE.BoxGeometry(0.19, 0.018, 0.14), M.cap, head, 0, 0.05, -0.175);

  // 接地感のための疑似影
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.012;
  body.add(blob);

  // レイヤー適用(順序重要: 全体 0+1 → 鏡専用パーツを 1 のみへ)
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.layers.enable(1);
    }
  });
  for (const m of mirrorOnlyMeshes) m.layers.set(1);
  neck.traverse((o) => {
    if (o.isMesh) o.layers.set(1);
  });

  // 待機ポーズ
  armL.upper.rotation.z = -0.1;
  armR.upper.rotation.z = 0.1;
  armL.fore.rotation.x = 0.15;
  armR.fore.rotation.x = 0.15;

  // ---- アニメーション(モードはブレンド重みで吸収し、トゥイーン即終端でもポップしない) ----
  let tClock = 0;
  let wPush = 0;   // 両手で押す構えの重み(上げ速く・戻しゆっくり)
  let wWalk = 0;
  let parity = 0;  // 歩の左右交互
  let lastStepId = null;

  function update(dt, p) {
    dt = Math.min(dt, 0.05);
    tClock += dt;

    const pushT = p.mode === 'push' ? 1 : 0;
    wPush += (pushT - wPush) * (1 - Math.exp(-(pushT > wPush ? 18 : 7) * dt));
    const walkT = p.mode === 'walk' ? 1 : 0;
    wWalk += (walkT - wWalk) * (1 - Math.exp(-12 * dt));

    // 1マス=1歩。controls が振る歩数ID(stepId)の変化で左右を入れ替える
    if (p.stepId != null && p.stepId !== lastStepId) {
      parity = 1 - parity;
      lastStepId = p.stepId;
    }

    const br = Math.sin((tClock / 3.4) * Math.PI * 2); // 呼吸
    const osc = Math.sin(Math.PI * p.modePhase);       // 1歩の正弦(境界で速度連続)
    const s = (parity ? 1 : -1) * (p.moveSign ?? 1);   // 後退(undo含む)はスイング反転

    root.position.set(p.wx, 0, p.wz);
    root.rotation.y = p.bodyYaw;

    // 脚(押しながら進むときも歩く)
    const legW = Math.max(wWalk, 0.6 * wPush);
    legL.thigh.rotation.x = legW * s * 0.55 * osc;
    legR.thigh.rotation.x = -legL.thigh.rotation.x;
    legL.shin.rotation.x = -0.5 * legW * Math.max(0, -s * osc); // 後ろへ流れる脚だけ膝を畳む
    legR.shin.rotation.x = -0.5 * legW * Math.max(0, s * osc);
    hips.position.y = 0.93 + 0.015 * osc * legW;

    // 腕: 歩行の逆位相スイング/待機の微揺れ → 押しで両手を前へ。
    // 注意: 前傾(torso.rotation.x 負)は腕ごと下に回すため、肩ローカルは 1.9rad まで
    // 上げて実効 ~96°(肩の高さで押す)にする。これで一人称でも両手が視界に入る
    const swing = wWalk * -s * 0.35 * osc + (1 - wWalk) * (1 - wPush) * 0.04 * br;
    armL.upper.rotation.x = swing * (1 - wPush) + 1.9 * wPush;
    armR.upper.rotation.x = -swing * (1 - wPush) + 1.9 * wPush;
    armL.upper.rotation.z = -0.1 * (1 - 0.7 * wPush); // 押すとき両腕を平行に
    armR.upper.rotation.z = 0.1 * (1 - 0.7 * wPush);
    armL.fore.rotation.x = 0.15 - 0.1 * wPush;        // 肘を伸ばす
    armR.fore.rotation.x = 0.15 - 0.1 * wPush;

    // 胴: 呼吸+歩行/押しの前傾
    torso.rotation.x = 0.015 * br - 0.05 * wWalk - 0.22 * wPush;
    const breathe = 1 + 0.015 * br;
    torsoMesh.scale.set(1.25 * breathe, 1, 0.8 * breathe);

    // 首・頭: 実際の視線(カメラ)と同期 — 鏡を見ると首をかしげた自分が映る。
    // 下向きはカメラ(-1.35)より浅い -1.0 で止める(顎が胸にめり込まない解剖学的範囲)
    const pitchV = Math.max(-1.0, Math.min(Math.PI / 2, p.lookPitch));
    neck.rotation.y = 0.4 * p.lookYaw;
    head.rotation.y = 0.6 * p.lookYaw;
    neck.rotation.x = 0.35 * pitchV - 0.1 * wPush;
    head.rotation.x = 0.65 * pitchV + 0.01 * br - 0.05 * wPush;
  }

  function reset() {
    wPush = 0;
    wWalk = 0;
    parity = 0;
    lastStepId = null;
  }

  return {
    group: root,
    update,
    reset,
    nodes: { hips, torso, neck, head, armL, armR, legL, legR }, // デバッグ・検証用
  };
}

// ---- シーン本体 ----

// 画角はブラウザサイズに依らず横長 16:9 固定。ウィンドウに収まる最大の
// 16:9 矩形をレターボックス表示する(縦長ウィンドウで箱が画面を覆い尽くすのを防ぐ)
const VIEW_ASPECT = 16 / 9;
export const FOV = 65;        // 垂直FOV。16:9で水平約97°(70=水平102°は広角すぎ、60=91.5°は狭かった)
export const FOV_LOOKUP = 72; // Space見上げ時の垂直FOV(盤面全体が収まるユーザー確定値)

export function createScene(container) {
  // ステージ(#stage/#app)の中に収まる最大の 16:9 矩形を求める。
  // 上下バーで高さが変わってもこのコンテナ基準なら追従できる。
  function viewSize() {
    let w = container.clientWidth;
    let h = container.clientHeight;
    if (w / h > VIEW_ASPECT) w = Math.round(h * VIEW_ASPECT);
    else h = Math.round(w / VIEW_ASPECT);
    return { w, h };
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e14);

  const camera = new THREE.PerspectiveCamera(FOV, VIEW_ASPECT, 0.1, 200);
  camera.rotation.order = 'YXZ'; // ヨー→ピッチの順で適用

  const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x3a352c, 1.05); // 壁が高い分、上部の明るすぎを抑える
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  const avatar = buildAvatar();
  scene.add(avatar.group);

  // プレイヤー前方の補助光: 目の前の箱を照らす。distance を絞り、壁越しの
  // 漏れ光を実質1セル内に抑える。帽子の真上に置かない(鏡内の白飛び回避)
  const playerLight = new THREE.PointLight(0xffe2bd, 2.0, 5, 2);
  scene.add(playerLight);
  const avatarUpdate = avatar.update;
  avatar.update = (dt, p) => {
    avatarUpdate(dt, p);
    playerLight.position.set(
      p.wx - Math.sin(p.bodyYaw) * 0.5,
      2.05,
      p.wz - Math.cos(p.bodyYaw) * 0.5
    );
  };

  // レベル間で使い回す素材
  const crateTex = makeCrateTexture();
  const wallTex = makeWallTexture();

  let level = null; // {group, reflector, boxMeshes, cx, cz, ceilH, disposables}

  function worldX(x) { return (x - level.cx) * CELL; }
  function worldZ(z) { return (z - level.cz) * CELL; }

  function disposeLevel() {
    if (!level) return;
    scene.remove(level.group);
    level.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose();
      }
    });
    level.reflector.getRenderTarget().dispose();
    for (const d of level.disposables) d.dispose();
    level = null;
  }

  function loadLevel(state) {
    disposeLevel();

    const group = new THREE.Group();
    const cx = (state.width - 1) / 2;
    const cz = (state.height - 1) / 2;
    const disposables = [];
    level = { group, cx, cz, boxMeshes: new Map(), disposables };

    const planW = state.width * CELL;
    const planH = state.height * CELL;

    // 床
    const floorTex = makeFloorTexture(state);
    disposables.push(floorTex);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(planW, planH),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    // ゴール(光る床リング)
    const ringGeo = new THREE.RingGeometry(0.52, 0.78, 36);
    const dotGeo = new THREE.CircleGeometry(0.1, 20);
    for (const gk of state.goals) {
      const [gx, gz] = gk.split(',').map(Number);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x37e0b8,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set((gx - cx) * CELL, 0.02, (gz - cz) * CELL);
      const dot = new THREE.Mesh(dotGeo, mat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set((gx - cx) * CELL, 0.02, (gz - cz) * CELL);
      group.add(ring, dot);
    }

    // 壁(床に隣接するものだけ生成)。BoxGeometry の6面マテリアル配列で、
    // 側面4面=波板テクスチャ、上面(+Y)と下面=無地のマット。鏡からの俯瞰で
    // 壁上面に波板やボルトが映ってうるさくならないようにする。
    // ジオメトリ・マテリアルはループ外で1セット作って全壁で共有(従来方針どおり)
    const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
    const wallSideMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
    const wallCapMat = new THREE.MeshStandardMaterial({ color: 0x2a3040, roughness: 0.9 });
    // BoxGeometry のマテリアル順: +X,-X,+Y(上),-Y(下),+Z,-Z
    const wallMat = [wallSideMat, wallSideMat, wallCapMat, wallCapMat, wallSideMat, wallSideMat];
    const touchesFloor = (x, z) => {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (state.floors.has(key(x + dx, z + dz))) return true;
        }
      }
      return false;
    };
    for (const wk of state.walls) {
      const [wx, wz] = wk.split(',').map(Number);
      if (!touchesFloor(wx, wz)) continue;
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set((wx - cx) * CELL, WALL_H / 2, (wz - cz) * CELL);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
    }

    // 箱(エミッシブを個別制御するためマテリアルは箱ごとにクローン)
    const boxGeo = new THREE.BoxGeometry(BOX, BOX, BOX);
    for (const bk of state.boxes) {
      const [bx, bz] = bk.split(',').map(Number);
      const mat = new THREE.MeshStandardMaterial({
        map: crateTex,
        roughness: 0.75,
        emissive: 0x000000,
        emissiveIntensity: 0,
      });
      const box = new THREE.Mesh(boxGeo, mat);
      box.position.set((bx - cx) * CELL, BOX / 2, (bz - cz) * CELL);
      box.castShadow = true;
      box.receiveShadow = true;
      group.add(box);
      level.boxMeshes.set(bk, box);
    }

    // 天井の鏡。高さはレベルサイズに応じて: 見上げたとき盤面全体が映る高さにする。
    // 壁を4.6mに上げたので、その陰に奥のマスが隠れないよう鏡も高くして見上げ視点を
    // より真上(俯瞰)に近づける(0.95は盤面が遠く小さく映りすぎたため0.8に調整)
    const ceilH = Math.max(10, Math.max(state.width, state.height) * CELL * 0.8);
    level.ceilH = ceilH;
    const mirrorW = planW + CELL * 2;
    const mirrorH = planH + CELL * 2;
    // モバイルGPUは2048の鏡レンダーターゲットが重いので、タッチ端末では1024に落とす
    const mirrorRes = matchMedia('(pointer: coarse)').matches ? 1024 : 2048;
    const reflector = new Reflector(new THREE.PlaneGeometry(mirrorW, mirrorH), {
      textureWidth: mirrorRes, // アバターの表情・向きが鏡で読める解像度(モバイルは1024)
      textureHeight: mirrorRes,
      clipBias: 0.003,
      multisample: 2, // 2048に上げた分、MSAAは抑えてGPU負荷を相殺
      color: 0x7f7f7f,
    });
    reflector.rotation.x = Math.PI / 2; // 法線を下向きに
    reflector.position.y = ceilH;
    // r152+ の ColorManagement は hex 指定をリニア変換するため、既定の 0x7f7f7f が
    // overlay ブレンドで約0.42倍の減光になる。作業色空間で 0.5 を直接入れて中立化する。
    reflector.material.uniforms.color.value.setRGB(0.5, 0.5, 0.5);
    // アバター(layer 1)は鏡の仮想カメラにだけ見せる
    reflector.camera.layers.enable(1);
    group.add(reflector);
    level.reflector = reflector;

    // 鏡の額縁(視界の端で鏡が唐突に切れて見えないように)
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x232a3a, roughness: 0.6 });
    const frameT = 0.5; // 枠の幅
    const frameD = 0.4; // 枠の厚み(下方向)
    const mkFrame = (w, d, px, pz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, frameD, d), frameMat);
      m.position.set(px, ceilH - frameD / 2 + 0.01, pz);
      group.add(m);
    };
    mkFrame(mirrorW + frameT * 2, frameT, 0, -(mirrorH / 2 + frameT / 2));
    mkFrame(mirrorW + frameT * 2, frameT, 0, mirrorH / 2 + frameT / 2);
    mkFrame(frameT, mirrorH, -(mirrorW / 2 + frameT / 2), 0);
    mkFrame(frameT, mirrorH, mirrorW / 2 + frameT / 2, 0);

    // 太陽光: レベルサイズに合わせて影カメラを張り直す
    sun.position.set(planW * 0.35, ceilH + 8, planH * 0.45);
    sun.target.position.set(0, 0, 0);
    const ext = Math.max(planW, planH) * 0.8;
    sun.shadow.camera.left = -ext;
    sun.shadow.camera.right = ext;
    sun.shadow.camera.top = ext;
    sun.shadow.camera.bottom = -ext;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = ceilH * 4 + 30;
    sun.shadow.camera.updateProjectionMatrix();

    scene.add(group);
  }

  // 箱メッシュの論理キーを付け替える(位置のトゥイーンは呼び出し側が行う)
  function rekeyBox(fromK, toK) {
    const mesh = level.boxMeshes.get(fromK);
    if (!mesh) return null;
    level.boxMeshes.delete(fromK);
    level.boxMeshes.set(toK, mesh);
    return mesh;
  }

  // ゴール上の箱を発光させる
  function refreshGoalGlow(state) {
    for (const [k, mesh] of level.boxMeshes) {
      const on = state.goals.has(k);
      mesh.material.emissive.setHex(on ? 0xff9a3c : 0x000000);
      mesh.material.emissiveIntensity = on ? 0.45 : 0;
    }
  }

  function onResize() {
    const { w, h } = viewSize();
    renderer.setSize(w, h); // aspect は VIEW_ASPECT 固定なので投影行列は変わらない
  }
  onResize();

  // コンテナのサイズ変化(バー高さの増減・端末回転など)に追従する
  new ResizeObserver(onResize).observe(container);

  return {
    renderer,
    scene,
    camera,
    avatar,
    loadLevel,
    worldX,
    worldZ,
    rekeyBox,
    refreshGoalGlow,
    reflector: () => level.reflector, // デバッグ・検証用
    onResize,
    render: () => renderer.render(scene, camera),
  };
}
