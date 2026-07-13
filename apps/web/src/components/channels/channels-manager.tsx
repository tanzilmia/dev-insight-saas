"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Zap
} from "lucide-react";

import {
  type DetectedChat,
  type NotificationChannel,
  createChannel,
  deleteChannel,
  detectChats,
  getApiErrorMessage,
  listChannels,
  testChannel,
  updateChannel
} from "@/lib/api";
import { canManage, useSession } from "@/lib/use-session";
import {
  DashboardChrome,
  DashboardLoading
} from "@/components/dashboard/dashboard-chrome";

const fieldClass = "field w-full rounded-lg px-3.5 py-2.5 text-sm text-(--text)";

export function ChannelsManager() {
  const { session, status, activeOrganization, logout } = useSession();
  const organizationId = activeOrganization?.id;
  const manageable = canManage(activeOrganization?.role);

  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-channel form state.
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectedChat[] | null>(null);
  const [selectedChat, setSelectedChat] = useState<DetectedChat | null>(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!organizationId) {
      return Promise.resolve();
    }
    return listChannels(organizationId)
      .then((list) => {
        setChannels(list);
        setError(null);
      })
      .catch((caught) => setError(getApiErrorMessage(caught)))
      .finally(() => setLoading(false));
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setLabel("");
    setToken("");
    setDetected(null);
    setSelectedChat(null);
    setFormError(null);
  }

  async function handleDetect() {
    if (!organizationId || !token.trim()) {
      return;
    }
    setDetecting(true);
    setFormError(null);
    setDetected(null);
    setSelectedChat(null);
    try {
      const chats = await detectChats(organizationId, token.trim());
      setDetected(chats);
      if (chats.length === 1) {
        setSelectedChat(chats[0]!);
      }
    } catch (caught) {
      setFormError(getApiErrorMessage(caught));
    } finally {
      setDetecting(false);
    }
  }

  async function handleCreate() {
    if (!organizationId || !selectedChat || !label.trim() || !token.trim()) {
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      await createChannel({
        organizationId,
        label: label.trim(),
        token: token.trim(),
        chatId: selectedChat.id,
        chatTitle: selectedChat.title
      });
      resetForm();
      setNotice("Channel added.");
      await load();
    } catch (caught) {
      setFormError(getApiErrorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  async function handleTest(id: string) {
    setBusyId(id);
    setNotice(null);
    setError(null);
    try {
      await testChannel(id);
      setNotice("Test message sent — check your Telegram group.");
      await load();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(channel: NotificationChannel) {
    setBusyId(channel.id);
    try {
      await updateChannel(channel.id, { enabled: !channel.enabled });
      await load();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this delivery channel? Schedules using it will stop delivering.")) {
      return;
    }
    setBusyId(id);
    try {
      await deleteChannel(id);
      await load();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  if (status === "loading") {
    return <DashboardLoading />;
  }
  if (!session) {
    return null;
  }

  const content = !manageable ? (
    <div className="glass rounded-xl p-8 text-center text-sm font-bold text-(--muted)">
      This area is available to owners and managers.
    </div>
  ) : (
    <div className="grid gap-5">
      <div>
        <h1 className="text-lg font-bold tracking-tight text-(--text)">Delivery channels</h1>
        <p className="text-sm text-(--muted)">
          Send reports to Telegram. Add your bot token, detect the group, and attach it to a
          schedule — everything is managed here, nothing in config files.
        </p>
      </div>

      {error ? (
        <div className="glass rounded-xl p-4 text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="glass rounded-xl p-4 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          {notice}
        </div>
      ) : null}

      {/* Add Telegram channel */}
      <div className="glass rounded-xl p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-(--text)">
          <Send size={15} className="text-(--accent)" />
          Add a Telegram channel
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-(--muted)">
            Label
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Backend team group"
              className={fieldClass}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-bold uppercase tracking-wide text-(--muted)">
            Bot token
            <input
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setDetected(null);
                setSelectedChat(null);
              }}
              placeholder="123456:ABC-..."
              type="password"
              autoComplete="off"
              className={fieldClass}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDetect}
            disabled={detecting || !token.trim()}
            className="inline-flex items-center gap-2 rounded-lg border border-(--border) px-3.5 py-2 text-sm font-bold text-(--text) transition hover:bg-(--surface-soft) disabled:opacity-50"
          >
            {detecting ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Detect chats
          </button>
          <p className="text-xs text-(--muted)">
            First send <code className="rounded bg-(--surface-soft) px-1">/start@your_bot</code> in
            the group, then Detect.
          </p>
        </div>

        {formError ? (
          <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{formError}</p>
        ) : null}

        {detected ? (
          detected.length ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-(--muted)">
                Pick a chat
              </p>
              <div className="grid gap-2">
                {detected.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => setSelectedChat(chat)}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                      selectedChat?.id === chat.id
                        ? "border-(--accent) bg-(--accent-soft)"
                        : "border-(--border) bg-(--surface-soft) hover:border-(--accent)"
                    }`}
                  >
                    <span className="font-semibold text-(--text)">{chat.title}</span>
                    <span className="text-xs text-(--muted)">
                      {chat.type} · {chat.id}
                      {selectedChat?.id === chat.id ? (
                        <Check size={13} className="ml-1 inline text-(--accent)" />
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-(--muted)">
              No chats found. Send <code className="rounded bg-(--surface-soft) px-1">/start@your_bot</code>{" "}
              in the group (or re-add the bot), then Detect again.
            </p>
          )
        ) : null}

        <div className="mt-4">
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !selectedChat || !label.trim()}
            className="btn-gradient inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-60"
          >
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Add channel
          </button>
        </div>
      </div>

      {/* Existing channels */}
      {loading ? (
        <div className="glass grid place-items-center rounded-xl p-10 text-(--muted)">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : channels.length ? (
        <div className="glass overflow-hidden rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--border) text-left text-xs font-bold uppercase tracking-wide text-(--muted)">
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Chat</th>
                <th className="px-4 py-3">Last delivery</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => (
                <tr key={channel.id} className="border-b border-(--border) last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-(--text)">{channel.label}</p>
                    <p className="text-xs text-(--muted)">
                      {channel.type} · token …{channel.tokenLast4 ?? "----"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-(--text)">{channel.chatTitle ?? channel.chatId}</p>
                    <p className="text-xs text-(--muted)">{channel.chatId}</p>
                  </td>
                  <td className="px-4 py-3">
                    {channel.lastDeliveryStatus === "ok" ? (
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        Delivered
                      </span>
                    ) : channel.lastDeliveryStatus === "error" ? (
                      <span
                        className="text-xs font-bold text-red-600 dark:text-red-400"
                        title={channel.lastDeliveryError ?? undefined}
                      >
                        Failed
                      </span>
                    ) : (
                      <span className="text-xs text-(--muted)">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleTest(channel.id)}
                        disabled={busyId === channel.id}
                        title="Send a test message"
                        className="inline-flex items-center gap-1 rounded-md border border-(--border) px-2.5 py-1 text-[11px] font-bold text-(--text) transition hover:bg-(--surface-soft) disabled:opacity-50"
                      >
                        {busyId === channel.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Send size={12} />
                        )}
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggle(channel)}
                        disabled={busyId === channel.id}
                        title={channel.enabled ? "Disable" : "Enable"}
                        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-50 ${
                          channel.enabled
                            ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                            : "border-(--border) text-(--muted) hover:bg-(--surface-soft)"
                        }`}
                      >
                        <Zap size={12} />
                        {channel.enabled ? "On" : "Off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(channel.id)}
                        disabled={busyId === channel.id}
                        title="Remove"
                        className="inline-flex items-center rounded-md border border-(--border) px-2 py-1 text-[11px] font-bold text-red-600 transition hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="glass rounded-xl p-8 text-center text-sm text-(--muted)">
          No channels yet. Add a Telegram bot above to deliver reports there.
        </div>
      )}
    </div>
  );

  return (
    <DashboardChrome email={session.user.email} onLogout={logout}>
      {content}
    </DashboardChrome>
  );
}
