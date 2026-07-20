// apps/web/lib/model-catalog/github.ts

const GITHUB_API = "https://api.github.com";

// Next.js's extended fetch() caches GET responses by default in the App
// Router. Every read here reflects GitHub state this same module just
// mutated (or that changes via publish/install elsewhere) — caching any of
// them risks permanently serving a stale response (e.g. an empty catalog
// listing cached before a release existed, never refreshing without a
// server restart). Applied to every fetch call in this file, reads and
// writes alike, for consistency and to close the whole class of bug.
const NO_STORE = { cache: "no-store" as const };

export interface GithubReleaseAsset {
  name: string;
  url: string;
}

export interface GithubRelease {
  tagName: string;
  name: string;
  body: string;
  assets: GithubReleaseAsset[];
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

export async function ensureRepoWithTopic(owner: string, repo: string, token: string): Promise<void> {
  const getRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: authHeaders(token), ...NO_STORE });
  if (getRes.status === 404) {
    const createRes = await fetch(`${GITHUB_API}/user/repos`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      // auto_init: a brand-new repo has zero commits and therefore no
      // default branch — upsertRelease's create-release call has no ref to
      // point at and fails with 422 unless a first commit exists.
      body: JSON.stringify({ name: repo, private: false, auto_init: true }),
    });
    if (!createRes.ok) throw new Error(`Failed to create repo ${owner}/${repo}: ${createRes.status}`);
  } else if (!getRes.ok) {
    throw new Error(`Failed to check repo ${owner}/${repo}: ${getRes.status}`);
  } else {
    // Repo already existed (created by hand, or by a run of this function
    // predating the auto_init fix above) — if it still has zero commits,
    // there's no default branch for upsertRelease's create-release call to
    // point at, and it fails with 422. GitHub returns 409 for /commits on an
    // empty repo; repair it with a first commit via the Contents API.
    const commitsRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits`, { headers: authHeaders(token), ...NO_STORE });
    if (commitsRes.status === 409) {
      const initRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/README.md`, {
        method: "PUT",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({
          message: "Initial commit",
          content: Buffer.from(`# ${repo}\n`).toString("base64"),
        }),
      });
      if (!initRes.ok) throw new Error(`Failed to initialize empty repo ${owner}/${repo}: ${initRes.status}`);
    }
  }

  const topicsRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/topics`, { headers: authHeaders(token), ...NO_STORE });
  const current: string[] = topicsRes.ok ? ((await topicsRes.json()) as { names: string[] }).names ?? [] : [];
  if (!current.includes("lumi-model-catalog")) {
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}/topics`, {
      method: "PUT",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ names: [...current, "lumi-model-catalog"] }),
    });
  }
}

export async function upsertRelease(
  owner: string,
  repo: string,
  tag: string,
  title: string,
  assets: { name: string; data: Buffer }[],
  token: string
): Promise<void> {
  const existing = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases/tags/${tag}`, {
    headers: authHeaders(token),
    ...NO_STORE,
  });
  if (existing.ok) {
    const { id } = (await existing.json()) as { id: number };
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases/${id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
  }

  const createRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases`, {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ tag_name: tag, name: title, draft: false, prerelease: false }),
  });
  if (!createRes.ok) throw new Error(`Failed to create release ${tag}: ${createRes.status}`);
  const release = (await createRes.json()) as { upload_url: string };
  const uploadBase = release.upload_url.replace(/\{.*\}$/, "");

  for (const asset of assets) {
    const uploadRes = await fetch(`${uploadBase}?name=${encodeURIComponent(asset.name)}`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/octet-stream" },
      // BodyInit as typed here rejects Buffer (lib.dom.d.ts vs Node Buffer
      // mismatch) — see apps/web/lib/datasets/github.ts's identical cast.
      body: asset.data as unknown as BodyInit,
    });
    if (!uploadRes.ok) throw new Error(`Failed to upload asset ${asset.name}: ${uploadRes.status}`);
  }
}

// Unauthenticated GitHub API reads are capped at 60 req/hour — trivially
// exhausted by normal iteration (confirmed live: repeated catalog reads
// during development burned through it, and 403'd every read call after).
// An authenticated request (even for public data) gets 5000/hour, so every
// read here accepts an optional token and uses it when the caller has one.
function readHeaders(token?: string): Record<string, string> {
  return token ? authHeaders(token) : { accept: "application/vnd.github+json" };
}

export async function listReleasesForRepo(owner: string, repo: string, token?: string): Promise<GithubRelease[]> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases`, {
    headers: readHeaders(token),
    ...NO_STORE,
  });
  if (!res.ok) throw new Error(`Failed to list releases for ${owner}/${repo}: ${res.status}`);
  const body = (await res.json()) as Array<{
    tag_name: string;
    name: string;
    body: string | null;
    assets: Array<{ name: string; url: string }>;
  }>;
  return body.map((r) => ({
    tagName: r.tag_name,
    name: r.name,
    body: r.body ?? "",
    assets: r.assets.map((a) => ({ name: a.name, url: a.url })),
  }));
}

export async function searchRepositoriesByTopic(topic: string, token?: string): Promise<{ owner: string; repo: string }[]> {
  const res = await fetch(`${GITHUB_API}/search/repositories?q=${encodeURIComponent(`topic:${topic}`)}`, {
    headers: readHeaders(token),
    ...NO_STORE,
  });
  if (!res.ok) throw new Error(`GitHub search failed: ${res.status}`);
  const body = (await res.json()) as { items: Array<{ owner: { login: string }; name: string }> };
  return body.items.map((item) => ({ owner: item.owner.login, repo: item.name }));
}

export async function downloadReleaseAsset(assetApiUrl: string, token?: string): Promise<Buffer> {
  const headers: Record<string, string> = { accept: "application/octet-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(assetApiUrl, { headers, ...NO_STORE });
  if (!res.ok) throw new Error(`Failed to download asset: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
