// Volume Booster Pro — Popup Controller (accordion UI)
(function () {
  'use strict';

  // ============ DOM ============
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // Header
  const hostLabel  = $('#hostLabel');
  const titleLabel = $('#titleLabel');
  const profileBtn = $('#profileBtn');
  const profileDot = $('#profileDot');
  const powerBtn   = $('#powerBtn');

  // Profile popover
  const profilePopover    = $('#profilePopover');
  const popHost           = $('#popHost');
  const popStatus         = $('#popStatus');
  const autoApplyToggle   = $('#autoApplyToggle');
  const saveProfileBtn    = $('#saveProfileBtn');
  const deleteProfileBtn  = $('#deleteProfileBtn');
  const manageProfilesBtn = $('#manageProfilesBtn');
  const profileCount      = $('#profileCount');

  // Accordions
  const accordions   = $$('.accordion');
  const accTriggers  = $$('.acc-trigger');

  // Mixer
  const volumeInput = $('#volumeInput');
  const volLabel    = $('#volLabel');
  const slider      = $('#volumeSlider');
  const sliderFill  = $('#sliderFill');
  const presetChips = $$('.chip');
  const toggleChips = $$('.tchip');
  const meterL      = $('#meterL');
  const meterR      = $('#meterR');
  const mixerMeta   = $('#mixerMeta');

  // EQ
  const eqPresetSel = $('#eqPresetSelect');
  const eqSliders   = $$('.eq-slider');
  const eqVals      = $$('.eq-val');
  const resetEqBtn  = $('#resetEqBtn');
  const eqMeta      = $('#eqMeta');

  // Tabs panel
  const tabsList       = $('#tabsList');
  const tabsEmpty      = $('#tabsEmpty');
  const tabsLabel      = $('#tabsLabel');
  const tabsBadge      = $('#tabsBadge');
  const tabsMeta       = $('#tabsMeta');
  const refreshTabsBtn = $('#refreshTabsBtn');

  // Footer
  const statusText  = $('#statusText');
  const resetBtn    = $('#resetBtn');
  const shortcutsBtn = $('#shortcutsBtn');

  // Modals
  const profilesModal       = $('#profilesModal');
  const profilesModalBack   = $('#profilesModalBackdrop');
  const profilesModalBody   = $('#profilesModalBody');
  const closeProfilesModal  = $('#closeProfilesModal');
  const shortcutsModal      = $('#shortcutsModal');
  const shortcutsModalBack  = $('#shortcutsModalBackdrop');
  const closeShortcutsModal = $('#closeShortcutsModal');

  // ============ CONSTANTS ============
  const STEP = 10;
  const MAX_VOLUME = 600;
  const ORIGIN_ID = `popup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const EQ_PRESETS = {
    flat:     [0,  0,  0,  0,  0],
    bass:     [8,  5,  0, -2, -1],
    vocal:    [-2, 0,  4,  3,  1],
    treble:   [-1, 0,  1,  4,  7],
    loudness: [6,  2, -1,  2,  5],
  };
  const EQ_PRESET_NAMES = {
    flat: 'Flat', bass: 'Bass Heavy', vocal: 'Vocal Clarity',
    treble: 'Treble Boost', loudness: 'Loudness', custom: 'Custom',
  };
  const DEFAULT_STATE = {
    volume: 100,
    enabled: true,
    bassBoost: false,
    limiter: true,
    mono: false,
    voice: false,
    eq: [0, 0, 0, 0, 0],
    eqPreset: 'flat',
  };
  const DEFAULT_ACCORDION = { mixer: true, eq: false, tabs: false };

  // ============ STATE ============
  let state = { ...DEFAULT_STATE, eq: [...DEFAULT_STATE.eq] };
  let profiles = {};
  let autoApply = {};
  let accordionState = { ...DEFAULT_ACCORDION };
  let currentHost = '';
  let currentTabId = null;
  let editingProfile = false;

  let meterTimer = null;
  let saveTimer = null;
  let statusTimer = null;
  let tabsTimer = null;

  // ============ INIT ============
  init();

  function init() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs?.[0];
      if (t) {
        currentTabId = t.id;
        currentHost = hostnameFromUrl(t.url || '');
        hostLabel.textContent  = currentHost || 'Local file';
        titleLabel.textContent = (t.title || 'Untitled').slice(0, 60);
      }
      loadAndRender();
    });
    bindEvents();
  }

  function loadAndRender() {
    chrome.storage.local.get(null, (data) => {
      profiles  = data.profiles || {};
      autoApply = data.autoApply || {};
      accordionState = { ...DEFAULT_ACCORDION, ...(data.accordionState || {}) };
      editingProfile = !!(currentHost && profiles[currentHost]);
      assignFrom(editingProfile ? profiles[currentHost] : data);
      applyAccordionState();
      renderAll();
      updateProfileUI();
      startMetering();
      refreshTabsList();
      tabsTimer = setInterval(refreshTabsList, 2500);
    });
  }

  function assignFrom(src) {
    if (src.volume !== undefined)    state.volume    = src.volume;
    if (src.enabled !== undefined)   state.enabled   = src.enabled;
    if (src.bassBoost !== undefined) state.bassBoost = src.bassBoost;
    if (src.limiter !== undefined)   state.limiter   = src.limiter;
    if (src.mono !== undefined)      state.mono      = src.mono;
    if (src.voice !== undefined)     state.voice     = src.voice;
    if (src.eq !== undefined)        state.eq        = [...src.eq];
    if (src.eqPreset !== undefined)  state.eqPreset  = src.eqPreset;
  }

  // ============ RENDER ============
  function renderAll() {
    renderVolume(state.volume);
    renderPower();
    renderToggles();
    renderEQ();
    renderMixerMeta();
    renderEqMeta();
  }

  function renderVolume(vol) {
    if (document.activeElement !== volumeInput) volumeInput.value = vol;
    if (document.activeElement !== slider) slider.value = vol;
    slider.setAttribute('aria-valuenow', String(vol));
    sliderFill.style.width = (vol / MAX_VOLUME * 100) + '%';

    let label = 'Normal';
    if (vol === 0) label = 'Muted';
    else if (vol <= 50) label = 'Quiet';
    else if (vol <= 100) label = 'Normal';
    else if (vol <= 200) label = 'Boosted';
    else if (vol <= 400) label = 'Amplified';
    else label = 'Maximum';
    volLabel.textContent = label;

    volumeInput.classList.toggle('boosted', vol > 100 && vol <= 400);
    volumeInput.classList.toggle('extreme', vol > 400);

    presetChips.forEach((b) => b.classList.toggle('active', parseInt(b.dataset.value, 10) === vol));
  }

  function renderPower() {
    document.body.classList.toggle('power-off', !state.enabled);
    powerBtn.classList.toggle('off', !state.enabled);
    powerBtn.setAttribute('aria-pressed', String(state.enabled));
    statusText.textContent = state.enabled ? 'Active' : 'Disabled';
  }

  function renderToggles() {
    [
      ['#bassToggle', state.bassBoost],
      ['#limiterToggle', state.limiter],
      ['#voiceToggle', state.voice],
      ['#monoToggle', state.mono],
    ].forEach(([sel, on]) => {
      const el = $(sel);
      if (!el) return;
      el.classList.toggle('active', on);
      el.setAttribute('aria-checked', String(on));
    });
  }

  function renderEQ() {
    eqPresetSel.value = state.eqPreset;
    eqSliders.forEach((s, i) => { if (document.activeElement !== s) s.value = state.eq[i]; });
    eqVals.forEach((v, i) => {
      const val = state.eq[i];
      v.textContent = (val > 0 ? '+' : '') + val;
      v.classList.toggle('boost', val > 0);
      v.classList.toggle('cut', val < 0);
    });
  }

  function renderMixerMeta() {
    if (!state.enabled) { mixerMeta.textContent = 'Off'; return; }
    const parts = [`${state.volume}%`];
    if (state.bassBoost) parts.push('Bass');
    if (state.voice)     parts.push('Voice');
    if (state.mono)      parts.push('Mono');
    if (state.limiter)   parts.push('Limit');
    mixerMeta.textContent = parts.join(' · ');
  }

  function renderEqMeta() {
    eqMeta.textContent = EQ_PRESET_NAMES[state.eqPreset] || 'Custom';
  }

  // ============ ACCORDIONS ============
  function applyAccordionState() {
    accordions.forEach((acc) => {
      const key = acc.dataset.key;
      const open = !!accordionState[key];
      acc.dataset.open = String(open);
      const trigger = acc.querySelector('.acc-trigger');
      trigger?.setAttribute('aria-expanded', String(open));
    });
  }

  function toggleAccordion(key) {
    accordionState[key] = !accordionState[key];
    applyAccordionState();
    persistAccordionState();
  }

  function persistAccordionState() {
    chrome.storage.local.set({ accordionState, _origin: ORIGIN_ID });
  }

  // ============ PROFILE UI ============
  function updateProfileUI() {
    const hasProfile = !!(currentHost && profiles[currentHost]);
    const isAuto     = !!(currentHost && autoApply[currentHost]);

    profileDot.hidden = !hasProfile;
    profileDot.classList.toggle('auto', isAuto);

    popHost.textContent = currentHost || '(no host)';
    if (hasProfile && isAuto)      popStatus.textContent = '✓ Auto-applied on this site';
    else if (hasProfile)           popStatus.textContent = 'Profile saved · auto-apply off';
    else                           popStatus.textContent = 'No profile saved for this site';

    saveProfileBtn.textContent = hasProfile ? 'Update profile' : 'Save current settings';
    deleteProfileBtn.disabled  = !hasProfile;
    autoApplyToggle.disabled   = !hasProfile;
    autoApplyToggle.classList.toggle('active', isAuto);
    autoApplyToggle.setAttribute('aria-checked', String(isAuto));

    profileCount.textContent = Object.keys(profiles).length;
    document.body.classList.toggle('editing-profile', editingProfile);
  }

  // ============ EVENTS ============
  function bindEvents() {
    // Accordion triggers
    accTriggers.forEach((t) => {
      t.addEventListener('click', () => {
        const acc = t.closest('.accordion');
        if (acc?.dataset.key) toggleAccordion(acc.dataset.key);
      });
    });

    // Volume number input
    volumeInput.addEventListener('input', () => {
      const raw = volumeInput.value.replace(/[^\d]/g, '');
      let val = parseInt(raw, 10);
      if (isNaN(val)) return;
      val = clampVol(val);
      state.volume = val;
      renderVolume(val);
      renderMixerMeta();
      scheduleSaveAndApply();
    });
    volumeInput.addEventListener('change', () => {
      let val = parseInt(volumeInput.value, 10);
      if (isNaN(val)) val = 100;
      val = clampVol(val);
      state.volume = val; volumeInput.value = val;
      renderVolume(val); renderMixerMeta(); saveAndApply();
    });
    volumeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') volumeInput.blur();
      else if (e.key === 'ArrowUp')   { e.preventDefault(); bumpVolume(STEP); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); bumpVolume(-STEP); }
    });
    volumeInput.addEventListener('focus', () => volumeInput.select());

    // Slider
    slider.addEventListener('input', () => {
      state.volume = parseInt(slider.value, 10);
      renderVolume(state.volume);
      renderMixerMeta();
      scheduleSaveAndApply();
    });

    // Wheel over volume display
    $('.vol-display').addEventListener('wheel', (e) => {
      e.preventDefault();
      bumpVolume(e.deltaY < 0 ? STEP : -STEP);
    }, { passive: false });

    // Presets
    presetChips.forEach((c) => c.addEventListener('click', () => {
      state.volume = parseInt(c.dataset.value, 10);
      renderVolume(state.volume);
      renderMixerMeta();
      saveAndApply();
    }));

    // Toggles
    toggleChips.forEach((c) => c.addEventListener('click', () => {
      const key = c.dataset.key;
      state[key] = !state[key];
      c.classList.toggle('active', state[key]);
      c.setAttribute('aria-checked', String(state[key]));
      renderMixerMeta();
      saveAndApply();
    }));

    // Power
    powerBtn.addEventListener('click', () => {
      state.enabled = !state.enabled;
      renderPower(); renderMixerMeta();
      saveAndApply();
    });

    // EQ
    eqSliders.forEach((s) => s.addEventListener('input', () => {
      const i = parseInt(s.dataset.band, 10);
      state.eq[i] = parseInt(s.value, 10);
      const v = eqVals[i]; const val = state.eq[i];
      v.textContent = (val > 0 ? '+' : '') + val;
      v.classList.toggle('boost', val > 0); v.classList.toggle('cut', val < 0);
      state.eqPreset = 'custom'; eqPresetSel.value = 'custom';
      renderEqMeta();
      scheduleSaveAndApply();
    }));
    eqPresetSel.addEventListener('change', () => {
      const k = eqPresetSel.value;
      state.eqPreset = k;
      if (EQ_PRESETS[k]) state.eq = [...EQ_PRESETS[k]];
      renderEQ(); renderEqMeta();
      saveAndApply();
    });
    resetEqBtn.addEventListener('click', () => {
      state.eq = [0, 0, 0, 0, 0]; state.eqPreset = 'flat';
      renderEQ(); renderEqMeta(); saveAndApply();
      setStatus('EQ reset', 1200);
    });

    // Reset all
    resetBtn.addEventListener('click', () => {
      state = { ...DEFAULT_STATE, eq: [...DEFAULT_STATE.eq] };
      renderAll();
      saveAndApply();
      setStatus('All settings reset', 1500);
    });

    // ===== Profile popover =====
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePopover(profilePopover.hidden);
    });
    document.addEventListener('click', (e) => {
      if (!profilePopover.hidden && !profilePopover.contains(e.target) && e.target !== profileBtn) {
        togglePopover(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!profilePopover.hidden) togglePopover(false);
      else if (!profilesModal.hidden) closeModal('profilesModal');
      else if (!shortcutsModal.hidden) closeModal('shortcutsModal');
    });

    saveProfileBtn.addEventListener('click', () => {
      if (!currentHost) { setStatus('No host detected', 1500); return; }
      profiles[currentHost] = { ...state, eq: [...state.eq] };
      const isNew = !editingProfile;
      editingProfile = true;
      chrome.storage.local.set({ profiles, _origin: ORIGIN_ID }, () => {
        updateProfileUI();
        setStatus(isNew ? `Saved profile · ${currentHost}` : 'Profile updated', 1800);
      });
    });

    deleteProfileBtn.addEventListener('click', () => {
      if (!currentHost || !profiles[currentHost]) return;
      delete profiles[currentHost];
      delete autoApply[currentHost];
      editingProfile = false;
      chrome.storage.local.set({ profiles, autoApply, _origin: ORIGIN_ID }, () => {
        chrome.storage.local.get(null, (data) => {
          assignFrom(data);
          renderAll();
          updateProfileUI();
          saveAndApply();
          setStatus(`Profile removed · ${currentHost}`, 1800);
        });
      });
    });

    autoApplyToggle.addEventListener('click', () => {
      if (autoApplyToggle.disabled) return;
      const isOn = !autoApply[currentHost];
      if (isOn) autoApply[currentHost] = true; else delete autoApply[currentHost];
      chrome.storage.local.set({ autoApply, _origin: ORIGIN_ID }, () => {
        updateProfileUI();
        chrome.runtime.sendMessage({ type: 'BG_PUSH_TO_TAB', tabId: currentTabId });
        setStatus(isOn ? 'Auto-apply enabled' : 'Auto-apply disabled', 1500);
      });
    });

    manageProfilesBtn.addEventListener('click', () => {
      togglePopover(false);
      openModal('profilesModal');
      renderProfilesModal();
    });

    // Modals
    closeProfilesModal.addEventListener('click', () => closeModal('profilesModal'));
    profilesModalBack.addEventListener('click', () => closeModal('profilesModal'));
    shortcutsBtn.addEventListener('click', () => openModal('shortcutsModal'));
    closeShortcutsModal.addEventListener('click', () => closeModal('shortcutsModal'));
    shortcutsModalBack.addEventListener('click', () => closeModal('shortcutsModal'));

    // Tabs panel
    refreshTabsBtn.addEventListener('click', () => { refreshTabsList(); setStatus('Tabs refreshed', 1000); });

    // External storage changes — guard against our own writes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      // Ignore echoes from our own writes (we tag every write with _origin).
      if (changes._origin && changes._origin.newValue === ORIGIN_ID) return;

      if (changes.profiles)  profiles  = changes.profiles.newValue || {};
      if (changes.autoApply) autoApply = changes.autoApply.newValue || {};
      if (changes.accordionState) {
        accordionState = { ...DEFAULT_ACCORDION, ...(changes.accordionState.newValue || {}) };
        applyAccordionState();
      }
      if (editingProfile && currentHost && changes.profiles) {
        const p = profiles[currentHost];
        if (p) { assignFrom(p); renderAll(); }
      }
      if (!editingProfile) {
        let dirty = false;
        for (const k of Object.keys(state)) {
          if (changes[k]) { state[k] = changes[k].newValue; dirty = true; }
        }
        if (dirty) renderAll();
      }
      updateProfileUI();
    });
  }

  function bumpVolume(delta) {
    state.volume = clampVol(state.volume + delta);
    renderVolume(state.volume);
    renderMixerMeta();
    saveAndApply();
  }

  function clampVol(v) { return Math.max(0, Math.min(MAX_VOLUME, v | 0)); }

  // ============ POPOVER ============
  function togglePopover(open) {
    profilePopover.hidden = !open;
    profileBtn.setAttribute('aria-expanded', String(open));
    profileBtn.classList.toggle('active', open);
  }

  // ============ MODALS ============
  function openModal(id) {
    document.getElementById(id).hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeModal(id) {
    document.getElementById(id).hidden = true;
    if (profilesModal.hidden && shortcutsModal.hidden) document.body.classList.remove('modal-open');
  }

  // ============ SAVE & APPLY ============
  function scheduleSaveAndApply() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAndApply, 60);
  }

  function saveAndApply() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const payload = editingProfile && currentHost
      ? { profiles: { ...profiles, [currentHost]: { ...state, eq: [...state.eq] } }, _origin: ORIGIN_ID }
      : { ...state, _origin: ORIGIN_ID };

    if (editingProfile && currentHost) {
      profiles[currentHost] = { ...state, eq: [...state.eq] };
    }

    chrome.storage.local.set(payload);

    if (currentTabId) {
      chrome.tabs.sendMessage(currentTabId, {
        type: 'SET_AUDIO',
        gain: state.enabled ? state.volume / 100 : 1,
        enabled: state.enabled,
        bassBoost: state.bassBoost,
        limiter: state.limiter,
        mono: state.mono,
        voice: state.voice,
        eq: state.eq,
      }).catch(() => setStatus('Reload tab to activate', 2500));
    }
  }

  function setStatus(text, revertAfter) {
    statusText.textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    if (revertAfter) {
      statusTimer = setTimeout(() => {
        statusText.textContent = state.enabled ? 'Active' : 'Disabled';
      }, revertAfter);
    }
  }

  // ============ METERING ============
  function startMetering() {
    meterTimer = setInterval(() => {
      // Skip work if mixer accordion is collapsed or page is hidden.
      if (!currentTabId || !accordionState.mixer || document.hidden) {
        meterL.style.width = '0%'; meterR.style.width = '0%';
        return;
      }
      chrome.tabs.sendMessage(currentTabId, { type: 'GET_LEVELS' }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          meterL.style.width = '0%'; meterR.style.width = '0%'; return;
        }
        const mapDb = (db) => Math.max(0, Math.min(100, ((db + 60) / 66) * 100));
        meterL.style.width = mapDb(resp.left) + '%';
        meterR.style.width = mapDb(resp.right) + '%';
      });
    }, 100);
  }

  // ============ TAB MANAGER ============
  function refreshTabsList() {
    chrome.runtime.sendMessage({ type: 'BG_LIST_AUDIO_TABS' }, (resp) => {
      if (chrome.runtime.lastError || !resp) return;
      const all = resp.tabs || [];
      // Filter to: audible, muted, or current tab
      const list = all.filter((t) => t.audible || t.mutedInfo?.muted || t.id === currentTabId);
      renderTabs(list);
    });
  }

  function renderTabs(tabs) {
    const audible = tabs.filter((t) => t.audible);
    const muted   = tabs.filter((t) => t.mutedInfo?.muted);
    const others  = tabs.filter((t) => !t.audible && !t.mutedInfo?.muted);

    // Update header badges/metas
    const playingCount = audible.length;
    const mutedCount   = muted.length;
    if (playingCount > 0) { tabsBadge.hidden = false; tabsBadge.textContent = String(playingCount); }
    else { tabsBadge.hidden = true; }

    const metaParts = [];
    if (playingCount) metaParts.push(`${playingCount} playing`);
    if (mutedCount)   metaParts.push(`${mutedCount} muted`);
    tabsMeta.textContent = metaParts.length ? metaParts.join(' · ') : 'No audio';

    tabsLabel.textContent = tabs.length === 0
      ? 'No audio tabs'
      : (tabs.length === 1 ? '1 tab' : `${tabs.length} tabs`);

    // Clear existing groups
    tabsList.innerHTML = '';

    if (!tabs.length) {
      tabsList.appendChild(tabsEmpty);
      tabsEmpty.style.display = 'flex';
      return;
    }
    tabsEmpty.style.display = 'none';

    if (audible.length) tabsList.appendChild(buildGroup('Now playing', 'playing', audible));
    if (muted.length)   tabsList.appendChild(buildGroup('Muted', 'muted', muted));
    if (others.length)  tabsList.appendChild(buildGroup('Other', 'other', others));
  }

  function buildGroup(title, kind, items) {
    const group = document.createElement('div');
    group.className = 'tabgroup';
    group.dataset.kind = kind;

    const head = document.createElement('div');
    head.className = 'tabgroup-head';
    const titleEl = document.createElement('span');
    titleEl.className = 'tabgroup-title';
    titleEl.textContent = title;
    const line = document.createElement('span');
    line.className = 'tabgroup-line';
    const count = document.createElement('span');
    count.className = 'tabgroup-count';
    count.textContent = String(items.length);
    head.appendChild(titleEl); head.appendChild(line); head.appendChild(count);
    group.appendChild(head);

    items.forEach((t) => group.appendChild(buildTabRow(t)));
    return group;
  }

  function buildTabRow(t) {
    const row = document.createElement('div');
    row.className = 'taudio' + (t.id === currentTabId ? ' current' : '');

    const indicator = document.createElement('span');
    indicator.className = 'taudio-ind';
    if (t.mutedInfo?.muted) indicator.classList.add('muted');
    else if (t.audible) indicator.classList.add('audible');
    row.appendChild(indicator);

    const fav = document.createElement('img');
    fav.className = 'taudio-fav';
    fav.alt = '';
    fav.src = t.favIconUrl || '';
    fav.onerror = () => { fav.style.visibility = 'hidden'; };
    row.appendChild(fav);

    const info = document.createElement('div');
    info.className = 'taudio-info';
    const host = document.createElement('div');
    host.className = 'taudio-host';
    const hostText = document.createElement('span');
    hostText.textContent = t.host || '(local)';
    host.appendChild(hostText);
    if (profiles[t.host]) {
      const tag = document.createElement('span');
      tag.className = 'profile-tag';
      tag.title = autoApply[t.host] ? 'Profile (auto-applied)' : 'Profile saved';
      host.appendChild(tag);
    }
    const title = document.createElement('div');
    title.className = 'taudio-title';
    title.textContent = t.title;
    info.appendChild(host); info.appendChild(title);
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'taudio-actions';

    const muteBtn = document.createElement('button');
    muteBtn.className = 'iconbtn';
    muteBtn.type = 'button';
    const isMuted = !!t.mutedInfo?.muted;
    muteBtn.title = isMuted ? 'Unmute' : 'Mute';
    muteBtn.setAttribute('aria-label', muteBtn.title);
    muteBtn.innerHTML = isMuted
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'BG_TOGGLE_TAB_MUTE', tabId: t.id }, () => {
        setTimeout(refreshTabsList, 150);
      });
    });
    actions.appendChild(muteBtn);

    const goBtn = document.createElement('button');
    goBtn.className = 'iconbtn primary';
    goBtn.type = 'button';
    goBtn.title = 'Switch to tab';
    goBtn.setAttribute('aria-label', 'Switch to tab');
    goBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>';
    goBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'BG_FOCUS_TAB', tabId: t.id }, () => window.close());
    });
    actions.appendChild(goBtn);

    row.appendChild(actions);
    row.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'BG_FOCUS_TAB', tabId: t.id }, () => window.close());
    });

    return row;
  }

  // ============ PROFILES MODAL ============
  function renderProfilesModal() {
    profilesModalBody.innerHTML = '';
    const entries = Object.entries(profiles);
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'modal-empty';
      empty.textContent = 'No profiles saved yet. Adjust settings on a site, open the profile menu, and click "Save current settings".';
      profilesModalBody.appendChild(empty);
      return;
    }
    entries.sort(([a], [b]) => a.localeCompare(b)).forEach(([host, p]) => {
      const row = document.createElement('div');
      row.className = 'plist' + (host === currentHost ? ' current' : '');

      const head = document.createElement('div');
      head.className = 'plist-head';
      const name = document.createElement('span');
      name.className = 'plist-host';
      name.textContent = host;
      const isAuto = !!autoApply[host];
      const badge = document.createElement('span');
      badge.className = 'plist-badge' + (isAuto ? ' auto' : '');
      badge.textContent = isAuto ? 'AUTO' : 'MANUAL';
      head.appendChild(name); head.appendChild(badge);

      const summary = [];
      summary.push(`${p.volume ?? 100}%`);
      if (p.bassBoost) summary.push('Bass');
      if (p.voice)     summary.push('Voice');
      if (p.mono)      summary.push('Mono');
      if (p.limiter === false) summary.push('No limit');
      if ((p.eq || []).some((v) => v !== 0)) summary.push('Custom EQ');
      const meta = document.createElement('div');
      meta.className = 'plist-meta';
      meta.textContent = summary.join(' · ');

      const actions = document.createElement('div');
      actions.className = 'plist-actions';

      const autoBtn = document.createElement('button');
      autoBtn.className = 'plist-btn' + (isAuto ? ' active' : '');
      autoBtn.type = 'button';
      autoBtn.textContent = isAuto ? 'Auto: on' : 'Auto: off';
      autoBtn.addEventListener('click', () => {
        if (isAuto) delete autoApply[host]; else autoApply[host] = true;
        chrome.storage.local.set({ autoApply, _origin: ORIGIN_ID }, () => {
          renderProfilesModal(); updateProfileUI();
        });
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'plist-btn danger';
      delBtn.type = 'button';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        delete profiles[host]; delete autoApply[host];
        chrome.storage.local.set({ profiles, autoApply, _origin: ORIGIN_ID }, () => {
          renderProfilesModal();
          if (host === currentHost) {
            editingProfile = false;
            chrome.storage.local.get(null, (data) => {
              assignFrom(data); renderAll(); updateProfileUI();
            });
          }
        });
      });

      actions.appendChild(autoBtn); actions.appendChild(delBtn);
      row.appendChild(head); row.appendChild(meta); row.appendChild(actions);
      profilesModalBody.appendChild(row);
    });
  }

  // ============ HELPERS ============
  function hostnameFromUrl(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (e) { return ''; }
  }

  // ============ CLEANUP ============
  window.addEventListener('unload', () => {
    clearInterval(meterTimer);
    clearInterval(tabsTimer);
    if (saveTimer) clearTimeout(saveTimer);
    if (statusTimer) clearTimeout(statusTimer);
  });
})();
