/** Upload limits shared by the SSE turn server (api/chat) and the composer. */
export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** First SSE frame guard: if the daemon accepts the prompt but produces no
 * update within this window, the turn is likely held by another driver. */
export const FIRST_UPDATE_TIMEOUT_MS = 20_000;