import { PalaceView, setLocale, createHomePalace, createFromTemplate, normalizePalace, normalizeWorld, createWorld, createRegion, findFreeSpot, findRegionSpot, boundLoci, type HostAdapter, type PalaceDoc, type PalaceWorld, type ReviewState, type Rating, type BlockRef } from '@kmind-palace/core';
import * as structure from '@kmind-palace/core/structure';
import { html } from '@kmind-palace/core/dom';

const QS = new URLSearchParams(location.search);
const LANG = QS.get('lang') || undefined;
setLocale(LANG ?? navigator.language);

const API_BASE = '/api/v1';

async function apiGet<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) return null;
  return res.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json();
}

async function apiPatch<T>(path: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json();
}

async function apiDelete(path: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  return res.ok;
}

const host: HostAdapter = {
  prefs: {
    get: (k) => {
      const v = localStorage.getItem(k);
      return v ?? undefined;
    },
    set: (k, v) => localStorage.setItem(k, v),
  },
  async pickBlock({ itemName } = {}): Promise<BlockRef | null> {
    const res = await fetch(`${API_BASE}/blocks/search?q=${encodeURIComponent(itemName || '')}`);
    if (!res.ok) return null;
    const items = await res.json();
    if (!items.length) return null;
    const selected = await new Promise<{ id: string; title: string } | null>(resolve => {
      const div = document.createElement('div');
      div.className = 'pg-pick-mask';
      div.innerHTML = `
        <div class="pg-pick">
          <h3>${`为「${itemName}」绑定笔记块`}</h3>
          <input type="text" placeholder="搜索笔记或块内容" />
          <ul></ul>
        </div>`;
      const input = div.querySelector('input')!;
      const ul = div.querySelector('ul')!;
      const render = (filter = '') => {
        ul.innerHTML = items
          .filter(x => x.title.toLowerCase().includes(filter.toLowerCase()) || x.sub?.toLowerCase().includes(filter.toLowerCase()))
          .map(x => `<li data-id="${x.id}"><span>${x.title}</span><small>${x.sub || ''}</small></li>`)
          .join('');
      };
      render();
      input.addEventListener('input', () => render(input.value));
      ul.addEventListener('click', e => {
        const li = (e.target as HTMLElement).closest('li');
        const id = li?.dataset.id;
        if (id) resolve(items.find(x => x.id === id) || null);
        else resolve(null);
      });
      document.body.appendChild(div);
      input.focus();
      return () => div.remove();
    });
    return selected ? { id: selected.id, title: selected.title } : null;
  },
  openBlock(id) { window.open(`/block/${id}`, '_blank'); },
  async getBlock(id) { return apiGet<{ id: string; title: string; body: string }>(`/blocks/${id}`); },
  onDocChange: saveDoc,
  onWorldChange: saveWorld,
  onDocDelete: deleteDoc,
  onLocationChange(id, name) { document.title = `${name} · KMind Palace`; },
  notify(msg) { console.info('[notify]', msg); },
  review: {
    async getStates(ids) {
      const res = await apiPost<Record<string, ReviewState>>('/review/states', { ids });
      return res || {};
    },
    async rate(id, r) {
      return apiPost<ReviewState>(`/review/rate/${id}`, { rating: r });
    },
  },
  async listDocs(src) { return apiGet<{ id: string; title: string }[]>(`/docs?box=${src.box}`); },
  async pickDocSource() {
    const res = await apiGet<{ id: string; name: string }[]>('/notebooks');
    if (!res?.length) return null;
    const selected = await new Promise<string | null>(resolve => {
      const div = document.createElement('div');
      div.className = 'pg-pick-mask';
      div.innerHTML = `<div class="pg-pick"><h3>把哪个笔记本摆上书架？</h3><input placeholder="搜索笔记本" /><ul></ul></div>`;
      const input = div.querySelector('input')!;
      const ul = div.querySelector('ul')!;
      const render = (filter = '') => {
        ul.innerHTML = res
          .filter(x => x.name.toLowerCase().includes(filter.toLowerCase()))
          .map(x => `<li data-id="${x.id}"><span>${x.name}</span></li>`)
          .join('');
      };
      render();
      input.addEventListener('input', () => render(input.value));
      ul.addEventListener('click', e => { const li = (e.target as HTMLElement).closest('li'); if (li) resolve(li.dataset.id || null); });
      document.body.appendChild(div);
      input.focus();
    });
    const nb = res.find(x => x.id === selected);
    return nb ? { box: nb.id, path: '/', name: nb.name } : null;
  },
  watchDocs(cb) {
    const ws = new WebSocket(`${location.protocol.replace('http', 'ws')}//${location.host}/api/v1/docs/watch`);
    ws.onmessage = e => { try { cb(); } catch {} };
    return () => ws.close();
  },
  async saveMedia(blob, id): Promise<void> {
    const form = new FormData();
    form.append('file', blob, id);
    const res = await fetch(`${API_BASE}/media`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('save media failed');
  },
  async loadMedia(id) { return `${API_BASE}/media/${id}`; },
  social: {
    serverUrl: () => '',
    loadAccount: async () => null,
    saveAccount: async () => {},
  },
  ai: {
    async chat(messages) { return 'AI not configured on web host.'; },
    imageEnabled: () => false,
    async image(prompt) { throw new Error('Not available'); },
    style: () => 'vivid',
    visionEnabled: () => false,
  },
  async getBlockText(id) { return ''; },
  async writeStory(o) { console.info('[web-host] write story', o); },
  openSettings() { console.info('[web-host] settings'); },
  renderBlock(el, id) {
    el.replaceChildren(html`<div style="padding:8px 12px;line-height:1.7"><p style="margin:0 0 6px"><b>示例笔记</b></p><p style="margin:0">Web host does not have full note access.</p></div>`);
    return () => el.replaceChildren();
  },
};

async function loadWorld(): Promise<{ world?: PalaceWorld; docs: PalaceDoc[] }> {
  const [world, docs] = await Promise.all([
    apiGet<PalaceWorld>('/world'),
    apiGet<PalaceDoc[]>('/palaces'),
  ]);
  if (world && docs?.length) return { world, docs };
  const home: PalaceDoc = {
    id: 'home', name: '家', format: 'kmind-palace', version: 1,
    createdAt: Date.now(), updatedAt: Date.now(), rooms: [], walls: [], items: [],
  };
  const roots: PalaceDoc = {
    id: 'roots', name: 'Roots', format: 'kmind-palace', version: 1,
    createdAt: Date.now(), updatedAt: Date.now(), rooms: [], walls: [], items: [],
  };
  const rust: PalaceDoc = {
    id: 'rust', name: 'Rust书房', format: 'kmind-palace', version: 1,
    createdAt: Date.now(), updatedAt: Date.now(), rooms: [], walls: [], items: [],
  };
  const apt: PalaceDoc = {
    id: 'apt', name: '公寓', format: 'kmind-palace', version: 1,
    createdAt: Date.now(), updatedAt: Date.now(), rooms: [], walls: [], items: [],
  };
  const history: PalaceDoc = {
    id: 'history', name: '历史', format: 'kmind-palace', version: 1,
    createdAt: Date.now(), updatedAt: Date.now(), rooms: [], walls: [], items: [],
  };
  const sky = Object.assign(createFromTemplate('twoRooms', '云端书屋'), { color: '#4f7f8a' });
  const docList: PalaceDoc[] = [home, roots, rust, apt, history, sky];
  for (const doc of docList) await apiPost('/palaces', doc);
  const newWorld = createWorld();
  newWorld.regions = [];
  const groups: [string, string, number, PalaceDoc[]][] = [
    ['岛上小镇', 'island', 101, [home, apt]],
    ['林间小岛', 'forest', 202, [rust, roots]],
    ['雪山小岛', 'snow', 303, [history]],
    ['浮空岛', 'sky', 404, [sky]],
  ];
  for (const [name, theme, seedN, list] of groups) {
    const r = createRegion(name, theme);
    r.seed = seedN;
    for (const d of list) r.palaces.push({ palaceId: d.id, pos: findFreeSpot(r, new Map(docList.map(d => [d.id, d])), d), rot: 0 });
    r.origin = findRegionSpot(newWorld, new Map(docList.map(d => [d.id, d])), r);
    newWorld.regions.push(r);
  }
  await apiPatch('/world', newWorld);
  return { world: newWorld, docs: docList };
}

async function saveDoc(doc: PalaceDoc) {
  await apiPatch(`/palaces/${doc.id}`, doc);
}

async function saveWorld(world: PalaceWorld) {
  await apiPatch('/world', world);
}

async function deleteDoc(id: string) {
  await apiDelete(`/palaces/${id}`);
}

const { world, docs } = await loadWorld();
const params = new URLSearchParams(location.search);
const view = new PalaceView(document.getElementById('app')!, { world, docs, host, enter: params.get('enter'), locale: LANG });
(window as any).palaceView = view;
(window as any).structure = structure;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

if (QS.get('demo')) {
  const demo = QS.get('demo');
  const c: any = view.townCtl;
  const first = [...view.docs.values()].sort((a: PalaceDoc, b: PalaceDoc) => b.items.length - a.items.length)[1];
  if (demo === 'card') c.select(first.id);
  if (demo === 'list') c.toggleList(true);
  if (demo === 'build') c.openBuild();
  if (demo === 'palette') { c.openPalette(); const i = view.ui.paletteInput as HTMLInputElement; i.value = QS.get('q') || '法'; i.dispatchEvent(new Event('input')); }
  if (demo === 'edit') { c.setEditing(true); c.select(first.id); }
  if (demo === 'night') view.toggleNight();
  if (demo === 'inside') view.enterPalace(first.id, { instant: true });
  if (demo === 'recall' || demo === 'routes') {
    const rust = [...view.docs.values()].find((d: PalaceDoc) => d.name === 'Rust 书房') || first;
    view.enterPalace(rust.id, { instant: true });
    if (demo === 'recall') view.recall.start(false); else view.recall.togglePanel(true);
  }
}