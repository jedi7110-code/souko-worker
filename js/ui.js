// HUD・オーバーレイ(ヘルプ/クリア/レベル選択)・localStorage 進捗。
// モーダル表示中のキーボード操作はここで処理する(controls 側は isModalOpen で休止)。

// v2: L6〜L10 を物理的に大きい倉庫へ再設計し旧ベスト記録が無効になったため進捗キーを更新
const STORE_KEY = 'souko.progress.v2';
const HELP_KEY = 'souko.helpSeen.v1';

export function createUI({ levels, onSelectLevel, onNextLevel, onReplayLevel }) {
  const $ = (id) => document.getElementById(id);
  const els = {
    level: $('hud-level'),
    moves: $('stat-moves'),
    pushes: $('stat-pushes'),
    help: $('overlay-help'),
    clear: $('overlay-clear'),
    menu: $('overlay-menu'),
    clearTitle: $('clear-title'),
    clearStats: $('clear-stats'),
    clearBest: $('clear-best'),
    nextBtn: $('clear-next'),
    replayBtn: $('clear-replay'),
    clearMenuBtn: $('clear-menu'),
    menuLevels: $('menu-levels'),
    menuClose: $('menu-close'),
    menuHelp: $('menu-help'),
    helpClose: $('help-close'),
  };

  let currentLevel = 0;

  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');
  const visible = (el) => !el.classList.contains('hidden');
  const isModalOpen = () => visible(els.help) || visible(els.clear) || visible(els.menu);

  // ---- 進捗(ベスト手数) ----

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {};
    } catch {
      return {};
    }
  }

  function saveProgress(levelIndex, moves) {
    const p = loadProgress();
    const prev = p[levelIndex];
    const isNewBest = prev === undefined || moves < prev;
    if (isNewBest) {
      p[levelIndex] = moves;
      localStorage.setItem(STORE_KEY, JSON.stringify(p));
    }
    return { best: isNewBest ? moves : prev, isNewBest };
  }

  function firstUnclearedIndex() {
    const p = loadProgress();
    for (let i = 0; i < levels.length; i++) if (p[i] === undefined) return i;
    return 0;
  }

  // ---- HUD ----

  function updateHUD(state, levelIndex) {
    if (levelIndex !== undefined) currentLevel = levelIndex;
    els.level.textContent = `L${currentLevel + 1} ${state.name}`;
    els.moves.textContent = state.moves;
    els.pushes.textContent = state.pushes;
  }

  // ---- クリア ----

  function showClear({ moves, pushes, isNewBest, isLast }) {
    els.clearTitle.textContent = isLast ? '全面クリア!' : 'クリア!';
    els.clearStats.textContent = `手数 ${moves} ・ 押し ${pushes}`;
    els.clearBest.textContent = isNewBest ? '✦ 自己ベスト更新' : '';
    els.nextBtn.textContent = isLast ? 'さいしょから' : '次の面へ';
    show(els.clear);
  }

  // ---- レベル選択 ----

  function buildMenu() {
    const p = loadProgress();
    els.menuLevels.innerHTML = '';
    levels.forEach((lv, i) => {
      const btn = document.createElement('button');
      btn.className = 'level-btn' + (i === currentLevel ? ' current' : '');
      const cleared = p[i] !== undefined;
      btn.innerHTML =
        `<span class="no">L${i + 1}</span>` +
        `<span class="name">${lv.name}</span>` +
        `<span class="stat${cleared ? ' done' : ''}">${
          cleared ? `✓ ベスト ${p[i]}手` : '未クリア'
        }</span>`;
      btn.addEventListener('click', () => {
        hide(els.menu);
        onSelectLevel(i);
      });
      els.menuLevels.appendChild(btn);
    });
  }

  function openMenu() {
    buildMenu();
    hide(els.clear);
    hide(els.help);
    show(els.menu);
  }

  // ---- ヘルプ ----

  function toggleHelp() {
    if (visible(els.help)) closeHelp();
    else {
      hide(els.menu);
      show(els.help);
    }
  }

  function closeHelp() {
    localStorage.setItem(HELP_KEY, '1');
    hide(els.help);
  }

  function maybeShowFirstHelp() {
    if (!localStorage.getItem(HELP_KEY)) show(els.help);
  }

  // ---- ボタン・モーダル中のキー ----

  els.helpClose.addEventListener('click', closeHelp);
  els.nextBtn.addEventListener('click', () => {
    hide(els.clear);
    onNextLevel();
  });
  els.replayBtn.addEventListener('click', () => {
    hide(els.clear);
    onReplayLevel();
  });
  els.clearMenuBtn.addEventListener('click', () => openMenu());
  els.menuClose.addEventListener('click', () => hide(els.menu));
  els.menuHelp.addEventListener('click', () => {
    hide(els.menu);
    show(els.help);
  });

  window.addEventListener('keydown', (e) => {
    if (!isModalOpen()) return;
    if (visible(els.clear)) {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        els.nextBtn.click();
      } else if (e.code === 'Escape') {
        openMenu();
      }
    } else if (visible(els.menu)) {
      if (e.code === 'Escape') hide(els.menu);
    } else if (visible(els.help)) {
      if (e.code === 'Escape' || e.code === 'KeyH' || e.code === 'Enter') closeHelp();
    }
  });

  return {
    updateHUD,
    showClear,
    openMenu,
    toggleHelp,
    maybeShowFirstHelp,
    saveProgress,
    firstUnclearedIndex,
    isModalOpen,
  };
}
