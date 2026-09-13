import { submitLog } from './submit.js';

// A durable queue of captures waiting to be logged.
//
// Rate limits used to lose work: the capture was discarded and the user had to find
// the page and scrape it again. Queuing keeps the payload so a retry costs nothing.
//
// Stored in chrome.storage.local rather than memory because the MV3 service worker is
// torn down between events — anything held in a variable is gone within ~30 seconds.

const QUEUE_KEY = 'logQueue';

// Each capture carries a base64 screenshot (~150-400KB), and storage.local allows
// about 10MB. This keeps the queue well inside that with room to spare.
export const MAX_QUEUE = 20;

export async function getQueue() {
  const { [QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(QUEUE_KEY);
  return queue;
}

export async function queueSize() {
  return (await getQueue()).length;
}

/**
 * Adds a capture to the back of the queue.
 * @returns {{queued: boolean, size: number, reason?: string}}
 */
export async function enqueue(item) {
  const queue = await getQueue();

  if (queue.length >= MAX_QUEUE) {
    return { queued: false, size: queue.length, reason: `Queue is full (${MAX_QUEUE}).` };
  }

  // Same page already waiting? Replace it rather than logging it twice.
  const duplicate = queue.findIndex((q) => q.capture.sourceUrl === item.capture.sourceUrl);
  if (duplicate !== -1) {
    queue[duplicate] = { ...item, id: queue[duplicate].id, queuedAt: queue[duplicate].queuedAt };
    await chrome.storage.local.set({ [QUEUE_KEY]: queue });
    return { queued: true, size: queue.length, reason: 'replaced an earlier capture of this page' };
  }

  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: Date.now(),
    attempts: 0,
    ...item
  });
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  return { queued: true, size: queue.length };
}

export async function peek() {
  return (await getQueue())[0] || null;
}

/** Removes the head of the queue. */
export async function shift() {
  const queue = await getQueue();
  queue.shift();
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  return queue.length;
}

/** Records a failed attempt against the head without removing it. */
export async function bumpAttempts() {
  const queue = await getQueue();
  if (queue[0]) {
    queue[0].attempts = (queue[0].attempts || 0) + 1;
    await chrome.storage.local.set({ [QUEUE_KEY]: queue });
    return queue[0].attempts;
  }
  return 0;
}

export async function clearQueue() {
  await chrome.storage.local.remove(QUEUE_KEY);
}

// --- Scheduling and the shared logging entry point ---------------------------------

export const DRAIN_ALARM = 'drain-queue';
const BADGE_QUEUED = '#6b6358'; // matches --text-secondary in styles/theme.css
// Chrome will not schedule an alarm sooner than this, so a shorter server hint is
// rounded up rather than silently ignored.
export const MIN_ALARM_SECONDS = 30;

/** Badge shows how many captures are still waiting. */
export async function showQueueBadge() {
  const size = await queueSize();
  await chrome.action.setBadgeText({ text: size ? String(size) : '' });
  if (size) await chrome.action.setBadgeBackgroundColor({ color: BADGE_QUEUED });
}

/** Schedules the next drain. Alarms survive the service worker being torn down. */
export async function scheduleDrain(seconds) {
  const delay = Math.max(seconds || MIN_ALARM_SECONDS, MIN_ALARM_SECONDS);
  await chrome.alarms.create(DRAIN_ALARM, { delayInMinutes: delay / 60 });
  console.info(`[Genealogy Logger] next queue attempt in ~${Math.round(delay)}s`);
}

/**
 * Logs a capture, queueing it instead of discarding it when the failure is transient.
 * Shared by the context menu here and the popup.
 */
export async function logOrQueue({ capture, notes, familyLine }) {
  try {
    const result = await submitLog({ capture, notes, familyLine });
    return { status: 'logged', result };
  } catch (err) {
    if (!err.retryable) throw err;

    const queued = await enqueue({ capture, notes, familyLine });
    if (!queued.queued) throw err;

    await scheduleDrain(err.retryAfter);
    await showQueueBadge();
    return { status: 'queued', size: queued.size, retryAfter: err.retryAfter, message: err.message };
  }
}

