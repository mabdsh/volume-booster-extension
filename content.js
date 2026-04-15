// Volume Booster Pro — Content Script
// Web Audio chain (always-connected, crossfade switches for limiter & mono):
//   source → gain → 5-band EQ → bass shelf → [limiter|bypass] → voice (M/S) → [stereo|mono] → destination

(function () {
  'use strict';

  // ============ STATE ============
  const chains = new Map();          // media element -> chain
  const trackedMedia = new WeakSet();
  const HOSTNAME = (location.hostname || '').replace(/^www\./, '');

  let cfg = {
    gain: 1,
    enabled: true,
    bassBoost: false,
    limiter: true,
    mono: false,
    voice: false,
    eq: [0, 0, 0, 0, 0],
  };

  const EQ_FREQS = [60, 230, 910, 4000, 14000];

  // ============ PROFILE RESOLUTION ============
  function resolveSettings(data) {
    const profiles  = data.profiles  || {};
    const autoApply = data.autoApply || {};
    const useProfile = autoApply[HOSTNAME] && profiles[HOSTNAME];
    const src = useProfile ? profiles[HOSTNAME] : data;

    const enabled = src.enabled !== false;
    cfg.gain      = enabled ? (src.volume ?? 100) / 100 : 1;
    cfg.enabled   = enabled;
    cfg.bassBoost = !!src.bassBoost;
    cfg.limiter   = src.limiter !== false;
    cfg.mono      = !!src.mono;
    cfg.voice     = !!src.voice;
    cfg.eq        = Array.isArray(src.eq) ? src.eq.slice(0, 5) : [0, 0, 0, 0, 0];
    while (cfg.eq.length < 5) cfg.eq.push(0);
  }

  // ============ AUTOPLAY POLICY ============
  const pendingContexts = new Set();
  const resumeAll = () => {
    pendingContexts.forEach((ctx) => {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    });
  };
  ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((ev) => {
    document.addEventListener(ev, resumeAll, { capture: true, passive: true });
  });

  // ============ BUILD AUDIO CHAIN ============
  function buildChain(media) {
    if (chains.has(media)) return chains.get(media);
    if (media.__vbpHooked) return null;       // either built or known-failed

    // CRITICAL: mark hooked BEFORE the try, so failures don't get retried
    // on every play event (which leaks AudioContexts to the browser cap of ~6).
    media.__vbpHooked = true;

    let ctx;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;

      ctx = new AudioCtx();
      pendingContexts.add(ctx);

      let source;
      try {
        source = ctx.createMediaElementSource(media);
      } catch (e) {
        // Tainted (cross-origin without CORS) or already hooked elsewhere.
        ctx.close().catch(() => {});
        pendingContexts.delete(ctx);
        return null;
      }

      // -------- Pre-output --------
      const gainNode = ctx.createGain();
      gainNode.gain.value = cfg.gain;

      const eqNodes = EQ_FREQS.map((freq, i) => {
        const f = ctx.createBiquadFilter();
        f.type = i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking';
        f.frequency.value = freq;
        if (f.type === 'peaking') f.Q.value = 1.4;
        f.gain.value = cfg.eq[i] || 0;
        return f;
      });

      const bassFilter = ctx.createBiquadFilter();
      bassFilter.type = 'lowshelf';
      bassFilter.frequency.value = 200;
      bassFilter.gain.value = cfg.bassBoost ? 10 : 0;

      // -------- Limiter (always connected; crossfade gains) --------
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -1;
      compressor.knee.value = 0;
      compressor.ratio.value = 20;
      compressor.attack.value = 0.001;
      compressor.release.value = 0.05;

      const limOnGain  = ctx.createGain();   // 1 when limiter enabled
      const limOffGain = ctx.createGain();   // 1 when limiter bypassed
      limOnGain.gain.value  = cfg.limiter ? 1 : 0;
      limOffGain.gain.value = cfg.limiter ? 0 : 1;

      // -------- Voice Isolation (M/S) — always connected --------
      const viInput    = ctx.createGain();
      const viSplitter = ctx.createChannelSplitter(2);

      const midL  = ctx.createGain(); midL.gain.value  = 0.5;
      const midR  = ctx.createGain(); midR.gain.value  = 0.5;
      const sideL = ctx.createGain(); sideL.gain.value = 0.5;
      const sideR = ctx.createGain(); sideR.gain.value = -0.5;

      const midSum  = ctx.createGain();
      const sideSum = ctx.createGain();

      const midGain  = ctx.createGain();
      const sideGain = ctx.createGain();
      midGain.gain.value  = cfg.voice ? 1.6 : 1.0;
      sideGain.gain.value = cfg.voice ? 0.25 : 1.0;

      const sideInvR    = ctx.createGain(); sideInvR.gain.value = -1;
      const reconL      = ctx.createGain();
      const reconR      = ctx.createGain();
      const reconMerger = ctx.createChannelMerger(2);

      // -------- Mono / stereo output (always connected; crossfade gains) --------
      const outSplitter = ctx.createChannelSplitter(2);

      // Stereo path — separate L/R gains
      const stOnL = ctx.createGain(); stOnL.gain.value = cfg.mono ? 0 : 1;
      const stOnR = ctx.createGain(); stOnR.gain.value = cfg.mono ? 0 : 1;

      // Mono path — single sum node, scaled 0.5 to prevent +6 dB on summing.
      const monoSum    = ctx.createGain(); monoSum.gain.value = 0.5;
      const monoOnGain = ctx.createGain(); monoOnGain.gain.value = cfg.mono ? 1 : 0;

      const merger = ctx.createChannelMerger(2);

      // -------- Analysers (always tap from outSplitter) --------
      const analyserL = ctx.createAnalyser();
      const analyserR = ctx.createAnalyser();
      analyserL.fftSize = 256; analyserL.smoothingTimeConstant = 0.4;
      analyserR.fftSize = 256; analyserR.smoothingTimeConstant = 0.4;
      // Silent sink keeps the analyser branch active. Some Web Audio
      // implementations skip processing for nodes whose output never reaches
      // the destination — without this sink the meters can read flat-line zero.
      const analyserSink = ctx.createGain();
      analyserSink.gain.value = 0;

      // ===================== Static connections =====================
      // Pre-stage
      source.connect(gainNode);
      let prev = gainNode;
      eqNodes.forEach((eq) => { prev.connect(eq); prev = eq; });
      prev.connect(bassFilter);

      // Limiter crossfade (parallel: bass→compressor→limOn AND bass→limOff)
      bassFilter.connect(compressor);
      compressor.connect(limOnGain);
      limOnGain.connect(viInput);
      bassFilter.connect(limOffGain);
      limOffGain.connect(viInput);

      // Voice (M/S)
      viInput.connect(viSplitter);
      viSplitter.connect(midL,  0); viSplitter.connect(midR,  1);
      midL.connect(midSum); midR.connect(midSum);
      midSum.connect(midGain);

      viSplitter.connect(sideL, 0); viSplitter.connect(sideR, 1);
      sideL.connect(sideSum); sideR.connect(sideSum);
      sideSum.connect(sideGain);

      midGain.connect(reconL);
      sideGain.connect(reconL);
      midGain.connect(reconR);
      sideGain.connect(sideInvR);
      sideInvR.connect(reconR);
      reconL.connect(reconMerger, 0, 0);
      reconR.connect(reconMerger, 0, 1);

      // Output: split → stereo path + mono path → merger
      reconMerger.connect(outSplitter);

      // Stereo path: L→stOnL→merger.0, R→stOnR→merger.1
      outSplitter.connect(stOnL, 0);
      outSplitter.connect(stOnR, 1);
      stOnL.connect(merger, 0, 0);
      stOnR.connect(merger, 0, 1);

      // Mono path: (L + R) → monoSum (gain 0.5) → monoOnGain → both merger inputs.
      // Single monoSum node ensures we never double-count L+R, and the 0.5
      // scaling prevents +6 dB peaks on correlated stereo material.
      outSplitter.connect(monoSum, 0);
      outSplitter.connect(monoSum, 1);
      monoSum.connect(monoOnGain);
      monoOnGain.connect(merger, 0, 0);
      monoOnGain.connect(merger, 0, 1);

      // Analysers (always live) — outputs routed through silent sink to dest
      // so the engine treats them as part of an active processing graph.
      outSplitter.connect(analyserL, 0);
      outSplitter.connect(analyserR, 1);
      analyserL.connect(analyserSink);
      analyserR.connect(analyserSink);
      analyserSink.connect(ctx.destination);

      merger.connect(ctx.destination);

      const chain = {
        ctx, source, gainNode, eqNodes, bassFilter,
        compressor, limOnGain, limOffGain,
        midGain, sideGain,
        stOnL, stOnR, monoOnGain,
        analyserL, analyserR,
        media,
      };

      chains.set(media, chain);
      applyConfig(chain);

      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return chain;
    } catch (e) {
      console.warn('[VBP] Chain build failed:', e?.message);
      if (ctx) {
        try { ctx.close(); } catch (_) {}
        pendingContexts.delete(ctx);
      }
      return null;
    }
  }

  // ============ APPLY CONFIG (param updates only — no reconnects) ============
  function applyConfig(chain) {
    const t = chain.ctx.currentTime;
    const smooth = 0.03;

    chain.gainNode.gain.setTargetAtTime(cfg.gain, t, smooth);
    chain.eqNodes.forEach((eq, i) => eq.gain.setTargetAtTime(cfg.eq[i] || 0, t, smooth));
    chain.bassFilter.gain.setTargetAtTime(cfg.bassBoost ? 10 : 0, t, smooth);

    // Limiter crossfade
    chain.limOnGain.gain.setTargetAtTime(cfg.limiter ? 1 : 0, t, smooth);
    chain.limOffGain.gain.setTargetAtTime(cfg.limiter ? 0 : 1, t, smooth);

    // Voice isolation
    chain.midGain.gain.setTargetAtTime(cfg.voice ? 1.6 : 1.0, t, smooth);
    chain.sideGain.gain.setTargetAtTime(cfg.voice ? 0.25 : 1.0, t, smooth);

    // Mono crossfade
    chain.stOnL.gain.setTargetAtTime(cfg.mono ? 0 : 1, t, smooth);
    chain.stOnR.gain.setTargetAtTime(cfg.mono ? 0 : 1, t, smooth);
    chain.monoOnGain.gain.setTargetAtTime(cfg.mono ? 1 : 0, t, smooth);
  }

  function applyAll() {
    chains.forEach((chain) => applyConfig(chain));
  }

  // ============ TEARDOWN ============
  function destroyChain(media) {
    const chain = chains.get(media);
    if (!chain) return;
    try { chain.source.disconnect(); } catch (e) {}
    try { chain.ctx.close(); } catch (e) {}
    pendingContexts.delete(chain.ctx);
    chains.delete(media);
  }

  // ============ METERING / STATE ============
  function pickActiveMedia() {
    let best = null, bestScore = -1;
    for (const media of chains.keys()) {
      if (!media.isConnected) continue;
      const playing = !media.paused && !media.ended && media.readyState > 2;
      const score = (playing ? 10 : 0) + (media.muted ? 0 : 1) + (media.volume || 0);
      if (score > bestScore) { bestScore = score; best = media; }
    }
    return best;
  }

  function getLevels() {
    const media = pickActiveMedia();
    if (!media) return { left: -60, right: -60 };
    const chain = chains.get(media);
    if (!chain) return { left: -60, right: -60 };

    const bufL = new Float32Array(chain.analyserL.fftSize);
    const bufR = new Float32Array(chain.analyserR.fftSize);
    chain.analyserL.getFloatTimeDomainData(bufL);
    chain.analyserR.getFloatTimeDomainData(bufR);

    const rms = (buf) => {
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.sqrt(sum / buf.length);
    };
    const toDb = (v) => (v > 0.0001 ? 20 * Math.log10(v) : -60);

    return { left: toDb(rms(bufL)), right: toDb(rms(bufR)) };
  }

  function getState() {
    const hasMedia = document.querySelectorAll('audio, video').length > 0;
    const isPlaying = !!pickActiveMedia();
    return {
      hostname: HOSTNAME,
      hasMedia,
      isPlaying,
      hookedCount: chains.size,
      cfg: { ...cfg, volume: Math.round(cfg.gain * 100) },
    };
  }

  // ============ MESSAGING ============
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SET_AUDIO') {
      cfg.gain      = msg.gain;
      cfg.enabled   = msg.enabled;
      cfg.bassBoost = !!msg.bassBoost;
      cfg.limiter   = msg.limiter !== false;
      cfg.mono      = !!msg.mono;
      cfg.voice     = !!msg.voice;
      cfg.eq        = msg.eq || [0, 0, 0, 0, 0];
      applyAll();
      sendResponse({ ok: true, hooked: chains.size });
    } else if (msg.type === 'GET_LEVELS') {
      sendResponse(getLevels());
    } else if (msg.type === 'GET_STATE') {
      sendResponse(getState());
    } else if (msg.type === 'PING') {
      sendResponse({ ok: true });
    } else if (msg.type === 'RESYNC') {
      chrome.storage.local.get(null, (data) => {
        resolveSettings(data);
        applyAll();
        sendResponse({ ok: true });
      });
      return true;
    }
    return true;
  });

  // ============ MUTATION OBSERVER ============
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') hookMedia(node);
        node.querySelectorAll?.('audio, video').forEach(hookMedia);
      }
      for (const node of m.removedNodes) {
        if (node.nodeType !== 1) continue;
        if (chains.has(node)) destroyChain(node);
        node.querySelectorAll?.('audio, video').forEach((el) => {
          if (chains.has(el)) destroyChain(el);
        });
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // ============ HOOK MEDIA ============
  function hookMedia(el) {
    if (trackedMedia.has(el)) return;
    trackedMedia.add(el);
    el.addEventListener('play', () => buildChain(el));
    if (!el.paused && el.readyState > 0) buildChain(el);
  }

  // ============ LOAD ============
  chrome.storage.local.get(null, (data) => {
    resolveSettings(data);
    const go = () => document.querySelectorAll('audio, video').forEach(hookMedia);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', go);
    } else {
      go();
    }
  });

  // Catch-all 'play' for elements we may have missed
  document.addEventListener('play', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) {
      hookMedia(t);
      buildChain(t);
    }
  }, true);

  // React to storage changes (skip pure UI-state keys)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const audioRelevant = Object.keys(changes).some((k) =>
      !['accordionState', '_origin'].includes(k)
    );
    if (!audioRelevant) return;
    chrome.storage.local.get(null, (data) => {
      resolveSettings(data);
      applyAll();
    });
  });
})();