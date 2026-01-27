import React from "react";
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// localStorage key for last selected society
const LS_ACTIVE_SOCIETY = "den_active_society_id_v1";

// IMPORTANT: your GitHub Pages base
const GH_PAGES_BASE = "/den-society-vite/";
const SITE_ORIGIN = "https://kevanojb.github.io";
const SITE_URL = `${SITE_ORIGIN}${GH_PAGES_BASE}`;

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

export default function AuthGate() {
  const [client] = React.useState(() =>
    createClient(SUPA_URL, SUPA_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // REQUIRED for magic links
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

  // This controls whether the picker is currently shown.
  // We will show it ONLY when user has >1 membership AND we haven't chosen one this session.
  const [showPicker, setShowPicker] = React.useState(false);

  const envOk = Boolean(SUPA_URL && SUPA_KEY);

  // 1) session tracking
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

  // 2) load memberships + societies
  React.useEffect(() => {
    if (!envOk) return;

    let cancelled = false;

    async function loadTenant() {
      if (!session?.user?.id) return;

      setTenantLoading(true);
      setMsg("");

      const m = await client
        .from("memberships")
        .select("society_id, role")
        .eq("user_id", session.user.id);

      if (cancelled) return;

      if (m.error) {
        setMsg(m.error.message);
        setTenantLoading(false);
        return;
      }

      const mem = Array.isArray(m.data) ? m.data : [];
      setMemberships(mem);

      const ids = mem.map((x) => x.society_id).filter(Boolean);

      if (!ids.length) {
        setSocieties([]);
        setTenantLoading(false);
        setShowPicker(false);
        return;
      }

      const s = await client.from("societies").select("id, name, slug").in("id", ids);

      if (cancelled) return;

      if (s.error) {
        setMsg(s.error.message);
        setTenantLoading(false);
        return;
      }

      const socs = Array.isArray(s.data) ? s.data : [];
      setSocieties(socs);

      // pick remembered > only-one > first
      let pick = activeSocietyId && ids.includes(activeSocietyId) ? activeSocietyId : "";

      if (!pick && ids.length === 1) pick = ids[0];

      // If >1 and nothing valid remembered, force picker
      if (!pick && ids.length > 1) {
        setShowPicker(true);
        setTenantLoading(false);
        return;
      }

      if (!pick && ids.length) pick = ids[0];
      if (pick) setActiveSocietyId(String(pick));

      // If user has multiple memberships, we only show picker when they *need* to choose
      setShowPicker(false);
      setTenantLoading(false);
    }

    loadTenant();

    return () => {
      cancelled = true;
      setTenantLoading(false);
    };
    // NOTE: activeSocietyId intentionally NOT in deps to avoid loops
  }, [client, envOk, session?.user?.id]);

  // 3) persist selection
  React.useEffect(() => {
    try {
      if (activeSocietyId) localStorage.setItem(LS_ACTIVE_SOCIETY, activeSocietyId);
    } catch {}
  }, [activeSocietyId]);

  async function sendMagicLink(e) {
    e.preventDefault();
    setMsg("");

    if (!envOk) {
      setMsg("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in the deployed build.");
      return;
    }

    const em = (email || "").trim();
    if (!em) {
      setMsg("Enter your email.");
      return;
    }

    setBusy(true);
    try {
      const redirectTo = SITE_URL;

      const { error } = await client.auth.signInWithOtp({
        email: em,
        options: {
          emailRedirectTo: redirectTo,
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

  // ---------- UI GATES ----------

  if (!envOk) {
    return (
      <CenterCard>
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">
          Den Society
        </div>
        <div className="text-xl font-black text-neutral-900 mt-1">Config missing</div>
        <div className="text-sm text-neutral-700 mt-2">
          Your deployed build doesn’t have Supabase env vars.
        </div>
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are undefined in the deployed site. Fix the
          GitHub Action env injection.
        </div>
      </CenterCard>
    );
  }

  if (!session?.user) {
    return (
      <CenterCard>
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">
          Den Society
        </div>
        <div className="text-2xl font-black text-neutral-900 mt-1">Sign in</div>
        <div className="text-sm text-neutral-600 mt-2">We’ll email you a magic link.</div>

        <form className="mt-4 space-y-3" onSubmit={sendMagicLink}>
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">Email</label>
            <input
              className="w-full px-3 py-2 rounded-xl border border-neutral-200 bg-white focus:outline-none focus:ring-2 focus:ring-neutral-300"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>

          {msg ? (
            <div
              className={
                "text-sm rounded-xl px-3 py-2 " +
                (String(msg).includes("sent")
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
                  : "bg-rose-50 border border-rose-200 text-rose-900")
              }
            >
              {msg}
            </div>
          ) : null}

          <button
            className="w-full rounded-xl bg-black text-white px-4 py-2.5 font-bold disabled:opacity-60"
            disabled={busy}
          >
            {busy ? "Sending…" : "Send magic link"}
          </button>
        </form>
      </CenterCard>
    );
  }

  if (tenantLoading) {
    return (
      <CenterCard>
        <div className="text-sm text-neutral-600">Loading…</div>
        {msg ? <div className="mt-3 text-sm text-rose-700">{msg}</div> : null}
        <button
          className="mt-4 w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold"
          onClick={signOut}
        >
          Sign out
        </button>
      </CenterCard>
    );
  }

  if (Array.isArray(memberships) && memberships.length === 0) {
    return (
      <CenterCard>
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">
          Signed in as
        </div>
        <div className="text-lg font-black text-neutral-900 mt-1">{session.user.email}</div>
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You don’t have access to any societies yet. Ask a captain to add you to the memberships
          table.
        </div>
        <button
          className="mt-4 w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold"
          onClick={signOut}
        >
          Sign out
        </button>
        {msg ? <div className="mt-3 text-sm text-rose-700">{msg}</div> : null}
      </CenterCard>
    );
  }

  // If we need the user to choose a society, DO NOT render the app behind it.
  if (showPicker) {
    const options = (societies || [])
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

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
                setActiveSocietyId(String(s.id));
                setShowPicker(false);
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

        {msg ? <div className="mt-3 text-sm text-rose-700">{msg}</div> : null}
      </CenterCard>
    );
  }

  if (!activeSocietyId) {
    return (
      <CenterCard>
        <div className="text-sm text-neutral-600">Selecting society…</div>
        {msg ? <div className="mt-3 text-sm text-rose-700">{msg}</div> : null}
        <button
          className="mt-4 w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold"
          onClick={signOut}
        >
          Sign out
        </button>
      </CenterCard>
    );
  }

  // Set globals synchronously BEFORE App renders (prevents 400s)
  const options = (societies || [])
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const activeSoc = options.find((s) => String(s.id) === String(activeSocietyId));

  window.__activeSocietyId = String(activeSocietyId);
  window.__activeSocietyName = activeSoc?.name || "";
  window.__activeSocietySlug = activeSoc?.slug || "";
  window.__activeSocietyRole =
    memberships.find((m) => String(m.society_id) === String(activeSocietyId))?.role || "member";

  // No hooks down here
  const AppLazy = React.lazy(() => import("./App.jsx"));

  return (
    <React.Suspense
      fallback={
        <CenterCard>
          <div className="text-sm text-neutral-600">Loading…</div>
        </CenterCard>
      }
    >
      {/* key forces remount when switching societies */}
      <AppLazy key={activeSocietyId} />
    </React.Suspense>
  );
}
