/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { BoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, untrack } from "solid-js"
import { formatCompactTokens, formatContextBar, formatContextUsage, getContextTone, type ContextUsage } from "../context"
import { formatLiveTokenSpeed, type LiveTokenSpeed } from "../live"
import { formatTokenSpeed, getMessageTokenSpeed } from "../metrics"
import { startLiveRefresh } from "../refresh"
import { countOutputTokens } from "../tokenizer"
import { getV2ContextUsage, getV2LiveTokenSpeed, getV2SessionSnapshot } from "../v2-snapshot"

function contextColor(context: Plugin.Context, usage: ContextUsage) {
  switch (getContextTone(usage)) {
    case "warning": return context.theme.text.feedback.warning.base
    case "critical": return context.theme.text.feedback.error.base
    case "normal": return context.theme.text.base
    default: return context.theme.text.muted
  }
}

function readSnapshot(context: Plugin.Context, sessionID: string) {
  return getV2SessionSnapshot(
    sessionID, context.data.session.message.list(sessionID), context.data.session.status(sessionID),
    context.data.session.get(sessionID)?.revert?.messageID,
  )
}

function readModels(context: Plugin.Context, sessionID: string) {
  const location = context.data.session.get(sessionID)?.location ?? context.location ?? context.data.location.default()
  return context.data.location.model.list(location) ?? []
}

function ContextSidebar(props: { context: Plugin.Context; sessionID: string }) {
  const usage = createMemo(() => getV2ContextUsage(readSnapshot(props.context, props.sessionID), readModels(props.context, props.sessionID)))
  const cost = createMemo(() => props.context.data.session.cost(props.sessionID))
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
  return (
    <box flexDirection="column">
      <text fg={props.context.theme.text.base}><b>Contexto</b></text>
      <text fg={contextColor(props.context, usage())}>
        {formatContextBar(usage(), 12)} {usage().tokens?.toLocaleString("es-ES") ?? "—"} tokens
      </text>
      <text fg={props.context.theme.text.muted}>{money.format(cost())} gastados</text>
    </box>
  )
}

function SessionMetricsBar(props: { context: Plugin.Context; sessionID: string; signal: AbortSignal }) {
  const dimensions = useTerminalDimensions()
  const [assignedWidth, setAssignedWidth] = createSignal<number>()
  const snapshot = createMemo(() => readSnapshot(props.context, props.sessionID))
  const base = createMemo(() => getMessageTokenSpeed(snapshot().selected, snapshot().parts, snapshot().status))
  const usage = createMemo(() => getV2ContextUsage(snapshot(), readModels(props.context, props.sessionID)))
  const liveKey = createMemo(() => {
    const value = snapshot()
    return value.status === "busy" && base().state === "generating" && value.parts.some(part => part.type === "text" && (part.text?.length ?? 0) > 0)
      ? `${props.sessionID}/${value.selected?.id}` : undefined
  })
  const [live, setLive] = createSignal<LiveTokenSpeed | null>(null)
  createEffect(() => {
    const key = liveKey()
    setLive(null)
    if (!key) return
    const stop = startLiveRefresh(() => untrack(() => {
      if (liveKey() === key) setLive(getV2LiveTokenSpeed(snapshot(), Date.now(), countOutputTokens))
    }), props.signal)
    onCleanup(stop)
  })
  const label = createMemo(() => {
    const estimate = live()
    return liveKey() && estimate ? `${formatLiveTokenSpeed(estimate)} total` : formatTokenSpeed(base())
  })
  const layout = createMemo(() => {
    const available = Math.max(1, (assignedWidth() ?? dimensions().width) - 4)
    const speed = label()
    const full = formatContextUsage(usage())
    if (speed.length + full.length + 2 <= available) return { stacked: false, speed, context: [full] }
    const variants = [
      full, formatContextUsage(usage(), 12), formatContextUsage(usage(), 8), formatContextUsage(usage(), 4),
      ...[4, 3, 2, 1].map(cells => formatContextUsage(usage(), cells, "compact")),
    ]
    const fitted = variants.find(value => value.length <= available)
    return {
      stacked: true, speed,
      context: fitted === undefined
        ? [formatContextUsage(usage(), 1, "header"), `${formatCompactTokens(usage().tokens)} tk`] : [fitted],
    }
  })
  return (
    <box
      width="100%" maxWidth="100%" minWidth={0} flexShrink={0} overflow="hidden" paddingLeft={2} paddingRight={2}
      onSizeChange={function (this: BoxRenderable) { setAssignedWidth(this.width) }}
      height={layout().stacked ? layout().context.length + 1 : 1} flexDirection={layout().stacked ? "column" : "row"}
      justifyContent={layout().stacked ? "flex-start" : "space-between"} gap={layout().stacked ? 0 : 2}
    >
      <text fg={props.context.theme.text.muted} wrapMode="none" truncate>{layout().speed}</text>
      <For each={layout().context}>
        {(line) => <text fg={contextColor(props.context, usage())} wrapMode="none" truncate>{line}</text>}
      </For>
    </box>
  )
}

export default Plugin.define({
  id: "local.token-speed-v1",
  setup(context) {
    const controller = new AbortController()
    // Este slot también se monta en sesiones hijas: no hace falta duplicarlo en app.
    const stopMetrics = context.ui.slot({
      append: "session.composer.top",
      render: props => <SessionMetricsBar context={context} sessionID={props.sessionID} signal={controller.signal} />,
    })
    const stopSidebar = context.ui.slot({
      append: "sidebar.content",
      render: props => <ContextSidebar context={context} sessionID={props.sessionID} />,
    })
    return () => {
      controller.abort()
      stopSidebar()
      stopMetrics()
    }
  },
})
