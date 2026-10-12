/**
 * ErrorBoundary: a render error inside it remounts its children instead of closing the app.
 *
 * Without a boundary, an error thrown while rendering or from an effect unmounts the whole
 * React tree, and a release build then closes ("keeps stopping"). Wrapped, the failing panel
 * is logged and rebuilt from scratch (its children remount with a new key), which for most
 * failures - a list that asked for a stale index, a row whose data vanished mid-render - is
 * already the fix: the fresh mount reads the current state.
 *
 * An error that comes straight back would remount forever, so after `maxResets` remounts
 * within `windowMs` the boundary stops and shows a compact "Something went wrong" with a
 * Retry instead. It does not catch errors in event handlers, timers or promises (React never
 * sees those): code that calls into native or list internals from there catches for itself.
 */
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { t } from '@web/i18n/t';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

export interface ErrorBoundaryProps {
  /** Names the boundary in the log ("message-list", "members"...). */
  name: string;
  children?: ReactNode;
  /** Remounts allowed within `windowMs` before the fallback shows (default 3). */
  maxResets?: number;
  /** The window those remounts are counted in, ms (default 10 s). */
  windowMs?: number;
}

interface State {
  /** The children's key: bumping it remounts them. */
  generation: number;
  /** Between the error and componentDidCatch's decision: render nothing. */
  errored: boolean;
  /** Gave up remounting: the fallback shows until Retry. */
  failed: boolean;
}

export const ERROR_BOUNDARY_MAX_RESETS = 3;
export const ERROR_BOUNDARY_WINDOW_MS = 10_000;

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { generation: 0, errored: false, failed: false };
  /** When each recent remount happened (only the ones inside the window are kept). */
  private resets: number[] = [];

  static getDerivedStateFromError(): Partial<State> {
    return { errored: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The error and where it happened; never props or state (they can hold message text).
    console.error(`[${this.props.name}] render error, remounting:`, error instanceof Error ? error.message : error, info.componentStack ?? '');
    const now = Date.now();
    const windowMs = this.props.windowMs ?? ERROR_BOUNDARY_WINDOW_MS;
    this.resets = this.resets.filter((at) => now - at < windowMs);
    if (this.resets.length >= (this.props.maxResets ?? ERROR_BOUNDARY_MAX_RESETS)) {
      this.setState({ failed: true });
      return;
    }
    this.resets.push(now);
    this.setState((s) => ({ errored: false, generation: s.generation + 1 }));
  }

  private retry = (): void => {
    this.resets = [];
    this.setState((s) => ({ errored: false, failed: false, generation: s.generation + 1 }));
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <EmptyState
          size="page"
          icon="fa-solid fa-triangle-exclamation"
          body={t('errors.unknown')}
          action={<Button title={t('common.retry')} size="sm" variant="outline" onPress={this.retry} />}
        />
      );
    }
    if (this.state.errored) return null;
    return <Fragment key={this.state.generation}>{this.props.children}</Fragment>;
  }
}
