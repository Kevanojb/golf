import React from "react";
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const LS_ACTIVE_SOCIETY = "den_active_society_id_v1";
const LS_PENDING_CREATE = "den_pending_create_society_v1";

// GitHub Pages base (repo name)
const GH_PAGES_BASE = "/golf/";
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
// Example: "/golf/den" => slug "den"
function getSlugFromPath() {
  try {
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
          <button
            className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 font-bold"
            onClick={onClose}
          >
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

function getSocietySlugFromUrl() {
  try {
    const path = window.location.pathname || "/";
    const hash = window.location.hash || "";

    // 1) Hash router: "#/slug/anything" (or "#slug")
    if (hash) {
      const cleaned = hash.startsWith("#/")
        ? hash.slice(2)
        : hash.startsWith("#")
          ? hash.slice(1)
          : hash;
      const seg = cleaned.split("/").filter(Boolean)[0] || "";
      if (seg) return String(seg);
    }

    // 2) Non-hash routes: "/golf/slug/anything"
    if (!path.startsWith(GH_PAGES_BASE)) return "";
    const rest = path.slice(GH_PAGES_BASE.length);
    const seg = rest.split("/").filter(Boolean)[0] || "";
    return String(seg || "");
  } catch {
    return "";
  }
}

function readPendingCreate() {
  try {
    const raw = localStorage.getItem(LS_PENDING_CREATE);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}

function clearPendingCreate() {
  try {
    localStorage.removeItem(LS_PENDING_CREATE);
  } catch {}
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

  // Landing screen tabs (root only)
  const [landingTab, setLandingTab] = React.useState("signin"); // signin | create

  // ---- Create society (invite code) ----
  const [inviteCode, setInviteCode] = React.useState("");
  const [newSocietyName, setNewSocietyName] = React.useState("");
  const [newSocietySlug, setNewSocietySlug] = React.useState("");
  const [newSeasonLabel, setNewSeasonLabel] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const [autoCreating, setAutoCreating] = React.useState(false);

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
          .select("id, name, slug, viewer_enabled")
          .eq("slug", slug)
          .limit(1)
          .maybeSingle();

        if (error) throw error;

        if (!data) {
          if (!cancelled) setPublicSociety(null);
          return;
        }

        // Only allow public view when explicitly enabled.
        if (data.viewer_enabled === false) {
          throw new Error("This society is not publicly viewable.");
        }

        if (!cancelled) setPublicSociety(data);
      } catch (e) {
        const raw = e?.message || String(e);
        const code = e?.code || e?.error_code;
        const status = e?.status || e?.statusCode;
        const isRlsDenied = /permission denied/i.test(raw) || code === "42501" || status === 401;

        if (!cancelled && !isRlsDenied) setMsg(raw);
        if (!cancelled) setPublicSociety(null);
      } catch (ex) {
      setMsg(ex?.message || String(ex));
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

      const { preferSocietyId = "", preferSocietySlug = "" } = opts || {};

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

      const s = await client.from("societies").select("id, name, slug, viewer_enabled").in("id", ids);

      if (s.error) {
        setMsg(s.error.message);
        setTenantLoading(false);
        return;
      }

      const socs = Array.isArray(s.data) ? s.data : [];
      setSocieties(socs);

      let pick = preferSocietyId && ids.includes(String(preferSocietyId)) ? String(preferSocietyId) : "";

      const wantedSlug = String(preferSocietySlug || getSocietySlugFromUrl() || "");
      if (!pick && wantedSlug) {
        const bySlug = socs.find((x) => String(x.slug || "") === wantedSlug);
        if (bySlug && ids.includes(String(bySlug.id))) pick = String(bySlug.id);
      }

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
  // If the user is currently on a public society URL (/:slug), prefer that society
  React.useEffect(() => {
    if (!envOk) return;

    async function run() {
      const userId = session?.user?.id;
      if (!userId) return;

      const preferSocietyId = publicSociety?.id ? String(publicSociety.id) : "";
      await loadTenant(userId, preferSocietyId ? { preferSocietyId } : undefined);
    }

    run();
  }, [envOk, session?.user?.id, publicSociety?.id, loadTenant]);

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
      const role = memberships.find((m) => String(m.society_id) === String(activeSocietyId))?.role || "player";

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
      window.__activeSocietyRole = "viewer";
      window.__supabase_client__ = client;
    }
  }, [client, session?.user?.id, activeSocietyId, societies, memberships, publicSociety]);

  async function sendMagicLink(e, overrideEmail) {
    if (e?.preventDefault) e.preventDefault();
    setMsg("");

    const em = (overrideEmail ?? email ?? "").trim();
    if (!em) {
      setMsg("Enter your email.");
      return;
    }

    setBusy(true);
    try {
      const currentSlug = getSlugFromPath();
      const redirectTo = currentSlug ? `${SITE_URL}${currentSlug}` : SITE_URL;

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

  async function createSocietyAfterSignIn(pending) {
    const name = String(pending?.society_name || "").trim();
    const code = String(pending?.invite_code || "").trim();
    const slug = String(pending?.society_slug || slugify(name) || "").trim();
    const seasonLabel = String(pending?.season_label || "").trim();

    if (!name || !code) {
      clearPendingCreate();
      return;
    }

    setAutoCreating(true);
    setMsg("");

    try {
// 1) Create the society + captain membership + initial season (done server-side in the RPC)
const now = new Date();
const year = now.getFullYear();

const season_id_guess = (() => {
  const y = (seasonLabel.match(/\b(19\d{2}|20\d{2})\b/) || [])[0];
  return String(y || year);
})();

const firstSeasonName = seasonLabel || season_id_guess;

const { data, error } = await client.rpc("create_society_with_code", {
  society_name: name,
  society_slug: slug,
  invite_code: code,
  first_season_name: firstSeasonName,
});

if (error) throw error;

const newId = String(data || "");
if (!newId) throw new Error("Society create failed (no id returned).");

      // 3) Remember + jump to the society URL (so public viewers can share the link)
      setActiveSocietyId(newId);
      try {
        localStorage.setItem(LS_ACTIVE_SOCIETY, newId);
      } catch {}

      clearPendingCreate();

      // Prefer to navigate to the new society slug
      window.location.href = `${SITE_URL}${slug}`;
    } finally {
      setAutoCreating(false);
    }
  }

  async function startCreateSociety(e) {
    e.preventDefault();
    setMsg("");

    const em = (email || "").trim();
    const code = (inviteCode || "").trim();
    const name = (newSocietyName || "").trim();
    const slug = ((newSocietySlug || "") || slugify(name)).trim();
    const season = (newSeasonLabel || "").trim();

    if (!em) return setMsg("Enter your email.");
    if (!code) return setMsg("Enter your invite code.");
    if (!name) return setMsg("Enter a society name.");

    // Store for after magic-link sign-in completes
    try {
      localStorage.setItem(
        LS_PENDING_CREATE,
        JSON.stringify({
          invite_code: code,
          society_name: name,
          society_slug: slug,
          season_label: season,
        })
      );
    } catch {}

    await sendMagicLink(null, em);
    setCreating(true);
  }

  // Auto-finalise create flow: when a new user signs in and has no memberships
  React.useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    if (tenantLoading) return;
    if (memberships.length) return;
    if (autoCreating) return;

    const pending = readPendingCreate();
    if (!pending) return;

    createSocietyAfterSignIn(pending).catch((ex) => {
      setMsg(ex?.message || String(ex));
      // keep pending so they can retry
    });
  }, [session?.user?.id, memberships.length, tenantLoading, autoCreating]);

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
              activeSocietyRole={"viewer"}
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

    // No valid slug => root landing (sign in OR create society)
    return (
      <CenterCard>
        <div className="text-2xl font-black text-neutral-900">Den Golf Leagues</div>
        <div className="text-sm text-neutral-600 mt-2">Sign in as a captain, or create your own society.</div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className={`rounded-xl px-3 py-2 font-bold border ${landingTab === "signin" ? "bg-black text-white border-black" : "bg-white text-neutral-900 border-neutral-200"}`}
            onClick={() => { setMsg(""); setLandingTab("signin"); }}
          >
            Sign in
          </button>
          <button
            className={`rounded-xl px-3 py-2 font-bold border ${landingTab === "create" ? "bg-black text-white border-black" : "bg-white text-neutral-900 border-neutral-200"}`}
            onClick={() => { setMsg(""); setLandingTab("create"); }}
          >
            Create society
          </button>
        </div>

        {landingTab === "signin" ? (
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
        ) : (
          <form className="mt-4 space-y-3" onSubmit={startCreateSociety}>
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
              <div className="text-xs text-neutral-500 mt-1">We’ll email you a magic link to confirm.</div>
            </div>

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
              <div className="text-xs text-neutral-500 mt-1">Used for friendly URLs. Leave blank to auto-generate.</div>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">Initial season name (optional)</label>
              <input
                className="w-full px-3 py-2 rounded-xl border border-neutral-200 bg-white"
                value={newSeasonLabel}
                onChange={(e) => setNewSeasonLabel(e.target.value)}
                placeholder="e.g. 2026 / Winter 25-26"
              />
              <div className="text-xs text-neutral-500 mt-1">We’ll create a first season for you under the main league.</div>
            </div>

            {msg ? (
              <div className="text-sm rounded-xl px-3 py-2 border border-neutral-200 bg-neutral-50">
                {msg}
              </div>
            ) : null}

            <button
              className="w-full rounded-xl bg-black text-white px-4 py-2.5 font-bold disabled:opacity-60"
              disabled={busy || creating}
            >
              {busy ? "Sending…" : creating ? "Check your email…" : "Create society"}
            </button>

            <div className="text-xs text-neutral-500 pt-1">
              After you click the magic link, we’ll finish creating the society automatically.
            </div>
          </form>
        )}
      </CenterCard>
    );
  }

  // Logged-in modes below (captains/admins)

  if (tenantLoading || autoCreating) {
    return (
      <CenterCard>
        <div className="text-sm text-neutral-600">{autoCreating ? "Creating society…" : "Loading…"}</div>
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
    // If they arrived here after starting create, tell them what to do.
    const pending = readPendingCreate();

    return (
      <CenterCard>
        <div className="text-lg font-black text-neutral-900">{session.user.email}</div>

        {pending ? (
          <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800">
            We’re finishing your society setup. If nothing happens, refresh this page.
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            You don’t have access to any societies yet.
          </div>
        )}

        {msg ? (
          <div className="mt-3 text-sm rounded-xl px-3 py-2 border border-neutral-200 bg-neutral-50">
            {msg}
          </div>
        ) : null}

        <button
          className="mt-4 w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold"
          onClick={() => { clearPendingCreate(); setLandingTab("create"); window.location.href = SITE_URL; }}
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

  const options = (societies || [])
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  if (pickerOpen) {
    return (
      <CenterCard>
        <div className="text-xs font-black tracking-widest uppercase text-neutral-400">Choose society</div>
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
  const role = memberships.find((m) => String(m.society_id) === String(activeSocietyId))?.role || "player";

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
