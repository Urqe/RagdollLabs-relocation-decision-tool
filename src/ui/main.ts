import type { Release } from '../core/types.ts';
import { indexRelease, type Dataset } from '../data/load.ts';
import { applyLinkPay, createStore, formatRoute, loadProfile, parseRoute, saveProfile, type AppState } from '../state/store.ts';
import { renderCompare } from './compare.ts';
import { renderFind } from './find.ts';
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

/** The scenario opens on demand at every width; the first screen stays focused on discovery. */
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
  // Salaries in a shared link are applied once; the address then drops them.
  const fromLink = (s: AppState): AppState => {
    const next = applyLinkPay(s);
    if (next !== s) history.replaceState(null, '', formatRoute(next.route));
    return next;
  };
  const store = createStore(fromLink({ profile: loadProfile(storage), route: parseRoute(location.hash), overrides: {}, invalidFields: [] }));

  const summary = document.getElementById('panel-summary-text')!;
  const render = (): void => {
    const s = store.get();
    document.body.dataset.screen = s.route.screen;
    document.querySelectorAll<HTMLAnchorElement>('nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.screen === s.route.screen ? 'page' : 'false'));
    summary.textContent = householdSummary(s.profile);
    if (s.route.screen === 'methodology') renderMethodology(main, data);
    else if (s.route.screen === 'find') renderFind(main, s, data, store);
    else if (s.route.screen === 'compare') renderCompare(main, s, data, store);
    else renderExplore(main, s, data, store);
  };

  mountPanelToggle(panel, document.getElementById('panel-summary') as HTMLButtonElement, true);
  mountProfile(form, store, storage, data.release.lifestyle, data.release.preferences);
  store.subscribe((s, prev) => {
    if (s.profile !== prev.profile) saveProfile(storage, s.profile);
    const active = document.activeElement?.id;
    render();
    // Keep focus on controls inside the results area that were re-rendered.
    if (active && !panel.contains(document.activeElement)) document.getElementById(active)?.focus();
  });
  window.addEventListener('hashchange', () => {
    store.set((s) => fromLink({ ...s, route: parseRoute(location.hash) }));
    // A new screen starts at the top, with focus on the results area for keyboard and screen-reader users.
    if (!panel.contains(document.activeElement) && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  });
  document.getElementById('release-version')!.textContent = data.release.version;
  render();
}

void start();
