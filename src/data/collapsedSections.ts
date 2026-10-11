/**
 * Which sections the user collapsed in a space's room list.
 *
 * Sections are open by default; only explicit collapses are remembered, per device, under the
 * web's own key ('strafe:collapsedSectionIds', one global set across spaces). The web keeps it
 * in a component signal seeded at mount; here it is a module signal so every list (phone nav
 * panel, tablet column) agrees and a toggle in one shows in the other.
 */
import { createSignal } from 'solid-js';
import { useDerived } from './derived';

const KEY = 'strafe:collapsedSectionIds';

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* unreadable: start open */
  }
  return new Set();
}

const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(load());

/** The collapsed set (reactive in Solid). */
export function collapsedSectionIds(): ReadonlySet<string> {
  return collapsed();
}

export function isSectionCollapsed(sectionId: string): boolean {
  return collapsed().has(sectionId);
}

export function toggleSectionCollapsed(sectionId: string): void {
  setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(sectionId)) next.delete(sectionId);
    else next.add(sectionId);
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      /* storage unavailable: the toggle still applies for this run */
    }
    return next;
  });
}

/** Whether one section is collapsed. Re-renders only when that changes. */
export function useSectionCollapsed(sectionId: string): boolean {
  return useDerived(`sectionCollapsed:${sectionId}`, () => collapsed().has(sectionId));
}
