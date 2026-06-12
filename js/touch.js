// スマホ向けタッチ操作。画面下の十字パッド・鏡ボタン・戻すボタンを
// controls の公開API(enqueue/lookUp/undoAction)に配線する。
// すべて pointerdown で preventDefault してフォーカス奪取・300ms遅延・
// ダブルタップズームを防ぐ。

const REPEAT_MS = 220; // 長押し時の移動リピート間隔

export function createTouchControls({ controls, ui }) {
  const $ = (id) => document.getElementById(id);

  // ---- 十字パッド(長押しでリピート) ----
  for (const btn of document.querySelectorAll('.dpad .dbtn')) {
    const cmd = btn.dataset.cmd;
    let timer = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      controls.enqueue(cmd);
      stop();
      timer = setInterval(() => controls.enqueue(cmd), REPEAT_MS);
    });
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- 鏡ボタン(長押しで見上げ=Space相当) ----
  const mirror = $('touch-mirror');
  if (mirror) {
    mirror.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      controls.lookUp(true);
    });
    const release = () => controls.lookUp(false);
    mirror.addEventListener('pointerup', release);
    mirror.addEventListener('pointercancel', release);
    mirror.addEventListener('pointerleave', release);
    mirror.addEventListener('contextmenu', (e) => e.preventDefault()); // 長押しメニュー防止
  }

  // ---- 戻すボタン(1回だけ。リピートなし) ----
  const undo = $('touch-undo');
  if (undo) {
    undo.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      controls.undoAction();
    });
    undo.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
