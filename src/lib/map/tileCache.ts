/**
 * Lightweight in-memory tile cache for the Mission Map.
 *
 * Responsibilities:
 * - Cache loaded image tiles
 * - Prevent duplicate requests
 * - Track loading / failed states
 * - Retry failed requests
 * - Limit cache size
 * - Allow explicit cache clearing
 *
 * The cache is intentionally independent of React.
 */

import type {
  TileCoordinate,
  TileProvider,
} from "./tiles";

import {
  tileKeyFromCoordinate,
  tileUrl,
  OPEN_STREET_MAP_PROVIDER,
} from "./tiles";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type TileStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "error";

export interface TileCacheEntry {
  key: string;

  tile: TileCoordinate;

  status: TileStatus;

  image: HTMLImageElement | null;

  error: Error | null;

  /**
   * Timestamp of the most recent access.
   */
  lastAccessed: number;

  /**
   * Timestamp when the tile finished loading.
   */
  loadedAt: number | null;

  /**
   * Number of load attempts.
   */
  attempts: number;
}

export interface TileLoadOptions {
  provider?: TileProvider;

  /**
   * Maximum number of attempts before the tile is considered
   * permanently failed for this cache instance.
   */
  maxRetries?: number;

  /**
   * Optional request timeout.
   *
   * Unit: milliseconds.
   */
  timeoutMs?: number;

  /**
   * Cross-origin image policy.
   */
  crossOrigin?: "" | "anonymous" | "use-credentials";
}

export interface TileCacheOptions {
  /**
   * Maximum number of completed image tiles retained.
   */
  maxEntries?: number;

  /**
   * Number of simultaneous tile downloads.
   */
  maxConcurrent?: number;

  /**
   * Time after which a failed tile may be retried.
   *
   * Unit: milliseconds.
   */
  errorRetryAfterMs?: number;
}

export interface TileLoadResult {
  key: string;

  tile: TileCoordinate;

  image: HTMLImageElement;

  fromCache: boolean;
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_MAX_ENTRIES = 256;

const DEFAULT_MAX_CONCURRENT = 6;

const DEFAULT_ERROR_RETRY_AFTER_MS =
  10_000;

const DEFAULT_MAX_RETRIES = 2;

const DEFAULT_TIMEOUT_MS = 15_000;

/* -------------------------------------------------------------------------- */
/* TileCache                                                                  */
/* -------------------------------------------------------------------------- */

export class TileCache {
  private readonly entries =
    new Map<string, TileCacheEntry>();

  private readonly pending =
    new Map<
      string,
      Promise<TileLoadResult>
    >();

  private readonly queue: Array<{
    tile: TileCoordinate;
    options: TileLoadOptions;
    resolve: (
      result: TileLoadResult,
    ) => void;
    reject: (error: Error) => void;
  }> = [];

  private readonly maxEntries: number;

  private readonly maxConcurrent: number;

  private readonly errorRetryAfterMs: number;

  private activeLoads = 0;

  public constructor(
    options: TileCacheOptions = {},
  ) {
    this.maxEntries =
      Math.max(
        1,
        Math.floor(
          options.maxEntries ??
            DEFAULT_MAX_ENTRIES,
        ),
      );

    this.maxConcurrent =
      Math.max(
        1,
        Math.floor(
          options.maxConcurrent ??
            DEFAULT_MAX_CONCURRENT,
        ),
      );

    this.errorRetryAfterMs =
      Math.max(
        0,
        options.errorRetryAfterMs ??
          DEFAULT_ERROR_RETRY_AFTER_MS,
      );
  }

  /* ------------------------------------------------------------------------ */
  /* Public inspection                                                        */
  /* ------------------------------------------------------------------------ */

  public get(
    tile: TileCoordinate,
  ): TileCacheEntry | undefined {
    const key =
      tileKeyFromCoordinate(tile);

    const entry =
      this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    entry.lastAccessed =
      Date.now();

    return entry;
  }

  public has(
    tile: TileCoordinate,
  ): boolean {
    return this.entries.has(
      tileKeyFromCoordinate(tile),
    );
  }

  public status(
    tile: TileCoordinate,
  ): TileStatus {
    return (
      this.get(tile)?.status ??
      "idle"
    );
  }

  public size(): number {
    return this.entries.size;
  }

  public loadingCount(): number {
    return this.activeLoads;
  }

  public pendingCount(): number {
    return this.pending.size;
  }

  /* ------------------------------------------------------------------------ */
  /* Load                                                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * Load a tile.
   *
   * If the tile is already loaded, the cached image is returned.
   *
   * If another request for the same tile is already running,
   * the existing promise is reused instead of starting another
   * network request.
   */
  public load(
    tile: TileCoordinate,
    options: TileLoadOptions = {},
  ): Promise<TileLoadResult> {
    const key =
      tileKeyFromCoordinate(tile);

    const existing =
      this.entries.get(key);

    if (
      existing?.status ===
        "loaded" &&
      existing.image
    ) {
      existing.lastAccessed =
        Date.now();

      return Promise.resolve({
        key,
        tile,
        image: existing.image,
        fromCache: true,
      });
    }

    const pendingRequest =
      this.pending.get(key);

    if (pendingRequest) {
      return pendingRequest;
    }

    if (
      existing?.status ===
        "error"
    ) {
      const lastAccess =
        existing.lastAccessed;

      const elapsed =
        Date.now() -
        lastAccess;

      if (
        elapsed <
        this.errorRetryAfterMs
      ) {
        return Promise.reject(
          existing.error ??
            new Error(
              `Tile ${key} previously failed to load.`,
            ),
        );
      }
    }

    const request =
      new Promise<TileLoadResult>(
        (resolve, reject) => {
          this.queue.push({
            tile,
            options,
            resolve,
            reject,
          });

          this.processQueue();
        },
      );

    this.pending.set(
      key,
      request,
    );

    request.finally(() => {
      this.pending.delete(key);
    }).catch(() => {
      /**
       * The original promise already carries the rejection.
       * This catch prevents the finally-chain from producing
       * an unhandled rejection.
       */
    });

    return request;
  }

  /* ------------------------------------------------------------------------ */
  /* Queue                                                                     */
  /* ------------------------------------------------------------------------ */

  private processQueue(): void {
    while (
      this.activeLoads <
        this.maxConcurrent &&
      this.queue.length > 0
    ) {
      const request =
        this.queue.shift();

      if (!request) {
        return;
      }

      this.activeLoads += 1;

      this.executeLoad(
        request,
      )
        .catch(() => {
          /**
           * executeLoad settles the original promise.
           */
        })
        .finally(() => {
          this.activeLoads -= 1;
          this.processQueue();
        });
    }
  }

  private async executeLoad(
    request: {
      tile: TileCoordinate;
      options: TileLoadOptions;
      resolve: (
        result: TileLoadResult,
      ) => void;
      reject: (error: Error) => void;
    },
  ): Promise<void> {
    const {
      tile,
      options,
      resolve,
      reject,
    } = request;

    const key =
      tileKeyFromCoordinate(tile);

    const provider =
      options.provider ??
      OPEN_STREET_MAP_PROVIDER;

    const maxRetries =
      Math.max(
        0,
        Math.floor(
          options.maxRetries ??
            DEFAULT_MAX_RETRIES,
        ),
      );

    const timeoutMs =
      Math.max(
        1,
        options.timeoutMs ??
          DEFAULT_TIMEOUT_MS,
      );

    const crossOrigin =
      options.crossOrigin ??
      "anonymous";

    let attempts = 0;

    this.setEntry({
      key,
      tile,
      status: "loading",
      image: null,
      error: null,
      lastAccessed: Date.now(),
      loadedAt: null,
      attempts: 0,
    });

    while (
      attempts <= maxRetries
    ) {
      attempts += 1;

      this.updateAttempts(
        key,
        attempts,
      );

      try {
        const image =
          await this.loadImage(
            tileUrl(
              tile,
              provider,
            ),
            timeoutMs,
            crossOrigin,
          );

        const now =
          Date.now();

        this.setEntry({
          key,
          tile,
          status: "loaded",
          image,
          error: null,
          lastAccessed: now,
          loadedAt: now,
          attempts,
        });

        this.enforceLimit();

        resolve({
          key,
          tile,
          image,
          fromCache: false,
        });

        return;
      } catch (cause) {
        const error =
          cause instanceof Error
            ? cause
            : new Error(
                String(cause),
              );

        if (
          attempts >
          maxRetries
        ) {
          this.setEntry({
            key,
            tile,
            status: "error",
            image: null,
            error,
            lastAccessed:
              Date.now(),
            loadedAt: null,
            attempts,
          });

          reject(error);

          return;
        }

        await this.retryDelay(
          attempts,
        );
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Image loading                                                             */
  /* ------------------------------------------------------------------------ */

  private loadImage(
    url: string,
    timeoutMs: number,
    crossOrigin:
      | ""
      | "anonymous"
      | "use-credentials",
  ): Promise<HTMLImageElement> {
    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

        let settled =
          false;

        const timeout =
          window.setTimeout(() => {
            if (settled) {
              return;
            }

            settled = true;

            image.onload =
              null;

            image.onerror =
              null;

            reject(
              new Error(
                `Tile request timed out after ${timeoutMs}ms: ${url}`,
              ),
            );
          }, timeoutMs);

        image.crossOrigin =
          crossOrigin;

        image.onload = () => {
          if (settled) {
            return;
          }

          settled = true;

          window.clearTimeout(
            timeout,
          );

          image.onload =
            null;

          image.onerror =
            null;

          resolve(image);
        };

        image.onerror = () => {
          if (settled) {
            return;
          }

          settled = true;

          window.clearTimeout(
            timeout,
          );

          image.onload =
            null;

          image.onerror =
            null;

          reject(
            new Error(
              `Failed to load map tile: ${url}`,
            ),
          );
        };

        image.src = url;
      },
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Retry                                                                     */
  /* ------------------------------------------------------------------------ */

  private retryDelay(
    attempt: number,
  ): Promise<void> {
    /**
     * Small exponential backoff.
     *
     * Attempt 1 → 250ms
     * Attempt 2 → 500ms
     * Attempt 3 → 1000ms
     */
    const delay =
      Math.min(
        1_000,
        250 *
          2 ** (attempt - 1),
      );

    return new Promise(
      (resolve) => {
        window.setTimeout(
          resolve,
          delay,
        );
      },
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Cache mutation                                                            */
  /* ------------------------------------------------------------------------ */

  private setEntry(
    entry: TileCacheEntry,
  ): void {
    this.entries.set(
      entry.key,
      entry,
    );
  }

  private updateAttempts(
    key: string,
    attempts: number,
  ): void {
    const entry =
      this.entries.get(key);

    if (!entry) {
      return;
    }

    entry.attempts =
      attempts;

    entry.lastAccessed =
      Date.now();
  }

  /**
   * Remove least-recently-used completed tiles.
   *
   * Loading tiles are never evicted.
   */
  private enforceLimit(): void {
    if (
      this.entries.size <=
      this.maxEntries
    ) {
      return;
    }

    const candidates =
      Array.from(
        this.entries.values(),
      )
        .filter(
          (entry) =>
            entry.status !==
            "loading",
        )
        .sort(
          (a, b) =>
            a.lastAccessed -
            b.lastAccessed,
        );

    while (
      this.entries.size >
        this.maxEntries &&
      candidates.length > 0
    ) {
      const oldest =
        candidates.shift();

      if (!oldest) {
        break;
      }

      this.entries.delete(
        oldest.key,
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Explicit cache control                                                    */
  /* ------------------------------------------------------------------------ */

  public remove(
    tile: TileCoordinate,
  ): boolean {
    const key =
      tileKeyFromCoordinate(tile);

    return this.entries.delete(
      key,
    );
  }

  public clear(): void {
    this.entries.clear();
  }

  public clearErrors(): void {
    for (
      const [
        key,
        entry,
      ] of this.entries
    ) {
      if (
        entry.status ===
        "error"
      ) {
        this.entries.delete(
          key,
        );
      }
    }
  }

  /**
   * Remove tiles that have not been accessed within the
   * supplied age.
   *
   * Unit: milliseconds.
   */
  public pruneOlderThan(
    ageMs: number,
  ): number {
    const cutoff =
      Date.now() -
      Math.max(
        0,
        ageMs,
      );

    let removed = 0;

    for (
      const [
        key,
        entry,
      ] of this.entries
    ) {
      if (
        entry.status ===
          "loading"
      ) {
        continue;
      }

      if (
        entry.lastAccessed <
        cutoff
      ) {
        this.entries.delete(
          key,
        );

        removed += 1;
      }
    }

    return removed;
  }
}

/* -------------------------------------------------------------------------- */
/* Default singleton                                                          */
/* -------------------------------------------------------------------------- */

export const missionTileCache =
  new TileCache({
    maxEntries: 256,
    maxConcurrent: 6,
    errorRetryAfterMs:
      10_000,
  });