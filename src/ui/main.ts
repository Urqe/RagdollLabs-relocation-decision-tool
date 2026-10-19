import type { Release } from '../core/types.ts';
import { indexRelease, type Dataset } from '../data/load.ts';
import { createStore, loadProfile, parseRoute, saveProfile } from '../state/store.ts';
import { h } from './dom.ts';
import { renderExplore } from './explore.ts';
import { renderMethodology } from './methodology.ts';
import { mountProfile } from './profile.ts';

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    s.getItem('probe');
    return s;
  } catch {
    return null;
  }
}

async function loadRelease(): Promise<Dataset> {
  const res = await fetch('./data/release.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Data release could not be loaded (HTTP ${res.status}).`);
  return indexRelease((await res.json()) as Release);
}

async function start(): Promise<void> {
  const main = document.getElementById('main')!;
  const panel = document.getElementById('profile')!;
  let data: Dataset;
  try {
    data = await loadRelease();
  } catch (e) {
    main.replaceChildren(h('p', { class: 'empty', role: 'alert' }, (e as Error).message, ' Reload the page to try again.'));
    return;
  }

  const storage = safeStorage();
  const store = createStore({ profile: loadProfile(storage), route: parseRoute(location.hash), overrides: {} });

  const render = (): void => {
    const s = store.get();
    document.querySelectorAll<HTMLAnchorElement>('nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.screen === s.route.screen ? 'page' : 'false'));
    if (s.route.screen === 'methodology') renderMethodology(main, data);
    else renderExplore(main, s, data, store);
  };

  mountProfile(panel, store, storage);
  store.subscribe((s, prev) => {
    if (s.profile !== prev.profile) saveProfile(storage, s.profile);
    const active = document.activeElement?.id;
    render();
    // Keep focus on controls inside the results area that were re-rendered.
    if (active && !panel.contains(document.activeElement)) document.getElementById(active)?.focus();
  });
  window.addEventListener('hashchange', () => store.set((s) => ({ ...s, route: parseRoute(location.hash) })));
  document.getElementById('release-version')!.textContent = data.release.version;
  render();
}

void start();
