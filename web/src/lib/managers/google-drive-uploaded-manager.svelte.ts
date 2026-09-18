import { getMyGoogleDriveUploadedAssets } from '@immich/sdk';
import { SvelteSet } from 'svelte/reactivity';
import { eventManager } from '$lib/managers/event-manager.svelte';

/**
 * Which on-screen assets are already in the user's Google Drive, for the thumbnail badge.
 *
 * **Why a side lookup instead of a field on the timeline payload.** The timeline bucket query is
 * the hottest path in the app and is shared by photos, albums, memories, search and shared links.
 * Joining the upload ledger there would make every user pay for a feature most never enable. This
 * asks only for what is actually rendered, only when the feature is on, and the badge simply
 * appears a beat after the grid paints.
 *
 * **Why one module-level set.** Thumbnails are created in one place (Timeline) but the same asset
 * shows up on several pages; one shared answer means scrolling back to a photo, or opening it
 * from an album after the photos page, costs nothing.
 *
 * **Staleness.** Ids that came back uploaded are remembered for the session — an upload is never
 * un-done by this feature. Ids that came back *not* uploaded may be uploaded a minute later by the
 * background queue, so those are allowed to be asked again after `REASK_AFTER_MS`.
 */
const BATCH_SIZE = 1000; // Server cap (GOOGLE_DRIVE_UPLOADED_LOOKUP_MAX).
const DEBOUNCE_MS = 250;
const REASK_AFTER_MS = 60_000;

class GoogleDriveUploadedManager {
  constructor() {
    // Logging out is an SPA navigation here, not a page load, so a module singleton outlives the
    // session unless it clears itself — the same reason upload/memory/plugin/search managers all
    // subscribe to this. Without it the next user in the same tab sees "in my Drive" badges for
    // assets the *previous* user uploaded (shared albums make that reachable), and nothing can
    // correct it: lookups only ever add to this set, never remove.
    eventManager.on({ AuthLogout: () => this.reset() });
  }

  #uploaded = new SvelteSet<string>();
  /** asset id → when it was last asked about and came back not uploaded (or is in flight). */
  #askedAt = new Map<string, number>();
  #queue = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  has(assetId: string): boolean {
    return this.#uploaded.has(assetId);
  }

  /**
   * Queue ids for lookup; cheap to call on every render pass — known answers are skipped.
   *
   * Reading `#uploaded` here is a *reactive* read inside Timeline's effect (SvelteSet.has on a
   * missing key subscribes to the set's version), so every flush that adds something runs the
   * effect again. That is not a loop, but not for the reason the first version of this comment
   * claimed: the re-run simply finds nothing new to queue — ids now known are filtered here, ids
   * that came back absent are held by the re-ask window below, and a failed batch that re-queues
   * adds nothing to the set, so it cannot re-trigger itself.
   */
  request(assetIds: Iterable<string>, now = Date.now()) {
    for (const id of assetIds) {
      if (this.#uploaded.has(id) || this.#queue.has(id)) {
        continue;
      }
      const askedAt = this.#askedAt.get(id);
      if (askedAt !== undefined && now - askedAt < REASK_AFTER_MS) {
        continue;
      }
      this.#askedAt.set(id, now);
      this.#queue.add(id);
    }
    if (this.#queue.size > 0 && this.#timer === undefined) {
      this.#timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
    }
  }

  async flush() {
    this.#timer = undefined;
    const ids = [...this.#queue];
    this.#queue.clear();
    for (let start = 0; start < ids.length; start += BATCH_SIZE) {
      const batch = ids.slice(start, start + BATCH_SIZE);
      try {
        const { assetIds } = await getMyGoogleDriveUploadedAssets({
          googleDriveUploadedLookupDto: { assetIds: batch },
        });
        for (const id of assetIds) {
          this.#uploaded.add(id);
          this.#askedAt.delete(id);
        }
      } catch {
        // A badge is decoration; a failed lookup must not toast on every scroll. Forget that these
        // were asked so the next render pass tries again rather than showing "not uploaded" forever.
        for (const id of batch) {
          this.#askedAt.delete(id);
        }
      }
    }
  }

  /** Called on logout (see the constructor), on disconnect, and by tests. */
  reset() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#uploaded.clear();
    this.#askedAt.clear();
    this.#queue.clear();
  }
}

export const googleDriveUploadedManager = new GoogleDriveUploadedManager();
