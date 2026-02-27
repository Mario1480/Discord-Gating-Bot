import { FormEvent, useEffect, useMemo, useState } from "react";

type GuildSummary = {
  id: string;
  name: string;
  icon: string | null;
};

type AdminSession = {
  discordUserId: string;
  username: string;
  avatar: string | null;
  guilds: GuildSummary[];
};

type SessionResponse = {
  authenticated: boolean;
  session: AdminSession;
};

type RoleSummary = {
  id: string;
  name: string;
  position: number;
  managed: boolean;
  mentionable: boolean;
  bot_can_manage: boolean;
};

type RuleType = "TOKEN_AMOUNT" | "TOKEN_USD" | "NFT_COLLECTION";

type RuleItem = {
  id: string;
  type: RuleType;
  role_id: string;
  mint: string | null;
  collection: string | null;
  amount: number | null;
  usd: number | null;
  count: number | null;
  coingecko_id: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type AuditItem = {
  id: string;
  timestamp: string;
  guild_id: string;
  discord_user_id: string;
  rule_id: string | null;
  role_id: string;
  action: string;
  reason: string;
};

type RuleCreateForm = {
  type: RuleType;
  role_id: string;
  mint: string;
  amount: string;
  usd: string;
  coingecko_id: string;
  collection: string;
  count: string;
};

const defaultForm: RuleCreateForm = {
  type: "TOKEN_AMOUNT",
  role_id: "",
  mint: "",
  amount: "",
  usd: "",
  coingecko_id: "",
  collection: "",
  count: ""
};

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (typeof payload.error === "string") {
      throw new Error(payload.error);
    }

    throw new Error(`Request failed (${response.status})`);
  }

  return payload as T;
}

function formatRule(rule: RuleItem): string {
  if (rule.type === "TOKEN_AMOUNT") {
    return `mint=${rule.mint ?? "-"} amount=${rule.amount ?? "-"}`;
  }

  if (rule.type === "TOKEN_USD") {
    return `mint=${rule.mint ?? "-"} usd=${rule.usd ?? "-"} coingecko=${rule.coingecko_id ?? "-"}`;
  }

  return `collection=${rule.collection ?? "-"} count=${rule.count ?? "-"}`;
}

function findRoleName(roles: RoleSummary[], roleId: string): string {
  return roles.find((role) => role.id === roleId)?.name ?? roleId;
}

function buildUpdatePayload(rule: RuleItem, enabled: boolean): Record<string, unknown> {
  if (rule.type === "TOKEN_AMOUNT") {
    return {
      type: "TOKEN_AMOUNT",
      role_id: rule.role_id,
      mint: rule.mint ?? "",
      amount: rule.amount ?? 0,
      enabled
    };
  }

  if (rule.type === "TOKEN_USD") {
    return {
      type: "TOKEN_USD",
      role_id: rule.role_id,
      mint: rule.mint ?? "",
      usd: rule.usd ?? 0,
      coingecko_id: rule.coingecko_id ?? "",
      enabled
    };
  }

  return {
    type: "NFT_COLLECTION",
    role_id: rule.role_id,
    collection: rule.collection ?? "",
    count: rule.count ?? 0,
    enabled
  };
}

export function App() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState("");
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);

  const [form, setForm] = useState<RuleCreateForm>(defaultForm);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isLoadingGuildData, setIsLoadingGuildData] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunningRecheck, setIsRunningRecheck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const guilds = session?.guilds ?? [];

  useEffect(() => {
    const loadSession = async () => {
      try {
        const data = await apiRequest<SessionResponse>("/admin/api/session");
        setSession(data.session);
        setSelectedGuildId((current) => current || data.session.guilds[0]?.id || "");
      } catch (sessionError) {
        if (!(sessionError instanceof Error && sessionError.message === "UNAUTHORIZED")) {
          setError(sessionError instanceof Error ? sessionError.message : "Failed to load session");
        }
      } finally {
        setIsLoadingSession(false);
      }
    };

    void loadSession();
  }, []);

  const loadGuildData = async (guildId: string) => {
    if (!guildId) {
      setRoles([]);
      setRules([]);
      setAuditItems([]);
      return;
    }

    setIsLoadingGuildData(true);
    setError(null);

    try {
      const [rolesData, rulesData, auditData] = await Promise.all([
        apiRequest<{ items: RoleSummary[] }>(`/admin/api/guilds/${guildId}/roles`),
        apiRequest<{ items: RuleItem[] }>(`/admin/api/guilds/${guildId}/rules`),
        apiRequest<{ items: AuditItem[] }>(`/admin/api/guilds/${guildId}/audit?limit=10&page=1`)
      ]);

      setRoles(rolesData.items);
      setRules(rulesData.items);
      setAuditItems(auditData.items);
      setForm((current) => ({
        ...current,
        role_id: current.role_id || rolesData.items.find((role) => role.bot_can_manage)?.id || ""
      }));
    } catch (guildError) {
      setError(guildError instanceof Error ? guildError.message : "Failed to load guild settings");
    } finally {
      setIsLoadingGuildData(false);
    }
  };

  useEffect(() => {
    if (!session || !selectedGuildId) {
      return;
    }

    void loadGuildData(selectedGuildId);
  }, [session, selectedGuildId]);

  const manageableRoles = useMemo(() => roles.filter((role) => role.bot_can_manage), [roles]);

  const createRule = async (event: FormEvent) => {
    event.preventDefault();

    if (!selectedGuildId) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      let payload: Record<string, unknown>;

      if (form.type === "TOKEN_AMOUNT") {
        payload = {
          type: "TOKEN_AMOUNT",
          role_id: form.role_id,
          mint: form.mint,
          amount: Number(form.amount)
        };
      } else if (form.type === "TOKEN_USD") {
        payload = {
          type: "TOKEN_USD",
          role_id: form.role_id,
          mint: form.mint,
          usd: Number(form.usd),
          coingecko_id: form.coingecko_id
        };
      } else {
        payload = {
          type: "NFT_COLLECTION",
          role_id: form.role_id,
          collection: form.collection,
          count: Number(form.count)
        };
      }

      await apiRequest(`/admin/api/guilds/${selectedGuildId}/rules`, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setNotice("Rule added.");
      await loadGuildData(selectedGuildId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to create rule");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleRule = async (rule: RuleItem) => {
    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      await apiRequest(`/admin/api/guilds/${selectedGuildId}/rules/${rule.id}`, {
        method: "PUT",
        body: JSON.stringify(buildUpdatePayload(rule, !rule.enabled))
      });

      setNotice(`Rule ${rule.enabled ? "disabled" : "enabled"}.`);
      await loadGuildData(selectedGuildId);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update rule");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteRule = async (ruleId: string) => {
    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      await apiRequest(`/admin/api/guilds/${selectedGuildId}/rules/${ruleId}`, {
        method: "DELETE"
      });

      setNotice("Rule removed.");
      await loadGuildData(selectedGuildId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete rule");
    } finally {
      setIsSaving(false);
    }
  };

  const runRecheck = async () => {
    if (!selectedGuildId) {
      return;
    }

    setIsRunningRecheck(true);
    setError(null);
    setNotice(null);

    try {
      await apiRequest(`/admin/api/guilds/${selectedGuildId}/recheck`, {
        method: "POST",
        body: JSON.stringify({})
      });

      setNotice("Recheck queued.");
      await loadGuildData(selectedGuildId);
    } catch (recheckError) {
      setError(recheckError instanceof Error ? recheckError.message : "Failed to queue recheck");
    } finally {
      setIsRunningRecheck(false);
    }
  };

  const logout = async () => {
    setError(null);
    setNotice(null);

    try {
      await apiRequest("/admin/logout", {
        method: "POST",
        body: JSON.stringify({})
      });
      window.location.assign("/admin");
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Logout failed");
    }
  };

  if (isLoadingSession) {
    return <div className="shell">Loading admin session...</div>;
  }

  if (!session) {
    return (
      <div className="shell">
        <section className="panel login-panel">
          <h1>Discord Gating Admin</h1>
          <p>Sign in with Discord to configure role gating settings.</p>
          <a className="btn btn-primary" href="/admin/login?redirect=/admin">
            Sign In with Discord
          </a>
          {error ? <p className="message error">{error}</p> : null}
        </section>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar panel">
        <div>
          <h1>Gating Settings</h1>
          <p className="muted">Logged in as {session.username}</p>
        </div>
        <div className="topbar-actions">
          <select
            value={selectedGuildId}
            onChange={(event) => setSelectedGuildId(event.target.value)}
            aria-label="Select server"
          >
            {guilds.map((guild) => (
              <option key={guild.id} value={guild.id}>
                {guild.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {error ? <p className="message error">{error}</p> : null}
      {notice ? <p className="message success">{notice}</p> : null}

      <main className="layout-grid">
        <section className="panel">
          <div className="section-head">
            <h2>Rules</h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={runRecheck}
              disabled={isRunningRecheck || !selectedGuildId}
            >
              {isRunningRecheck ? "Queueing..." : "Run Recheck"}
            </button>
          </div>

          {isLoadingGuildData ? <p>Loading server settings...</p> : null}

          {!isLoadingGuildData && rules.length === 0 ? <p>No rules configured for this server.</p> : null}

          {rules.length > 0 ? (
            <ul className="rule-list">
              {rules.map((rule) => (
                <li key={rule.id} className="rule-item">
                  <div>
                    <strong>{rule.type}</strong>
                    <p className="rule-meta">Role: {findRoleName(roles, rule.role_id)}</p>
                    <p className="rule-meta">{formatRule(rule)}</p>
                  </div>
                  <div className="rule-actions">
                    <button type="button" className="btn" onClick={() => toggleRule(rule)} disabled={isSaving}>
                      {rule.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => deleteRule(rule.id)}
                      disabled={isSaving}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="panel">
          <h2>Add Rule</h2>
          <form className="rule-form" onSubmit={createRule}>
            <label>
              Type
              <select
                value={form.type}
                onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as RuleType }))}
              >
                <option value="TOKEN_AMOUNT">Token Amount</option>
                <option value="TOKEN_USD">Token USD</option>
                <option value="NFT_COLLECTION">NFT Collection</option>
              </select>
            </label>

            <label>
              Role
              <select
                value={form.role_id}
                onChange={(event) => setForm((current) => ({ ...current, role_id: event.target.value }))}
                required
              >
                <option value="" disabled>
                  Select role
                </option>
                {manageableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>

            {(form.type === "TOKEN_AMOUNT" || form.type === "TOKEN_USD") && (
              <label>
                Mint Address
                <input
                  value={form.mint}
                  onChange={(event) => setForm((current) => ({ ...current, mint: event.target.value }))}
                  required
                />
              </label>
            )}

            {form.type === "TOKEN_AMOUNT" && (
              <label>
                Minimum Amount
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.amount}
                  onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                  required
                />
              </label>
            )}

            {form.type === "TOKEN_USD" && (
              <>
                <label>
                  Minimum USD
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={form.usd}
                    onChange={(event) => setForm((current) => ({ ...current, usd: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  CoinGecko ID
                  <input
                    value={form.coingecko_id}
                    onChange={(event) => setForm((current) => ({ ...current, coingecko_id: event.target.value }))}
                    required
                  />
                </label>
              </>
            )}

            {form.type === "NFT_COLLECTION" && (
              <>
                <label>
                  Collection Address
                  <input
                    value={form.collection}
                    onChange={(event) => setForm((current) => ({ ...current, collection: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Minimum Count
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.count}
                    onChange={(event) => setForm((current) => ({ ...current, count: event.target.value }))}
                    required
                  />
                </label>
              </>
            )}

            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "Saving..." : "Add Rule"}
            </button>
          </form>
        </section>

        <section className="panel full-width">
          <h2>Recent Audit Events</h2>
          {auditItems.length === 0 ? <p>No audit events yet.</p> : null}
          {auditItems.length > 0 ? (
            <div className="audit-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>User</th>
                    <th>Role</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {auditItems.map((item) => (
                    <tr key={item.id}>
                      <td>{new Date(item.timestamp).toLocaleString()}</td>
                      <td>{item.action}</td>
                      <td>{item.discord_user_id}</td>
                      <td>{findRoleName(roles, item.role_id)}</td>
                      <td>{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
