import { Message, Model, Part, Session, SessionStatus, SnapshotFileDiff, UserMessage } from "@opencode-ai/sdk/v2"
import { SessionTurn } from "@opencode-ai/session-ui/session-turn"
import { SessionReview } from "@opencode-ai/session-ui/session-review"
import { DataProvider } from "@opencode-ai/session-ui/context"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { WorkerPoolProvider } from "@opencode-ai/ui/context/worker-pool"
import { createAsync, query, useParams } from "@solidjs/router"
import { createMemo, createSignal, ErrorBoundary, For, Match, Show, Switch } from "solid-js"
import { publicShare } from "~/deskfox/public-share" // FORK: local atomic repository 2026-10-12
import { Logo, Mark } from "@opencode-ai/branding/logo" // FORK: share site identity 2026-10-12
import { shareBrand } from "@opencode-ai/branding/share"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { iife } from "@opencode-ai/core/util/iife"
import { Binary } from "@opencode-ai/core/util/binary"
import { NamedError } from "@opencode-ai/core/util/error"
import { DateTime } from "luxon"
import { createStore } from "solid-js/store"
import NotFound from "~/deskfox/not-found" // FORK: public missing/revoked share page 2026-10-12
import { Tabs } from "@opencode-ai/ui/tabs"
import { MessageNav } from "@opencode-ai/session-ui/message-nav"
import { FileSSR } from "@opencode-ai/session-ui/file-ssr"
import { clientOnly } from "@solidjs/start"
import { Meta, Title } from "@solidjs/meta"
import { getRequestEvent } from "solid-js/web"

const ClientOnlyWorkerPoolProvider = clientOnly(() =>
  import("@opencode-ai/session-ui/pierre/worker").then((m) => ({
    default: (props: { children: any }) => (
      <WorkerPoolProvider pools={m.getWorkerPools()}>{props.children}</WorkerPoolProvider>
    ),
  })),
)

class SessionDataMissingError extends NamedError {
  public override readonly name = "SessionDataMissingError"

  constructor(
    public readonly data: { sessionID: string; message?: string },
    options?: ErrorOptions,
  ) {
    super("SessionDataMissingError", options)
  }

  static isInstance(input: unknown): input is SessionDataMissingError {
    return NamedError.hasName(input, "SessionDataMissingError")
  }

  schema(): never {
    throw new Error("SessionDataMissingError does not expose a schema")
  }

  toObject() {
    return { name: this.name, data: this.data }
  }
}

const getData = query(async (shareID) => {
  "use server"
  getRequestEvent()?.response.headers.set("Cache-Control", "no-store") // FORK: no cached RPC snapshots 2026-10-12
  const share = await publicShare.get(shareID)
  if (!share) {
    const event = getRequestEvent()
    if (event) {
      event.response.status = 404
      // FORK: SolidStart drops the RPC status when wrapping its serialized stream.
      event.response.headers.set("X-DeskFox-Share-Missing", "1")
    }
    throw new SessionDataMissingError({ sessionID: shareID })
  }
  const data = await publicShare.data(shareID)
  const result: {
    sessionID: string
    shareID: string
    session: Session[]
    session_diff: {
      [sessionID: string]: SnapshotFileDiff[]
    }
    session_status: {
      [sessionID: string]: SessionStatus
    }
    message: {
      [sessionID: string]: Message[]
    }
    part: {
      [messageID: string]: Part[]
    }
    model: {
      [sessionID: string]: Model[]
    }
  } = {
    sessionID: share.sessionID,
    shareID,
    session: [],
    session_diff: {
      [share.sessionID]: [],
    },
    session_status: {
      [share.sessionID]: {
        type: "idle",
      },
    },
    message: {},
    part: {},
    model: {},
  }
  for (const item of data) {
    switch (item.type) {
      case "session":
        result.session.push(item.data)
        break
      case "session_diff":
        result.session_diff[share.sessionID] = item.data
        break
      case "message":
        result.message[item.data.sessionID] = result.message[item.data.sessionID] ?? []
        result.message[item.data.sessionID].push(item.data)
        break
      case "part":
        result.part[item.data.messageID] = result.part[item.data.messageID] ?? []
        result.part[item.data.messageID].push(item.data)
        break
      case "model":
        result.model[share.sessionID] = item.data
        break
    }
  }
  const match = Binary.search(result.session, share.sessionID, (s) => s.id)
  if (!match.found) throw new SessionDataMissingError({ sessionID: share.sessionID })
  return result
}, "getShareData")

export default function () {
  getRequestEvent()?.response.headers.set(
    "Cache-Control",
    "no-store", // FORK: revocation must not serve stale snapshots 2026-10-12
  )

  const params = useParams()
  const data = createAsync(async () => {
    if (!params.shareID) throw new Error("Missing shareID")
    return getData(params.shareID)
  })

  return (
    <ErrorBoundary
      fallback={(error) => {
        if (SessionDataMissingError.isInstance(error)) {
          return <NotFound />
        }
        console.error("Share rendering failed") // FORK: do not expose server paths or payload errors 2026-10-12
        return (
          <div class="min-h-screen w-full bg-background-base text-text-base flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p class="text-16-medium">Unable to render this share.</p>
          </div>
        )
      }}
    >
      <Meta name="robots" content="noindex, nofollow" />
      <Show when={data()}>
        {(data) => {
          const match = createMemo(() => Binary.search(data().session, data().sessionID, (s) => s.id))
          if (!match().found) throw new Error(`Session ${data().sessionID} not found`)
          const info = createMemo(() => data().session[match().index])
          const ogImage = () => shareBrand.image // FORK: same-origin card, no session titles sent to third parties 2026-10-12

          return (
            <>
              <Show when={info().title}>
                <Title>
                  {info().title} | {shareBrand.name}
                </Title>
              </Show>
              <Meta name="description" content={shareBrand.description} />
              <Meta property="og:image" content={ogImage()} />
              <Meta name="twitter:image" content={ogImage()} />
              <ClientOnlyWorkerPoolProvider>
                <FileComponentProvider component={FileSSR}>
                  <DataProvider data={data()} directory={info().directory}>
                    {iife(() => {
                      const [store, setStore] = createStore({
                        messageId: undefined as string | undefined,
                      })
                      const messages = createMemo(() =>
                        data().sessionID
                          ? (data().message[data().sessionID]?.filter((m) => m.role === "user") ?? []).sort(
                              (a, b) => a.time.created - b.time.created,
                            )
                          : [],
                      )
                      const firstUserMessage = createMemo(() => messages().at(0))
                      const activeMessage = createMemo(
                        () => messages().find((m) => m.id === store.messageId) ?? firstUserMessage(),
                      )
                      function setActiveMessage(message: UserMessage | undefined) {
                        if (message) {
                          setStore("messageId", message.id)
                        } else {
                          setStore("messageId", undefined)
                        }
                      }
                      const provider = createMemo(() => activeMessage()?.model?.providerID)
                      const modelID = createMemo(() => activeMessage()?.model?.modelID)
                      const model = createMemo(() => data().model[data().sessionID]?.find((m) => m.id === modelID()))
                      const diffs = createMemo(() => data().session_diff[data().sessionID] ?? [])
                      const [diffStyle, setDiffStyle] = createSignal<"unified" | "split">("unified")

                      // FORK: keep the pinned share header compact; wrap metadata instead of reserving empty height.
                      const title = () => (
                        <div class="flex min-w-0 w-full flex-col gap-1">
                          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 justify-start self-stretch">
                            <div class="pl-[2.5px] pr-2 flex items-center gap-1.75 bg-surface-strong shadow-xs-border-base w-fit shrink-0">
                              <Mark class="shrink-0 w-3 my-0.5" />
                              <div class="text-12-mono text-text-base">v{info().version}</div>
                            </div>
                            <div class="flex min-w-0 max-w-full gap-2 items-center">
                              <Show when={provider()}>
                                <ProviderIcon id={provider()!} class="size-3.5 shrink-0 text-icon-strong-base" />
                              </Show>
                              <div class="text-12-regular text-text-base wrap-anywhere min-w-0">
                                {model()?.name ?? modelID()}
                              </div>
                            </div>
                            <div class="text-12-regular text-text-weaker whitespace-nowrap shrink-0">
                              {DateTime.fromMillis(info().time.created).toFormat("dd MMM yyyy, HH:mm")}
                            </div>
                          </div>
                          <div class="text-left text-16-medium text-text-strong wrap-anywhere">{info().title}</div>
                        </div>
                      )

                      const turns = () => (
                        <div class="relative pb-8 min-w-0 w-full h-full overflow-y-auto no-scrollbar">
                          <div class="px-4 py-3">{title()}</div>
                          <div class="flex flex-col gap-15 items-start justify-start">
                            <For each={messages()}>
                              {(message) => (
                                <SessionTurn
                                  sessionID={data().sessionID}
                                  messageID={message.id}
                                  classes={{
                                    root: "min-w-0 w-full relative",
                                    content: "flex flex-col justify-between !overflow-visible",
                                    container: "px-4",
                                  }}
                                />
                              )}
                            </For>
                          </div>
                          <div class="px-4 flex items-center justify-center pt-20 pb-8 shrink-0">
                            <Logo class="w-58.5 opacity-12" />
                          </div>
                        </div>
                      )

                      const wide = createMemo(() => diffs().length === 0)

                      return (
                        <div class="relative bg-background-stronger w-screen h-screen overflow-hidden flex flex-col">
                          <header class="h-8 shrink-0 px-4 sm:px-6 flex items-center justify-between self-stretch bg-background-base border-b border-border-weak-base">
                            <div class="">
                              <a href={shareBrand.home}>
                                <Mark />
                              </a>
                            </div>
                            {/* FORK: public site navigation stays on its regional DeskFox site. */}
                            <a href={shareBrand.home}>{shareBrand.name}</a>
                          </header>
                          <div class="select-text flex flex-col flex-1 min-h-0">
                            <div
                              classList={{
                                "hidden w-full flex-1 min-h-0": true,
                                "md:flex": wide(),
                                "lg:flex": !wide(),
                              }}
                            >
                              <div
                                classList={{
                                  // FORK: leave room for the review pane; w-full + shrink-0 pushed it outside the viewport.
                                  "@container relative pt-3 flex flex-col gap-3 min-h-0 min-w-0": true,
                                  "w-full": wide(),
                                  "w-1/2 shrink-0": !wide(),
                                }}
                              >
                                <div
                                  classList={{
                                    "w-full shrink-0 flex justify-start items-start min-w-0 px-6": true,
                                  }}
                                >
                                  {title()}
                                </div>
                                <div class="flex items-start justify-start h-full min-h-0">
                                  <Show when={messages().length > 1}>
                                    <MessageNav
                                      class="sticky top-0 shrink-0 py-2 pl-4"
                                      messages={messages()}
                                      current={activeMessage()}
                                      size="compact"
                                      onMessageSelect={setActiveMessage}
                                      getLabel={(message) =>
                                        data()
                                          .part[message.id]?.find((part) => part.type === "text")
                                          ?.text.trim()
                                          .split("\n")[0]
                                      }
                                    />
                                  </Show>
                                  <SessionTurn
                                    sessionID={data().sessionID}
                                    messageID={store.messageId ?? firstUserMessage()!.id!}
                                    classes={{
                                      root: "grow",
                                      content: "flex flex-col justify-between",
                                      container: "w-full pb-20 px-6",
                                    }}
                                  >
                                    <div classList={{ "w-full flex items-center justify-center pb-8 shrink-0": true }}>
                                      <Logo class="w-58.5 opacity-12" />
                                    </div>
                                  </SessionTurn>
                                </div>
                              </div>
                              <Show when={diffs().length > 0}>
                                <div class="@container relative pt-3 flex-1 min-w-0 min-h-0 border-l border-border-weak-base">
                                  <SessionReview
                                    diffs={diffs()}
                                    diffStyle={diffStyle()}
                                    onDiffStyleChange={setDiffStyle}
                                    classes={{
                                      root: "pb-20",
                                      header: "px-6",
                                      container: "px-6",
                                    }}
                                  />
                                </div>
                              </Show>
                            </div>
                            <Switch>
                              <Match when={diffs().length > 0}>
                                <Tabs classList={{ "md:hidden": wide(), "lg:hidden": !wide() }}>
                                  <Tabs.List>
                                    <Tabs.Trigger value="session" class="w-1/2" classes={{ button: "w-full" }}>
                                      Session
                                    </Tabs.Trigger>
                                    <Tabs.Trigger
                                      value="review"
                                      class="w-1/2 !border-r-0"
                                      classes={{ button: "w-full" }}
                                    >
                                      {diffs().length} Files Changed
                                    </Tabs.Trigger>
                                  </Tabs.List>
                                  <Tabs.Content value="session" class="!overflow-hidden">
                                    {turns()}
                                  </Tabs.Content>
                                  <Tabs.Content value="review" class="!overflow-hidden hidden data-[selected]:block">
                                    <div class="relative h-full pt-3 overflow-y-auto no-scrollbar">
                                      <SessionReview
                                        diffs={diffs()}
                                        classes={{
                                          root: "pb-20",
                                          header: "px-4",
                                          container: "px-4",
                                        }}
                                      />
                                    </div>
                                  </Tabs.Content>
                                </Tabs>
                              </Match>
                              <Match when={true}>
                                <div
                                  classList={{
                                    "!overflow-hidden flex-1 min-h-0": true,
                                    "md:hidden": wide(),
                                    "lg:hidden": !wide(),
                                  }}
                                >
                                  {turns()}
                                </div>
                              </Match>
                            </Switch>
                          </div>
                        </div>
                      )
                    })}
                  </DataProvider>
                </FileComponentProvider>
              </ClientOnlyWorkerPoolProvider>
            </>
          )
        }}
      </Show>
    </ErrorBoundary>
  )
}
