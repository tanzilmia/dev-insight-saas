"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, MessageCircle, RefreshCw, Send, Sparkles, Square, X } from "lucide-react";

import { type ChatTurn, getChatStatus, streamAssistantMessage } from "@/lib/api";
import { useSession } from "@/lib/use-session";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Status = "loading" | "configured" | "unconfigured";

const markdownPlugins = [remarkGfm];

// Send only the recent tail as context, and clamp each turn so a long prior
// report doesn't blow up the request. Users' turns are short; assistant turns
// (reports) are truncated harder.
const MAX_HISTORY = 8;

function clampTurn(message: ChatMessage): ChatTurn {
  const limit = message.role === "assistant" ? 1200 : 2000;
  const content =
    message.content.length > limit ? `${message.content.slice(0, limit)}\n…[truncated]` : message.content;
  return { role: message.role, content };
}

function toPayload(messages: ChatMessage[]): ChatTurn[] {
  const tail = messages.slice(-MAX_HISTORY);
  // Some chat APIs require the first non-system turn to be from the user, so
  // drop any leading assistant turns the window may have started on.
  const firstUser = tail.findIndex((message) => message.role === "user");
  const windowed = firstUser > 0 ? tail.slice(firstUser) : tail;
  return windowed.map(clampTurn);
}

export function ChatWidget() {
  const { activeOrganization } = useSession();
  const organizationId = activeOrganization?.id;

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Whether the view is pinned to the bottom; only then do we auto-scroll, so a
  // user reading earlier messages isn't yanked down on every streamed token.
  const pinnedRef = useRef(true);

  // .then keeps setState deferred (react-hooks/set-state-in-effect).
  useEffect(() => {
    getChatStatus()
      .then((configured) => setStatus(configured ? "configured" : "unconfigured"))
      .catch(() => setStatus("unconfigured"));
  }, []);

  // Abort any in-flight stream when the widget unmounts (no setState-after-unmount).
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (pinnedRef.current) {
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
    }
  }, [messages, streamingText, open]);

  function handleScroll() {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    pinnedRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  }

  async function runAssistant(convo: ChatMessage[]) {
    if (!organizationId) {
      return;
    }

    setError(null);
    setSending(true);
    setStreamingText("");
    pinnedRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    let streamed = "";

    try {
      const reply = await streamAssistantMessage(
        organizationId,
        toPayload(convo),
        (delta) => {
          streamed += delta;
          setStreamingText((prev) => (prev ?? "") + delta);
        },
        controller.signal
      );
      const finalText = (reply || streamed).trim();
      if (finalText) {
        setMessages((current) => [...current, { role: "assistant", content: finalText }]);
      } else {
        setError("The assistant returned an empty response. Try again.");
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        // Stopped by the user (or unmount): keep whatever streamed so far.
        const partial = streamed.trim();
        if (partial) {
          setMessages((current) => [...current, { role: "assistant", content: partial }]);
        }
      } else {
        setError(caught instanceof Error ? caught.message : "Something went wrong");
      }
    } finally {
      setStreamingText(null);
      setSending(false);
      abortRef.current = null;
    }
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !organizationId || sending) {
      return;
    }

    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    await runAssistant(next);
  }

  function handleRetry() {
    // On error the assistant turn was never appended, so the conversation still
    // ends with the user message to re-answer.
    if (sending || !messages.length) {
      return;
    }
    void runAssistant(messages);
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  return (
    <>
      {open ? (
        <section className="glass animate-rise fixed bottom-24 right-5 z-50 flex h-[520px] max-h-[72vh] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col rounded-[1.75rem] p-4">
          <header className="flex items-center justify-between gap-2 pb-3">
            <span className="inline-flex items-center gap-2 text-sm font-black text-(--text)">
              <Sparkles size={16} className="text-(--accent)" />
              DevInsight Assistant
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="grid h-8 w-8 place-items-center rounded-full text-(--muted) transition hover:text-(--text)"
            >
              <X size={16} />
            </button>
          </header>

          <div className="hairline" />

          <div
            ref={bodyRef}
            onScroll={handleScroll}
            className="flex-1 space-y-3 overflow-y-auto py-4 pr-1"
          >
            {status === "loading" ? (
              <div className="grid h-full place-items-center text-(--muted)">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : status === "unconfigured" ? (
              <p className="glass-soft rounded-2xl px-4 py-3 text-sm font-medium leading-6 text-(--muted)">
                The assistant will be available once the OpenClaw runtime is
                connected. Until then, use the Reports page to generate reports.
              </p>
            ) : messages.length === 0 ? (
              <p className="glass-soft rounded-2xl px-4 py-3 text-sm font-medium leading-6 text-(--muted)">
                Ask me for a report — e.g.{" "}
                <span className="font-bold text-(--text)">
                  “this week’s report for my backend repo”
                </span>
                .
              </p>
            ) : (
              messages.map((message, index) => (
                <div
                  key={index}
                  className={
                    message.role === "user" ? "flex justify-end" : "flex justify-start"
                  }
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      message.role === "user"
                        ? "btn-gradient font-bold"
                        : "glass-soft report-md font-medium text-(--text)"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <ReactMarkdown remarkPlugins={markdownPlugins}>
                        {message.content}
                      </ReactMarkdown>
                    ) : (
                      message.content
                    )}
                  </div>
                </div>
              ))
            )}

            {streamingText ? (
              <div className="flex justify-start">
                <div className="report-md glass-soft max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm font-medium text-(--text)">
                  <ReactMarkdown remarkPlugins={markdownPlugins}>{streamingText}</ReactMarkdown>
                </div>
              </div>
            ) : null}

            {sending && !streamingText ? (
              <div className="flex justify-start">
                <div className="glass-soft inline-flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm text-(--muted)">
                  <Loader2 size={14} className="animate-spin" />
                  Thinking…
                </div>
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-600 dark:text-red-400">
              <span className="min-w-0">{error}</span>
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-black text-(--accent) transition hover:underline"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          ) : null}

          <form onSubmit={handleSend} className="flex items-center gap-2">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={status !== "configured" || sending}
              placeholder={
                status === "configured" ? "Ask for a report…" : "Assistant not connected"
              }
              className="field w-full rounded-full px-4 py-2.5 text-sm font-medium text-(--text) placeholder:font-normal"
            />
            {sending ? (
              <button
                type="button"
                onClick={handleStop}
                aria-label="Stop"
                className="btn-gradient grid h-10 w-10 shrink-0 place-items-center rounded-full"
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={status !== "configured" || !input.trim()}
                aria-label="Send"
                className="btn-gradient grid h-10 w-10 shrink-0 place-items-center rounded-full"
              >
                <Send size={16} />
              </button>
            )}
          </form>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open assistant"
        className="btn-gradient fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
    </>
  );
}
