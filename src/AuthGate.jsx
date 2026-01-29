import React from "react";
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const LS_ACTIVE_SOCIETY = "den_active_society_id_v1";

// GitHub Pages base
const GH_PAGES_BASE = "/den-society-vite/";
const SITE_ORIGIN = "https://kevanojb.github.io";
const SITE_URL = `${SITE_ORIGIN}${GH_PAGES_BASE}`;

const AppLazy = React.lazy(() => import("./App.jsx"));

function CenterCard({ children }) {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
        {children}
      </div>
    </div>
  );
}

function slugify(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// For GH Pages, pathname includes the repo base path.
// Example: "/den-society-vite/den" => slug "den"
function getSlugFromPath() {
  try {
    // Prefer hash route: "#/den"
    const hash = (window.location.hash || "").replace(/^#\/?/, "");
    const hashSlug = (hash.split("/").filter(Boolean)[0] || "").trim();
    if (hashSlug) return hashSlug;

    // Fallback to path: "/den-society-vite/den"
    const path = window.location.pathname || "/";
    const clean = path.startsWith(GH_PAGES_BASE)
      ? path.slice(GH_PAGES_BASE.length)
      : path.replace(/^\//, "");
    return (clean.split("/").filter(Boolean)[0] || "").trim();
  } catch {
    return "";
  }
}


function FloatingAdminButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-4 left-4 z-50 rounded-full px-4 py-2 shadow-lg border border-neutral-200 bg-white text-neutral-900 font-bold"
      title="Admin sign in"
      style={{
        paddingBottom: "max(10px, env(safe-area-inset-bottom))",
      }}
    >
      Admin sign in
    </button>
  );
}

function AdminSignInSheet({ open, onClose, email, setEmail, busy, msg, onSubmit }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-extrabold text-neutral-900">Admin sign in</div>
            <div className="text-xs text-neutral-500">We’ll email you a magic link.</div>
          </div>
          <button className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 font-bold" onClick={onClose}>
            ✕
          </button>
        </div>

        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">Email</label>
            <input
              className="w-full px-3 py-2 rounded-xl border border-neutral-200 bg-white"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>

          {msg ? (
            <div className="text-sm rounded-xl px-3 py-2 border border-neutral-200 bg-neutral-50">
              {msg}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-black text-white px-4 py-2.5 font-bold disabled:opacity-60"
              disabled={busy}
            >
              {busy ? "Sending…" : "Send magic link"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AuthGate() {
  const envOk = Boolean(SUPA_URL && SUPA_KEY);

  const [client] = React.useState(() =>
    createClient(SUPA_URL, SUPA_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  );

  const [session, setSession] = React.useState(null);
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");

  const [tenantLoading, setTenantLoading] = React.useState(false);
  const [memberships, setMemberships] = React.useState([]);
  const [societies, setSocieties] = React.useState([]);

  const [activeSocietyId, setActiveSocietyId] = React.useState(() => {
    try {
      return localStorage.getItem(LS_ACTIVE_SOCIETY) || "";
    } catch {
      return "";
    }
  });

  const [pickerOpen, setPickerOpen] = React.useState(false);

  // Public society-by-slug mode (no login)
  const [publicLoading, setPublicLoading] = React.useState(false);
  const [publicSociety, setPublicSociety] = React.useState(null);

  // Sheet for captains/admins to sign in from public view
  const [adminSheetOpen, setAdminSheetOpen] = React.useState(false);

  // ---- Create society (invite code) ----
  const [createMode, setCreateMode] = React.useState(false);
  const [inviteCode, setInviteCode] = React.useState("");
  const [newSocietyName, setNewSocietyName] = React.useState("");
  const [newSocietySlug, setNewSocietySlug] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (!newSocietyName) return;
    if (newSocietySlug) return;
    setNewSocietySlug(slugify(newSocietyName));
  }, [newSocietyName, newSocietySlug]);

  // session tracking
  React.useEffect(() => {
    if (!envOk) return;

    client.auth.getSession().then(({ data }) => setSession(data?.session || null));
    const { data: sub } = client.auth.onAuthStateChange((_evt, s) => setSession(s || null));

    return () => {
      try {
        sub?.subscription?.unsubscribe?.();
      } catch {}
    };
  }, [client, envOk]);

  // Public mode: if URL contains a slug, fetch that society without requiring login
  React.useEffect(() => {
    if (!envOk) return;

    const slug = getSlugFromPath();
    if (!slug) {
      setPublicSociety(null);
      return;
    }

    let cancelled = false;
    async function loadPublicSociety() {
      setPublicLoading(true);
      setMsg("");
      try {
        const { data, error } = await client
          .from("societies")
          .select("id, name, slug")
          .eq("slug", slug)
          .single();

        if (error) throw error;
        if (!cancelled) setPublicSociety(data || null);
      } catch (e) {
        if (!cancelled) setMsg(e?.message || String(e));
        if (!cancelled) setPublicSociety(null);
      } finally {
        if (!cancelled) setPublicLoading(false);
      }
    }

    loadPublicSociety();
    return () => {
      cancelled = true;
    };
  }, [client, envOk]);

  const loadTenant = React.useCallback(
    async (userId, opts = {}) => {
      if (!envOk) return;
      if (!userId) return;

      const { preferSocietyId = "" } = opts || {};

      setTenantLoading(true);
      setMsg("");

      const m = await client.from("memberships").select("society_id, role").eq("user_id", userId);

      if (m.error) {
        setMsg(m.error.message);
        setTenantLoading(false);
        return;
      }

      const mem = Array.isArray(m.data) ? m.data : [];
      setMemberships(mem);

      const ids = mem.map((x) => x.society_id).filter(Boolean).map(String);

      if (!ids.length) {
        setSocieties([]);
        setPickerOpen(false);
        setTenantLoading(false);
        return;
      }

      const s = await client.from("societies").select("id, name, slug").in("id", ids);

      if (s.error) {
        setMsg(s.error.message);
        setTenantLoading(false);
        return;
      }

      const socs = Array.isArray(s.data) ? s.data : [];
      setSocieties(socs);

      let pick =
        preferSocietyId && ids.includes(String(preferSocietyId)) ? String(preferSocietyId) : "";

      if (!pick && activeSocietyId && ids.includes(String(activeSocietyId))) pick = String(activeSocietyId);

      if (!pick && ids.length === 1) pick = ids[0];

      if (!pick && ids.length > 1) {
        setPickerOpen(true);
        setTenantLoading(false);
        return;
      }

      if (!pick && ids.length) pick = ids[0];

      if (pick) {
        setActiveSocietyId(String(pick));
        try {
          localStorage.setItem(LS_ACTIVE_SOCIETY, String(pick));
        } catch {}
      }

      setPickerOpen(false);
      setTenantLoading(false);
    },
    [client, envOk, activeSocietyId]
  );

  // load memberships + societies (only when logged in)
  React.useEffect(() => {
    if (!envOk) return;

    async function run() {
      const userId = session?.user?.id;
      if (!userId) return;
      await loadTenant(userId);
    }

    run();
  }, [envOk, session?.user?.id, loadTenant]);

  // persist selection
  React.useEffect(() => {
    try {
      if (activeSocietyId) localStorage.setItem(LS_ACTIVE_SOCIETY, activeSocietyId);
    } catch {}
  }, [activeSocietyId]);

  // Legacy globals for App.jsx
  React.useEffect(() => {
    if (session?.user && activeSocietyId) {
      const options = (societies || [])
        .slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

      const activeSoc = options.find((s) => String(s.id) === String(activeSocietyId));
      const role =
        memberships.find((m) => String(m.society_id) === String(activeSocietyId))?.role || "player";

      window.__activeSocietyId = String(activeSocietyId);
      window.__activeSocietyName = activeSoc?.name || "";
      window.__activeSocietySlug = activeSoc?.slug || "";
      window.__activeSocietyRole = role;
      window.__supabase_client__ = client;
      return;
    }

    if (!session?.user && publicSociety?.id) {
      window.__activeSocietyId = String(publicSociety.id);
      window.__activeSocietyName = publicSociety.name || "";
      window.__activeSocietySlug = publicSociety.slug || "";
      window.__activeSocietyRole = "player";
      window.__supabase_client__ = client;
    }
  }, [client, session?.user?.id, activeSocietyId, societies, memberships, publicSociety]);

  async function sendMagicLink(e) {
    e.preventDefault();
    setMsg("");

    const em = (email || "").trim();
    if (!em) {
      setMsg("Enter your email.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await client.auth.signInWithOtp({
        email: em,
        options: {
          emailRedirectTo: SITE_URL,
          shouldCreateUser: true,
        },
      });

      if (error) throw error;
      setMsg("Magic link sent ✓ Check your email");
    } catch (ex) {
      setMsg(ex?.message || String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await client.auth.signOut();
    } catch {}
  }

  async function createSociety(e) {
    e.preventDefault();
    setMsg("");

    const name = (newSocietyName || "").trim();
    const code = (inviteCode || "").trim();
    const slug = ((newSocietySlug || "") || slugify(name)).trim();

    if (!name) return setMsg("Enter a society name.");
    if (!code) return setMsg("Enter your invite code.");

    setCreating(true);
    try {
      const { data, error } = await client.rpc("create_society_with_code", {
        society_name: name,
        society_slug: slug,
        invite_code: code,
      });

      if (error) throw error;

      const newId = String(data || "");
      if (newId) {
        setActiveSocietyId(newId);
        try {
          localStorage.setItem(LS_ACTIVE_SOCIETY, newId);
        } catch {}
        setPickerOpen(false);
      }

      setInviteCode("");
      setNewSocietyName("");
      setNewSocietySlug("");
      setCreateMode(false);

      const userId = session?.user?.id;
      await loadTenant(userId, { preferSocietyId: newId });
    } catch (ex) {
      setMsg(ex?.message || String(ex));
    } finally {
      setCreating(false);
    }
  }

  if (!envOk) {
    return (
      <CenterCard>
        <div className="text-xl font-black text-neutral-900">Config missing</div>
        <div className="mt-2 text-sm text-neutral-700">
          VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are undefined in the deployed build.
        </div>
      </CenterCard>
    );
  }

  // ✅ Public golfer mode: slug in URL + no session => render app without forcing sign-in
  if (!session?.user) {
    if (publicLoading) {
      return (
        <CenterCard>
          <div className="text-sm text-neutral-600">Loading society…</div>
        </CenterCard>
      );
    }

    if (publicSociety?.id) {
      return (
        <>
          <React.Suspense fallback={<CenterCard><div>Loading…</div></CenterCard>}>
            <AppLazy
              key={String(publicSociety.id)}
              supabase={client}
              session={null}
              activeSocietyId={String(publicSociety.id)}
              activeSocietySlug={publicSociety.slug || ""}
              activeSocietyName={publicSociety.name || ""}
              activeSocietyRole={"player"}
            />
          </React.Suspense>

          <FloatingAdminButton onClick={() => { setMsg(""); setAdminSheetOpen(true); }} />
          <AdminSignInSheet
            open={adminSheetOpen}
            onClose={() => setAdminSheetOpen(false)}
            email={email}
            setEmail={setEmail}
            busy={busy}
            msg={msg}
            onSubmit={sendMagicLink}
          />
        </>
      );
    }

    // No valid slug => show sign-in landing
    return (
      <CenterCard>
        <div className="text-2xl font-black text-neutral-900">Sign in</div>
        <div className="text-sm text-neutral-600 mt-2">We’ll email you a magic link.</div>

        <form className="mt-4 space-y-3" onSubmit={sendMagicLink}>
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">Email</label>
            <input
              className="w-full px-3 py-2 rounded-xl border border-neutral-200 bg-white"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>

          {msg ? (
            <div className="text-sm rounded-xl px-3 py-2 border border-neutral-200 bg-neutral-50">
              {msg}
            </div>
          ) : null}

          <button
            className="w-full rounded-xl bg-black text-white px-4 py-2.5 font-bold disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Sending…" : "Send magic link"}
          </button>

          <div className="text-xs text-neutral-500 pt-1">
            Golfers: use your society link (e.g. <span className="font-mono">{SITE_URL}den</span>).
          </div>
        </form>
      </CenterCard>
    );
  }

  // Logged-in modes below (captains/admins)

  if (tenantLoading) {
    return (
      <CenterCard>
        <div className="text-sm text-neutral-600">Loading…</div>
        <button
          className="mt-4 w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold"
          onClick={signOut}
        >
          Sign out
        </button>
      </CenterCard>
    );
  }

  if (memberships.length === 0) {
    if (!createMode) {
      return (
        <CenterCard>
          <div className="text-lg font-black text-neutral-900">{session.user.email}</div>
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            You don’t have access to any societies yet.
          </div>

          <button
            className="mt-4 w-full rounded-xl bg-black text-white px-4 py-2.5 font-bold"
            onClick={() => {
              setMsg("");
              setCreateMode(true);
            }}
          >
            Create a new society
          </button>

          <button
            className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold"
            onClick={signOut}
          >
            Sign out
          </button>
        </CenterCard>
      );
    }

    return (
      <CenterCard>
        <div className="text-2xl font-black text-neutral-900">Create society</div>
        <div className="text-sm text-neutral-600 mt-2">
          Enter your invite code and name your society.
        </div>

        <form className="mt-4 space-y-3" onSubmit={createSociety}>
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">Invite code</label>
            <input
              className="w-full px-3 py-2 rounded-xl border border-neutral-200 bg-white"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="e.g. CHART-7F3KQ"
              autoCapitalize="characters"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">Society name</label>
            <input
              className="w-full px-3 py-2 rounded-xl border border-neutral-200 bg-white"
              value={newSocietyName}
              onChange={(e) => setNewSocietyName(e.target.value)}
              placeholder="e.g. Den Society"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">Slug (optional)</label>
            <input
              className="w-full px-3 py-2 rounded-xl border border-neutral-200 bg-white"
              value={newSocietySlug}
              onChange={(e) => setNewSocietySlug(e.target.value)}
              placeholder="e.g. den-society"
            />
            <div className="text-xs text-neutral-500 mt-1">
              Used for friendly URLs. Leave blank to auto-generate.
            </div>
          </div>

          {msg ? (
            <div className="text-sm rounded-xl px-3 py-2 border border-neutral-200 bg-neutral-50">
              {msg}
            </div>
          ) : null}

          <button
            className="w-full rounded-xl bg-black text-white px-4 py-2.5 font-bold disabled:opacity-60"
            disabled={creating}
          >
            {creating ? "Creating…" : "Create society"}
          </button>

          <button
            type="button"
            className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold"
            onClick={() => {
              setMsg("");
              setCreateMode(false);
            }}
          >
            Back
          </button>

          <button
            type="button"
            className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold"
            onClick={signOut}
          >
            Sign out
          </button>
        </form>
      </CenterCard>
    );
  }

  const options = (societies || [])
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  if (pickerOpen) {
    return (
      <CenterCard>
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">
          Choose society
        </div>
        <div className="text-lg font-black text-neutral-900 mt-1">{session.user.email}</div>

        <div className="mt-4 space-y-2">
          {options.map((s) => (
            <button
              key={s.id}
              className="w-full text-left rounded-2xl border border-neutral-200 bg-white px-4 py-3 hover:bg-neutral-50"
              onClick={() => {
                const id = String(s.id);
                setActiveSocietyId(id);
                try {
                  localStorage.setItem(LS_ACTIVE_SOCIETY, id);
                } catch {}
                setPickerOpen(false);
              }}
            >
              <div className="font-black text-neutral-900">{s.name || s.slug || s.id}</div>
              <div className="text-xs text-neutral-500">{s.slug ? `/${s.slug}` : s.id}</div>
            </button>
          ))}
        </div>

        <button
          className="mt-4 w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold"
          onClick={signOut}
        >
          Sign out
        </button>
      </CenterCard>
    );
  }

  const activeSoc = options.find((s) => String(s.id) === String(activeSocietyId));
  const role =
    memberships.find((m) => String(m.society_id) === String(activeSocietyId))?.role || "player";

  return (
    <React.Suspense fallback={<CenterCard><div>Loading…</div></CenterCard>}>
      <AppLazy
        key={String(activeSocietyId)}
        supabase={client}
        session={session}
        activeSocietyId={String(activeSocietyId)}
        activeSocietySlug={activeSoc?.slug || ""}
        activeSocietyName={activeSoc?.name || ""}
        activeSocietyRole={role}
      />
    </React.Suspense>
  );
}
