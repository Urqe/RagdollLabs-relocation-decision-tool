import type { Release } from '../core/types.ts';
import { indexRelease, type Dataset } from '../data/load.ts';
import { createStore, loadProfile, parseRoute, saveProfile, STORAGE_KEY } from '../state/store.ts';
import { h } from './dom.ts';
import { renderExplore } from './explore.ts';
import { renderMethodology } from './methodology.ts';
import { householdSummary, mountProfile } from './profile.ts';

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

/** Phones: the household form collapses to a one-line summary. Desktop CSS ignores the collapsed state. */
function mountPanelToggle(panel: HTMLElement, button: HTMLButtonElement, startCollapsed: boolean): void {
  const set = (collapsed: boolean): void => {
    panel.classList.toggle('collapsed', collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
  };
  set(startCollapsed);
  button.addEventListener('click', () => set(!panel.classList.contains('collapsed')));
}

async function start(): Promise<void> {
  const main = document.getElementById('main')!;
  const form = document.getElementById('profile')!;
  const panel = document.getElementById('panel')!;
  let data: Dataset;
  try {
    data = await loadRelease();
  } catch (e) {
    main.replaceChildren(h('p', { class: 'empty', role: 'alert' }, (e as Error).message, ' Reload the page to try again.'));
    return;
  }

  const storage = safeStorage();
  let returning = false;
  try {
    returning = storage?.getItem(STORAGE_KEY) != null;
  } catch {
    returning = false;
  }
  const store = createStore({ profile: loadProfile(storage), route: parseRoute(location.hash), overrides: {}, invalidFields: [] });

  const summary = document.getElementById('panel-summary-text')!;
  const render = (): void => {
    const s = store.get();
    document.body.dataset.screen = s.route.screen;
    document.querySelectorAll<HTMLAnchorElement>('nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.screen === s.route.screen ? 'page' : 'false'));
    summary.textContent = householdSummary(s.profile);
    if (s.route.screen === 'methodology') renderMethodology(main, data);
    else renderExplore(main, s, data, store);
  };

  mountPanelToggle(panel, document.getElementById('panel-summary') as HTMLButtonElement, returning);
  mountProfile(form, store, storage);
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
