/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { BoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import { formatTokenSpeed, getTokenSpeed, selectTokenSpeedMessage } from "./metrics"
import { formatCompactTokens, formatContextBar, formatContextUsage, getContextTone, getContextUsage, type ContextUsage } from "./context"
import { formatLiveTokenSpeed, getLiveTokenSpeed, type LiveTokenSpeed } from "./live"
import { countOutputTokens } from "./tokenizer"
import { startLiveRefresh } from "./refresh"

function contextColor(api: TuiPluginApi, context: ContextUsage) {
  const theme = api.theme.current
  switch (getContextTone(context)) {
    case "normal": return theme.primary
    case "warning": return theme.warning
    case "critical": return theme.error
    default: return theme.textMuted
  }
}

function ContextSidebar(props: { api: TuiPluginApi; sessionID: string }) {
  const usage = createMemo(() => getContextUsage(props.sessionID, props.api.state.session.messages(props.sessionID), props.api.state.provider))
  const cost = createMemo(() => props.api.state.session.get(props.sessionID)?.cost ?? 0)
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
  return (
    <box flexDirection="column">
      <text fg={props.api.theme.current.text}><b>Context</b></text>
      <text fg={contextColor(props.api, usage())}>
        {formatContextBar(usage(), 12)} {usage().tokens?.toLocaleString("es-ES") ?? "—"} tokens
      </text>
      <text fg={props.api.theme.current.textMuted}>{money.format(cost())} spent</text>
    </box>
  )
}

function SubagentMetrics(props: { api: TuiPluginApi }) {
  const child = createMemo(() => {
    const route = props.api.route.current
    const id = route.name === "session" && "params" in route ? route.params?.sessionID : undefined
    return typeof id === "string" && Boolean(props.api.state.session.get(id)?.parentID)
  })
  return <Show when={child()}><SessionMetricsBar api={props.api} /></Show>
}

function SessionMetricsBar(props: { api: TuiPluginApi; sessionID?: string }) {
  const dimensions = useTerminalDimensions()
  const [assignedWidth, setAssignedWidth] = createSignal<number>()
  const sessionID = createMemo(() => {
    if (props.sessionID !== undefined) return props.sessionID
    const route = props.api.route.current
    const id = route.name === "session" && "params" in route ? route.params?.sessionID : undefined
    return typeof id === "string" ? id : undefined
  })
  const messages = createMemo(() => {
    const id = sessionID()
    return id === undefined ? [] : props.api.state.session.messages(id)
  })
  const status = createMemo(() => {
    const id = sessionID()
    return id === undefined ? undefined : props.api.state.session.status(id)?.type
  })
  const base = createMemo(() => {
    const id = sessionID()
    if (id === undefined) return { state: "unavailable" } as const
    return getTokenSpeed(
      id,
      messages(),
      (messageID) => props.api.state.part(messageID),
      status(),
    )
  })
  const selected = createMemo(() => {
    const id = sessionID()
    return id === undefined ? undefined : selectTokenSpeedMessage(id, messages())
  })
  const liveKey = createMemo(() => {
    const message = selected()
    if (!message || base().state !== "generating" || status() !== "busy") return undefined
    const open = props.api.state.part(message.id).some((part) =>
      part.sessionID === message.sessionID && part.messageID === message.id && part.type === "text" &&
      !part.synthetic && !part.ignored && part.time?.end === undefined && part.text.length > 0,
    )
    return open ? `${message.sessionID}/${message.id}` : undefined
  })
  const [live, setLive] = createSignal<LiveTokenSpeed | null>(null)
  createEffect(() => {
    const key = liveKey()
    setLive(null)
    if (!key) return
    const signal = props.api.lifecycle.signal
    const stop = startLiveRefresh(() => untrack(() => {
      if (liveKey() !== key) return
      const message = selected()
      setLive(getLiveTokenSpeed(message, message ? props.api.state.part(message.id) : [], Date.now(), countOutputTokens, status()))
    }), signal)
    const abort = () => setLive(null)
    signal.addEventListener("abort", abort, { once: true })
    onCleanup(() => {
      stop()
      signal.removeEventListener("abort", abort)
    })
  })
  const label = createMemo(() => {
    const estimate = live()
    return liveKey() && estimate ? formatLiveTokenSpeed(estimate) : formatTokenSpeed(base())
  })
  const context = createMemo(() => getContextUsage(sessionID(), messages(), props.api.state.provider))
  const layout = createMemo(() => {
    const width = props.sessionID === undefined ? dimensions().width : assignedWidth() ?? Math.min(80, dimensions().width)
    const available = Math.max(1, width - 4)
    const speed = label()
    const full = formatContextUsage(context())
    if (speed.length + full.length + 2 <= available) return { stacked: false, speed, context: [full] }
    const variants = [
      full, formatContextUsage(context(), 12), formatContextUsage(context(), 8), formatContextUsage(context(), 4),
      ...[4, 3, 2, 1].map((cells) => formatContextUsage(context(), cells, "compact")),
    ]
    const fitted = variants.find((value) => value.length <= available)
    return {
      stacked: true,
      speed: speed.length <= available ? speed : label(),
      context: fitted === undefined
        ? [formatContextUsage(context(), 1, "header"), `${formatCompactTokens(context().tokens)} tk`]
        : [fitted],
    }
  })
  return (
    <box
      width={props.sessionID === undefined ? "100%" : 80} maxWidth="100%"
      flexShrink={props.sessionID === undefined ? 0 : 1} minWidth={0} overflow="hidden" paddingLeft={2} paddingRight={2}
      onSizeChange={function (this: BoxRenderable) { setAssignedWidth(this.width) }}
      height={layout().stacked ? layout().context.length + 1 : 1} flexDirection={layout().stacked ? "column" : "row"}
      justifyContent={layout().stacked ? "flex-start" : "space-between"} gap={layout().stacked ? 0 : 2}
    >
      <text fg={props.api.theme.current.textMuted} wrapMode="none" truncate>{layout().speed}</text>
      <For each={layout().context}>
        {(line) => <text fg={contextColor(props.api, context())} wrapMode="none" truncate>{line}</text>}
      </For>
    </box>
  )
}

export default {
  id: "local.token-speed-v1",
  async tui(api) {
    // La desactivación pública respeta también overrides persistidos por el gestor de plugins.
    await api.plugins.deactivate("internal:sidebar-context")
    api.slots.register({
      order: 100,
      slots: {
        app_bottom() {
          return <SubagentMetrics api={api} />
        },
        session_prompt_right(_ctx, props) {
          return <SessionMetricsBar api={api} sessionID={props.session_id} />
        },
        sidebar_content(_ctx, props) {
          return <ContextSidebar api={api} sessionID={props.session_id} />
        },
      },
    })
  },
} satisfies TuiPluginModule
