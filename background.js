// Volume Booster Pro — Background Service Worker

const DEFAULTS = {
  volume: 100,
  enabled: true,
  bassBoost: false,
  limiter: true,
  mono: false,
  voice: false,
  eq: [0, 0, 0, 0, 0],
  eqPreset: 'flat',
  profiles: {},   // { 'youtube.com': { volume, eq, ... } }
  autoApply: {},  // { 'youtube.com': true }
  mutedPrev: {},  // { 'youtube.com': 145 } — mute-restore values, kept OUT of profiles
};

const ORIGIN_ID = 'background';

// === Init ===
chrome.runtime.onInstalled.addListener(async (details) => {
  const existing = await chrome.storage.local.get(null);
  const toSet = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (existing[k] === undefined) toSet[k] = v;
  }

  // Migrate any legacy prevVolume that may live inside profile objects
  // or as a top-level key from older versions.
  const profiles  = existing.profiles  || {};
  const mutedPrev = { ...(existing.mutedPrev || {}) };
  let migrated = false;
  for (const [host, prof] of Object.entries(profiles)) {
    if (prof && typeof prof.prevVolume === 'number') {
      mutedPrev[host] = prof.prevVolume;
      delete prof.prevVolume;
      migrated = true;
    }
  }
  if (typeof existing.prevVolume === 'number') {
    mutedPrev.__global = existing.prevVolume;
    toSet.prevVolume = undefined; // will be cleared below
    migrated = true;
  }
  if (migrated) {
    toSet.profiles = profiles;
    toSet.mutedPrev = mutedPrev;
  }
  toSet._origin = ORIGIN_ID;

  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
  if (migrated && existing.prevVolume !== undefined) {
    await chrome.storage.local.remove('prevVolume');
  }

  if (details.reason === 'install' || details.reason === 'update') {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['content.js'],
        });
      } catch (e) { /* restricted page */ }
    }
  }
});

// === Helpers ===
function hostnameFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch (e) { return ''; }
}

async function effectiveSettingsForHost(host) {
  const data = await chrome.storage.local.get(null);
  const useProfile = data.autoApply?.[host] && data.profiles?.[host];
  const src = useProfile ? data.profiles[host] : data;
  const enabled = src.enabled !== false;
  return {
    type: 'SET_AUDIO',
    gain: enabled ? (src.volume ?? 100) / 100 : 1,
    enabled,
    bassBoost: !!src.bassBoost,
    limiter: src.limiter !== false,
    mono: !!src.mono,
    voice: !!src.voice,
    eq: src.eq || [0, 0, 0, 0, 0],
  };
}

async function pushSettingsToTab(tabId, host) {
  if (!host) return;
  const msg = await effectiveSettingsForHost(host);
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content.js'],
      });
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (_) {}
  }
}

// Track the last-pushed host per tab so we don't re-push on intra-page nav.
const lastHostByTab = new Map();

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !/^https?:/.test(tab.url)) return;
  const host = hostnameFromUrl(tab.url);
  if (lastHostByTab.get(tabId) === host) return; // skip — same host, content script still has it
  lastHostByTab.set(tabId, host);
  pushSettingsToTab(tabId, host);
});

chrome.tabs.onRemoved.addListener((tabId) => lastHostByTab.delete(tabId));

// === Keyboard shortcuts ===
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  const host = hostnameFromUrl(tab.url);
  const data = await chrome.storage.local.get(null);

  // Determine which scope we're editing — profile if auto-applied, else global.
  const useProfile = data.autoApply?.[host] && data.profiles?.[host];
  const src = useProfile ? data.profiles[host] : data;
  const mutedPrev = data.mutedPrev || {};
  const muteKey = host || '__global';

  let vol = src.volume ?? 100;

  switch (command) {
    case 'volume-up':   vol = Math.min(600, vol + 10); break;
    case 'volume-down': vol = Math.max(0, vol - 10);   break;
    case 'toggle-mute':
      if (vol > 0) {
        // Save current volume to mute-restore map (separate from profile object).
        mutedPrev[muteKey] = vol;
        vol = 0;
      } else {
        vol = mutedPrev[muteKey] || 100;
        delete mutedPrev[muteKey];
      }
      break;
    default: return;
  }

  const writes = { mutedPrev, _origin: ORIGIN_ID };
  if (useProfile) {
    data.profiles[host] = { ...data.profiles[host], volume: vol };
    writes.profiles = data.profiles;
  } else {
    writes.volume = vol;
  }
  await chrome.storage.local.set(writes);

  pushSettingsToTab(tab.id, host);
});

// === Popup helper messages ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'BG_LIST_AUDIO_TABS') {
    chrome.tabs.query({}, (tabs) => {
      const filtered = tabs
        .filter((t) => t.url && /^https?:/.test(t.url))
        .map((t) => ({
          id: t.id,
          windowId: t.windowId,
          title: t.title || '(untitled)',
          url: t.url,
          host: hostnameFromUrl(t.url),
          favIconUrl: t.favIconUrl || '',
          audible: !!t.audible,
          mutedInfo: t.mutedInfo || { muted: false },
          active: !!t.active,
        }))
        .sort((a, b) => (b.audible - a.audible) || a.title.localeCompare(b.title));
      sendResponse({ tabs: filtered });
    });
    return true;
  }

  if (msg.type === 'BG_GET_TAB_STATE') {
    const targetId = msg.tabId;
    chrome.tabs.sendMessage(targetId, { type: 'GET_STATE' }, (resp) => {
      if (chrome.runtime.lastError) sendResponse(null);
      else sendResponse(resp);
    });
    return true;
  }

  if (msg.type === 'BG_PUSH_TO_TAB') {
    chrome.tabs.get(msg.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) { sendResponse({ ok: false }); return; }
      pushSettingsToTab(tab.id, hostnameFromUrl(tab.url || '')).then(() => sendResponse({ ok: true }));
    });
    return true;
  }

  if (msg.type === 'BG_FOCUS_TAB') {
    chrome.tabs.update(msg.tabId, { active: true }, () => {
      chrome.tabs.get(msg.tabId, (tab) => {
        if (tab && tab.windowId !== undefined) {
          chrome.windows.update(tab.windowId, { focused: true });
        }
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  if (msg.type === 'BG_TOGGLE_TAB_MUTE') {
    chrome.tabs.get(msg.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) { sendResponse({ ok: false }); return; }
      const muted = !(tab.mutedInfo && tab.mutedInfo.muted);
      chrome.tabs.update(msg.tabId, { muted }, () => sendResponse({ ok: true, muted }));
    });
    return true;
  }
});
