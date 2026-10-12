type ScheduleRefresh = (update: () => void, delay: number) => () => void
const scheduleRefresh: ScheduleRefresh = (update, delay) => {
  const timer = setInterval(update, delay)
  return () => clearInterval(timer)
}

export function startLiveRefresh(
  update: () => void,
  signal: AbortSignal,
  schedule: ScheduleRefresh = scheduleRefresh,
): () => void {
  if (signal.aborted) return () => {}
  let active = true
  const tick = () => { if (active && !signal.aborted) update() }
  const cancel = schedule(tick, 500)
  const stop = () => {
    if (!active) return
    active = false
    cancel()
    signal.removeEventListener("abort", stop)
  }
  signal.addEventListener("abort", stop, { once: true })
  tick()
  return stop
}
