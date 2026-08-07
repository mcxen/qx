//! Bounded background worker pool (Tokio-style keep-alive + auto-exit).
//!
//! Open-source pattern (Tokio blocking pool, rayon's parked workers):
//! - Cap concurrent OS threads.
//! - Spawn workers **on demand**.
//! - Workers **exit after idle** so thread count falls when work is done.
//! - Short delayed work shares **one** timer thread (not one thread per debounce).
//!
//! Prefer this over bare `std::thread::spawn` for fire-and-forget jobs. Long-lived
//! daemons (clipboard poll, display monitor, rdev) still use a single named thread.

use std::cmp::Ordering as CmpOrdering;
use std::collections::BinaryHeap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

/// Hard cap on concurrent pool workers (not counting the timer or daemon threads).
const MAX_WORKERS: usize = 8;
/// Worker exits if it sees no job for this long (mirrors Tokio keep-alive).
const IDLE_EXIT: Duration = Duration::from_secs(12);
/// Reject / drop excess fire-and-forget work rather than unbounded queue growth.
const MAX_QUEUE: usize = 96;
/// Concurrent media encode/transcode jobs (CPU + ffmpeg heavy).
const MAX_MEDIA_JOBS: usize = 2;

type Job = Box<dyn FnOnce() + Send + 'static>;

struct PoolInner {
    tx: Sender<Job>,
    rx: Mutex<Receiver<Job>>,
    live: AtomicUsize,
    queued: AtomicUsize,
    media_inflight: AtomicUsize,
}

static POOL: OnceLock<Arc<PoolInner>> = OnceLock::new();

fn pool() -> &'static Arc<PoolInner> {
    POOL.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        Arc::new(PoolInner {
            tx,
            rx: Mutex::new(rx),
            live: AtomicUsize::new(0),
            queued: AtomicUsize::new(0),
            media_inflight: AtomicUsize::new(0),
        })
    })
}

fn max_workers() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().clamp(2, MAX_WORKERS))
        .unwrap_or(4)
}

fn try_spawn_worker(inner: &Arc<PoolInner>) {
    let max = max_workers();
    let mut live = inner.live.load(Ordering::Relaxed);
    loop {
        if live >= max {
            return;
        }
        match inner
            .live
            .compare_exchange(live, live + 1, Ordering::SeqCst, Ordering::Relaxed)
        {
            Ok(_) => break,
            Err(current) => live = current,
        }
    }

    let worker = Arc::clone(inner);
    let id = live + 1;
    let _ = thread::Builder::new()
        .name(format!("qx-pool-{id}"))
        .spawn(move || worker_loop(worker));
}

fn worker_loop(inner: Arc<PoolInner>) {
    loop {
        let job = {
            let rx = match inner.rx.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            match rx.recv_timeout(IDLE_EXIT) {
                Ok(job) => {
                    inner.queued.fetch_sub(1, Ordering::Relaxed);
                    Some(job)
                }
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => {
                    inner.live.fetch_sub(1, Ordering::SeqCst);
                    return;
                }
            }
        };

        match job {
            Some(job) => {
                // Catch panics so one bad job does not kill the worker slot forever.
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
            }
            None => {
                // Idle timeout: exit so OS thread count shrinks when load drops.
                inner.live.fetch_sub(1, Ordering::SeqCst);
                return;
            }
        }
    }
}

/// Run `f` on the shared pool. Returns `false` if the queue is saturated.
pub fn try_spawn<F>(f: F) -> bool
where
    F: FnOnce() + Send + 'static,
{
    let inner = pool();
    if inner.queued.load(Ordering::Relaxed) >= MAX_QUEUE {
        crate::diagnostics::log(
            crate::diagnostics::LogLevel::Warn,
            "runtime.pool",
            "background pool queue full; dropping job",
            serde_json::json!({
                "queued": inner.queued.load(Ordering::Relaxed),
                "live": inner.live.load(Ordering::Relaxed),
                "max": max_workers(),
            }),
        );
        return false;
    }
    inner.queued.fetch_add(1, Ordering::Relaxed);
    if inner.tx.send(Box::new(f)).is_err() {
        inner.queued.fetch_sub(1, Ordering::Relaxed);
        return false;
    }
    try_spawn_worker(inner);
    true
}

/// Fire-and-forget on the pool (ignores saturation).
pub fn spawn<F>(f: F)
where
    F: FnOnce() + Send + 'static,
{
    let _ = try_spawn(f);
}

/// Media encode / ffmpeg work with a hard concurrency cap.
pub fn spawn_media<F>(f: F) -> bool
where
    F: FnOnce() + Send + 'static,
{
    let inner = pool();
    let mut inflight = inner.media_inflight.load(Ordering::Relaxed);
    loop {
        if inflight >= MAX_MEDIA_JOBS {
            crate::diagnostics::log(
                crate::diagnostics::LogLevel::Warn,
                "runtime.pool",
                "media job cap reached; rejecting new encode",
                serde_json::json!({ "inflight": inflight, "max": MAX_MEDIA_JOBS }),
            );
            return false;
        }
        match inner.media_inflight.compare_exchange(
            inflight,
            inflight + 1,
            Ordering::SeqCst,
            Ordering::Relaxed,
        ) {
            Ok(_) => break,
            Err(current) => inflight = current,
        }
    }
    let ok = try_spawn(move || {
        let _guard = MediaGuard;
        f();
    });
    if !ok {
        inner.media_inflight.fetch_sub(1, Ordering::SeqCst);
    }
    ok
}

struct MediaGuard;
impl Drop for MediaGuard {
    fn drop(&mut self) {
        pool().media_inflight.fetch_sub(1, Ordering::SeqCst);
    }
}

// ── Shared timer (one OS thread for all delayed jobs) ──────────────────────

struct TimedJob {
    at: Instant,
    job: Job,
}

impl PartialEq for TimedJob {
    fn eq(&self, other: &Self) -> bool {
        self.at == other.at
    }
}
impl Eq for TimedJob {}
impl PartialOrd for TimedJob {
    fn partial_cmp(&self, other: &Self) -> Option<CmpOrdering> {
        Some(self.cmp(other))
    }
}
impl Ord for TimedJob {
    fn cmp(&self, other: &Self) -> CmpOrdering {
        // Min-heap by time: reverse Instant order.
        other.at.cmp(&self.at)
    }
}

enum TimerMsg {
    Schedule(TimedJob),
}

static TIMER_TX: OnceLock<Sender<TimerMsg>> = OnceLock::new();

fn ensure_timer() -> &'static Sender<TimerMsg> {
    TIMER_TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<TimerMsg>();
        let _ = thread::Builder::new()
            .name("qx-pool-timer".into())
            .spawn(move || timer_loop(rx));
        tx
    })
}

fn timer_loop(rx: Receiver<TimerMsg>) {
    let mut heap: BinaryHeap<TimedJob> = BinaryHeap::new();
    loop {
        let next_wait = heap
            .peek()
            .map(|job| job.at.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_secs(3600));

        match rx.recv_timeout(next_wait.max(Duration::from_millis(1))) {
            Ok(TimerMsg::Schedule(job)) => heap.push(job),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }

        let now = Instant::now();
        while let Some(top) = heap.peek() {
            if top.at > now {
                break;
            }
            if let Some(job) = heap.pop() {
                // Run delayed work on the pool so the timer thread never blocks.
                let work = job.job;
                spawn(move || work());
            }
        }
    }
}

/// Schedule `f` after `delay` using the shared timer (does **not** spawn a new thread per call).
pub fn spawn_after<F>(delay: Duration, f: F)
where
    F: FnOnce() + Send + 'static,
{
    let tx = ensure_timer();
    let _ = tx.send(TimerMsg::Schedule(TimedJob {
        at: Instant::now() + delay,
        job: Box::new(f),
    }));
}

/// Snapshot for diagnostics / settings.
pub fn pool_stats() -> (usize, usize, usize) {
    let inner = pool();
    (
        inner.live.load(Ordering::Relaxed),
        inner.queued.load(Ordering::Relaxed),
        inner.media_inflight.load(Ordering::Relaxed),
    )
}
