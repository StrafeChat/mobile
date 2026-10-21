/**
 * The web's PasswordPromptHost: renders whatever `promptPassword()` (stores/passwordPrompt) is
 * asking, as the settings area's password sheet. The key-backup flow (stores/e2eeBackup) asks
 * through it for the account password before it creates or deletes a backup version - a
 * session token alone must not be enough to swap the backup for one whose key someone else
 * holds - and it runs outside any screen (device bootstrap as well as Devices & Encryption),
 * so like the recovery prompts the question is raised in a store and answered here.
 *
 * Answering closes the sheet; a wrong password makes the flow ask again, and the new prompt
 * opens with the error under the field (the store's lastSubmitError). Swiping the sheet away,
 * Android back or the close button cancel (PasswordPromptCancelled: "leave things as they
 * are"). Each prompt gets its own sheet instance, so a sheet still sliding away after an
 * answer can never cancel the prompt that replaced it.
 */
import { useRef } from 'react';
import { unwrap } from 'solid-js/store';
import { cancelPasswordPrompt, passwordPromptState, submitPasswordPrompt, type PasswordPromptOptions } from '@web/stores/passwordPrompt';
import { useSolid } from '@/bridge/solid';
import { PasswordPromptSheet } from '@/features/settings/components/sheets';

/** A stable number per raised prompt (the store holds a fresh object for each one). */
const promptIds = new WeakMap<object, number>();
let nextPromptId = 1;
function idOf(pending: object): number {
  let id = promptIds.get(pending);
  if (id === undefined) promptIds.set(pending, (id = nextPromptId++));
  return id;
}

/** The id of the prompt open right now, read without tracking (for event handlers). */
function currentPromptId(): number | null {
  const pending = unwrap(passwordPromptState).pending;
  return pending ? idOf(pending) : null;
}

interface ShownPrompt {
  id: number;
  options: PasswordPromptOptions;
}

export function PasswordPromptHost() {
  const prompt = useSolid((): ShownPrompt | null => {
    const p = passwordPromptState.pending;
    if (!p) return null;
    const o = p.options;
    return {
      id: idOf(unwrap(p)),
      options: { title: o.title, description: o.description, confirmLabel: o.confirmLabel, tone: o.tone, retainSubmitError: o.retainSubmitError },
    };
  });
  const lastError = useSolid(() => passwordPromptState.lastSubmitError);
  // The last prompt shown stays rendered (closed) while its sheet slides away.
  const shown = useRef<ShownPrompt | null>(null);
  if (prompt) shown.current = prompt;
  const view = shown.current;
  if (!view) return null;
  const open = prompt?.id === view.id;

  return (
    <PasswordPromptSheet
      key={view.id}
      open={open}
      title={view.options.title}
      description={view.options.description}
      confirmLabel={view.options.confirmLabel}
      tone={view.options.tone}
      error={open ? (lastError ?? undefined) : undefined}
      onConfirm={(password) => {
        submitPasswordPrompt(password);
        return Promise.resolve();
      }}
      // Fires once the sheet has closed for any reason. Only a close of the prompt still
      // waiting is a cancel: after an answer the store has already moved on.
      onClose={() => {
        if (currentPromptId() === view.id) cancelPasswordPrompt();
      }}
    />
  );
}
