import { getMyGoogleDriveStatus } from '@immich/sdk';

/**
 * Polls the user's Google Drive backup progress, for the card in the corner and the bar inside the
 * album menu.
 *
 * **Why polling rather than websockets.** Uploads run as server-side jobs that outlive the page,
 * so the honest question a client can ask is "where is it now" — which is a poll. Pushing would
 * mean adding an event type, wiring it through the SDK, and teaching mobile to ignore it, for a
 * feature whose useful resolution is "roughly every few seconds" on a family-scale server. If that
 * ever stops being true, this is one class to replace.
 *
 * **Why one shared manager rather than per-component polling.** Two things want this data at once
 * (the corner card and the album menu's bar). Independent pollers would double the request rate
 * and could disagree with each other on screen. Subscribers are reference-counted: the timer runs
 * while at least one is watching and stops when the last goes away.
 */
class GoogleDriveProgressManager {
  /** Assets selected for backup that aren't in the user's Drive yet. */
  pending = $state(0);
  /** Assets whose last attempt failed. */
  failed = $state(0);
  /** Account-level pause (`quota_exceeded` / `folder_missing`), or null. */
  blockedReason = $state<string | null>(null);
  /** True once a poll has landed, so the UI can tell "nothing pending" from "don't know yet". */
  loaded = $state(false);

  /**
   * Set when the *user* starts something in this tab (turning backup on, pressing sync). The
   * corner card keys off this rather than off `pending > 0`: an automatic background upload
   * appearing as a card nobody asked for is startling, whereas one you just triggered is feedback.
   */
  userInitiated = $state(false);

  /** True while there is genuinely work moving — pending, and not paused. */
  active = $derived(this.pending > 0 && !this.blockedReason);

  #watchers = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #lastPending: number | null = null;
  #quietPolls = 0;

  /** 3s while things move; backs off to 15s when nothing changes, so an idle tab is nearly free. */
  static readonly #FAST_MS = 3000;
  static readonly #SLOW_MS = 15_000;
  static readonly #QUIET_POLLS_BEFORE_SLOWING = 5;

  /**
   * Start watching. Returns an unsubscribe function — the caller is expected to invoke it on
   * destroy, and the timer stops once the last watcher does.
   */
  watch(): () => void {
    this.#watchers++;
    if (this.#watchers === 1) {
      void this.refresh();
      this.#schedule();
    }

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#watchers--;
      if (this.#watchers === 0) {
        this.#stop();
      }
    };
  }

  /** Poll once, now — used after an action so the UI reflects it without waiting for the tick. */
  async refresh(): Promise<void> {
    try {
      const status = await getMyGoogleDriveStatus();
      this.pending = status.pending;
      this.failed = status.failed;
      this.blockedReason = status.blockedReason ?? null;
      this.loaded = true;

      // Nothing moved? Start easing off. Any change resets to the fast cadence.
      this.#quietPolls = status.pending === this.#lastPending ? this.#quietPolls + 1 : 0;
      this.#lastPending = status.pending;

      // Work finished: the card has said what it needed to, so stop claiming the user started it.
      if (status.pending === 0) {
        this.userInitiated = false;
      }
    } catch {
      // Deliberately silent. This runs on a timer in the background; a transient failure should
      // leave the last known numbers on screen rather than throwing a toast at someone who isn't
      // looking. Real problems surface through the failure count and the settings banner.
    }
  }

  /** Called by the actions that begin work, so the corner card knows it was asked for. */
  markUserInitiated(): void {
    this.userInitiated = true;
    void this.refresh();
  }

  #schedule(): void {
    if (this.#watchers === 0) {
      return;
    }
    const interval =
      this.#quietPolls >= GoogleDriveProgressManager.#QUIET_POLLS_BEFORE_SLOWING
        ? GoogleDriveProgressManager.#SLOW_MS
        : GoogleDriveProgressManager.#FAST_MS;

    this.#timer = setTimeout(() => {
      // A hidden tab is a tab nobody is reading. Skip the request and reschedule — the
      // visibilitychange listener below pulls a fresh value the moment it comes back.
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void this.refresh();
      }
      this.#schedule();
    }, interval);
  }

  #stop(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#quietPolls = 0;
    this.#lastPending = null;
  }
}

export const googleDriveProgressManager = new GoogleDriveProgressManager();

if (typeof document !== 'undefined') {
  // Returning to the tab should show current numbers immediately, not whatever was true when it
  // was hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void googleDriveProgressManager.refresh();
    }
  });
}
