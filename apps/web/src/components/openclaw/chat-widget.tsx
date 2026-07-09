"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";

import {
  getApiErrorMessage,
  getChatStatus,
  sendAssistantMessage
} from "@/lib/api";
import { useSession } from "@/lib/use-session";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Status = "loading" | "configured" | "unconfigured";

const markdownPlugins = [remarkGfm];

export function ChatWidget() {
  const { activeOrganization } = useSession();
  const organizationId = activeOrganization?.id;

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // .then keeps setState deferred (react-hooks/set-state-in-effect).
  useEffect(() => {
    getChatStatus()
      .then((configured) => setStatus(configured ? "configured" : "unconfigured"))
      .catch(() => setStatus("unconfigured"));
  }, []);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, open]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !organizationId || sending) {
      return;
    }

    setInput("");
    setError(null);
    setMessages((current) => [...current, { role: "user", content: text }]);
    setSending(true);

    try {
      const reply = await sendAssistantMessage(organizationId, text);
      setMessages((current) => [...current, { role: "assistant", content: reply }]);
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setSending(false);
    }
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

          <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto py-4 pr-1">
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

            {sending ? (
              <div className="flex justify-start">
                <div className="glass-soft inline-flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm text-(--muted)">
                  <Loader2 size={14} className="animate-spin" />
                  Thinking…
                </div>
              </div>
            ) : null}
          </div>

          {error ? (
            <p className="mb-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-600 dark:text-red-400">
              {error}
            </p>
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
            <button
              type="submit"
              disabled={status !== "configured" || sending || !input.trim()}
              aria-label="Send"
              className="btn-gradient grid h-10 w-10 shrink-0 place-items-center rounded-full"
            >
              <Send size={16} />
            </button>
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
