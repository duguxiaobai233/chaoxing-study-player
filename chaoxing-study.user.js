// ==UserScript==
// @name         超星视频与 PDF 连播
// @namespace    local.chaoxing.study
// @version      1.1.0
// @description  静音播放章节视频，逐页展示 PDF，按目录顺序继续。
// @match        https://*.chaoxing.com/mycourse/studentstudy*
// @match        https://*.chaoxing.com/mooc2-ans/mycourse/stu*
// @match        https://*.chaoxing.com/screen/v2/*
// @run-at       document-idle
// @sandbox      DOM
// @grant        GM_info
// ==/UserScript==

(() => {
  'use strict';
  const channel = 'cx-study-pdf-v1';
  const viewerOrigin = origin => /^https:\/\/[\w.-]+\.chaoxing\.com$/.test(origin);
  if (location.pathname.startsWith('/screen/v2/')) {
    // The viewer is usually on a different origin from the course page.
    window.addEventListener('message', event => {
      if (window === top || (event.source !== top && event.source !== parent.parent.parent) || !viewerOrigin(event.origin) ||
          event.data?.type !== channel || !event.ports[0]) return;
      const pages = [...document.querySelectorAll('[id^="anchor"],[name^="anchor"]')]
        .filter(el => /^anchor\d+$/.test(el.id || el.getAttribute('name')));
      const index = event.data.index;
      if (!Number.isInteger(index) || index < 0) return;
      const page = pages[index];
      if (page) page.scrollIntoView({block: index === pages.length - 1 ? 'end' : 'start'});
      event.ports[0].postMessage({count: pages.length, shown: Boolean(page)});
    });
    return;
  }
  const overview = location.pathname.startsWith('/mooc2-ans/mycourse/');
  if (overview && window !== top) return;
  if (document.getElementById('cx-study-controls')) return;

  const params = new URLSearchParams(location.search);
  const key = 'cx-study-next:' + params.get('courseId') + ':' + params.get('clazzid');
  const panel = document.createElement('aside');
  panel.id = 'cx-study-controls';
  panel.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:2147483647;background:#fff;color:#222;padding:12px;border:1px solid #aaa;border-radius:8px;max-width:320px;font:14px/1.6 sans-serif';
  const controls = panel.attachShadow({mode: 'open'});
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.textContent = overview ? '连播已加载。请从课程目录打开具体章节。' : '就绪';
  (document.body || document.documentElement).append(panel);
  if (overview) {
    controls.append(status);
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '开始连播';
  const seconds = document.createElement('input');
  Object.assign(seconds, {type: 'number', min: '1', max: '600'});
  seconds.style.width = '4em';
  const label = document.createElement('label');
  label.append(' PDF 每页 ', seconds, ' 秒');
  controls.append(button, label, status);
  seconds.value = sessionStorage.getItem(key + ':seconds') || '12';
  let runId = 0;
  let running = false;
  let playing = null;
  const chapter = () => new URLSearchParams(location.search).get('chapterId');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function stop(message) {
    ++runId;
    running = false;
    playing?.pause();
    playing = null;
    sessionStorage.removeItem(key);
    button.textContent = '开始连播';
    status.textContent = message;
  }

  function check(token) {
    if (token !== runId) throw new Error('已停止');
  }

  async function wait(token, read, message, timeout = 20000) {
    const deadline = Date.now() + timeout;
    do {
      check(token);
      const value = read();
      if (value) return value;
      await delay(350);
    } while (Date.now() < deadline);
    throw new Error(message);
  }

  function entries() {
    return [...document.querySelectorAll('#coursetree .posCatalog_select')];
  }

  function entryId(row) {
    for (const el of [row, ...row.querySelectorAll('[id]'), row.parentElement].filter(Boolean)) {
      const id = /^(?:cur|dct)(\d+)$/.exec(el.id);
      if (id) return id[1];
    }
    return row.getAttribute('data-id') || row.getAttribute('data-knowledgeid');
  }

  function remaining(row) {
    const selector = '[id^=cur],.catalog_points,.catalog_points_er,.jobCount,.jobUnfinishCount';
    const candidates = [row, ...row.querySelectorAll(selector)];
    for (const badge of candidates) {
      if (!badge.matches(selector) || !visible(badge)) continue;
      if (/^\d+$/.test(badge.textContent.trim())) return Number(badge.textContent);
    }
    // Some templates wrap both the chapter title and the count in the cur element.
    const lines = row.innerText.trim().split(/\n/).map(line => line.trim());
    const last = lines[lines.length - 1];
    return lines.length > 1 && /^\d+$/.test(last) ? Number(last) : null;
  }

  function visible(el) {
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function openPage(frame, index) {
    const link = new MessageChannel();
    const origin = new URL(frame.src).origin;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        link.port1.close();
        resolve({shown: false, count: 0, timedOut: true});
      }, 5000);
      link.port1.onmessage = e => {
        clearTimeout(timer);
        link.port1.close();
        resolve(e.data);
      };
      frame.contentWindow.postMessage({type: channel, index}, origin, [link.port2]);
    });
  }

  async function showPdf(module, token) {
    const reader = await wait(token, () => module.contentDocument?.querySelector('iframe[src*="/screen/v2/"]'), 'PDF 阅读器未加载');
    reader.scrollIntoView({block: 'center'});
    let index = 0;
    const deadline = Date.now() + 20000;
    while (true) {
      check(token);
      const page = await openPage(reader, index);
      check(token);
      if (!page.shown) {
        if (index || Date.now() > deadline) throw new Error(page.timedOut ? 'PDF 阅读器未响应，请检查文档域名的脚本权限' : '无法识别 PDF 页码');
        await delay(500);
        continue;
      }
      status.textContent = 'PDF 第 ' + (index + 1) + ' / ' + page.count + ' 页';
      const pause = Math.min(600, Math.max(1, Number(seconds.value) || 12));
      await delay(pause * 1000);
      if (++index >= page.count) return;
    }
  }

  async function showVideo(module, token) {
    const video = await wait(token, () => module.contentDocument?.querySelector('video'), '视频未加载');
    playing = video;
    video.muted = true;
    module.scrollIntoView({block: 'center'});
    status.textContent = '视频静音播放中';
    await video.play();
    let previous = video.currentTime;
    let progressAt = Date.now();
    while (!video.ended) {
      check(token);
      if (video.error || video.paused) throw new Error('视频已暂停，请检查播放器后继续');
      if (previous !== video.currentTime) progressAt = Date.now();
      if (Date.now() - progressAt > 45000) throw new Error('视频播放停滞，请检查加载状态');
      previous = video.currentTime;
      await delay(500);
    }
    check(token);
    playing = null;
  }

  async function study(token) {
    while (true) {
      const id = chapter();
      const row = await wait(token, () => entries().find(el => entryId(el) === id), '无法定位当前目录项');
      if (/测验|章节测试|考试/.test(row.innerText)) throw new Error('已到测验，请手动处理');
      const card = await wait(token, () => {
        const frame = document.querySelector('iframe[src*="knowledge/cards"]');
        if (!frame || new URL(frame.src).searchParams.get('knowledgeid') !== id) return null;
        const doc = frame.contentDocument;
        return doc?.querySelector('iframe[src*="/modules/"]') && doc;
      }, '未找到本节视频或 PDF');
      const modules = [...card.querySelectorAll('iframe[src*="/modules/"]')];
      for (const module of modules) {
        check(token);
        if (chapter() !== id || !module.isConnected) throw new Error('章节已变更，请重新启动');
        const box = module.closest('.ans-attach-ct');
        if (box?.matches('.ans-job-finished') || box?.querySelector('[aria-label="任务点已完成"]')) continue;
        if (module.src.includes('/modules/video/')) await showVideo(module, token);
        else if (module.src.includes('/modules/pdf/')) await showPdf(module, token);
        else if (!module.src.includes('/modules/insertbbs/')) throw new Error('本节包含其他类型的任务，请手动查看');
      }
      status.textContent = '等待目录确认本节完成';
      await wait(token, () => {
        const current = entries().find(el => entryId(el) === id) || (row.isConnected && row);
        if (!current || chapter() !== id) return false;
        const count = remaining(current);
        if (count > 0) return false;
        return [...current.querySelectorAll('.icon_Completed,.catalog_points_yi,[title="已完成"],[aria-label="已完成"]')].some(visible) || count === 0;
      }, '目录尚未确认完成，请查看剩余任务', 30000);
      const rows = entries();
      const at = rows.findIndex(el => el === row || entryId(el) === id);
      if (at < 0) throw new Error('目录已更新，请重新启动');
      const next = rows[at + 1];
      if (!next) throw new Error('已到目录末尾');
      if (/测验|章节测试|考试/.test(next.innerText)) throw new Error('下一节为测验，已停止连播');
      const target = entryId(next);
      if (!target || target === id) throw new Error('无法确认下一目录项，请手动选择');
      status.textContent = '正在打开 ' + next.innerText.trim();
      sessionStorage.setItem(key, target);
      (next.querySelector('.posCatalog_name') || next.querySelector('[onclick],a[href]') || next).click();
      await wait(token, () => chapter() === target, '切章结果与目录不符，请手动核对');
      sessionStorage.removeItem(key);
    }
  }

  function start() {
    running = true;
    const token = ++runId;
    sessionStorage.setItem(key + ':seconds', seconds.value);
    status.textContent = '正在读取章节';
    button.textContent = '暂停连播';
    study(token).catch(error => { if (token === runId) stop(error.message); });
  }
  button.onclick = () => running ? stop('已暂停') : start();
  const expected = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (expected && expected === chapter()) start();
})();
