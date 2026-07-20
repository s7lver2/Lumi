// apps/web/lib/datasets/github.ts

const GITHUB_API = "https://api.github.com";

// Next.js's extended fetch() caches GET responses by default in the App
// Router. Every read here reflects GitHub state this same module just
// mutated (or that changes via publish/install elsewhere) — caching any of
// them risks permanently serving a stale response (e.g. an empty catalog
// listing cached before a release existed, never refreshing without a
// server restart). Applied to every fetch call in this file, reads and
// writes alike, for consistency and to close the whole class of bug (same
// fix as apps/web/lib/model-catalog/github.ts).
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

/** Creates the repo (under the token's own account) if it doesn't exist
 * yet, then adds the `lumi-dataset` topic without clobbering any topics
 * already on the repo (GitHub's "replace topics" endpoint requires the
 * full list, so this reads first). */
export async function ensureRepoWithTopic(owner: string, repo: string, token: string): Promise<void> {
  const getRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: authHeaders(token), ...NO_STORE });
  if (getRes.status === 404) {
    const createRes = await fetch(`${GITHUB_API}/user/repos`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      // auto_init: a brand-new repo has zero commits and therefore no
      // default branch — upsertRelease's create-release call has no ref to
      // point at and fails with 422 unless a first commit exists (same fix
      // as apps/web/lib/model-catalog/github.ts).
      body: JSON.stringify({ name: repo, private: false, auto_init: true }),
    });
    if (!createRes.ok) throw new Error(`Failed to create repo ${owner}/${repo}: ${createRes.status}`);
  } else if (!getRes.ok) {
    throw new Error(`Failed to check repo ${owner}/${repo}: ${getRes.status}`);
  }

  const topicsRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/topics`, { headers: authHeaders(token), ...NO_STORE });
  const current: string[] = topicsRes.ok ? ((await topicsRes.json()) as { names: string[] }).names ?? [] : [];
  if (!current.includes("lumi-dataset")) {
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}/topics`, {
      method: "PUT",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ names: [...current, "lumi-dataset"] }),
    });
  }
}

/** Overwrites any existing release with the same tag (delete then
 * recreate) before creating it fresh and uploading its assets — matches
 * the spec's "same model+version republished overwrites that release"
 * rule. */
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
      // BodyInit as typed here rejects Buffer (a lib.dom.d.ts vs Node Buffer
      // mismatch) — see apps/web/app/api/areas/export/route.ts for the same cast.
      body: asset.data as unknown as BodyInit,
    });
    if (!uploadRes.ok) throw new Error(`Failed to upload asset ${asset.name}: ${uploadRes.status}`);
  }
}

// Unauthenticated GitHub API reads are capped at 60 req/hour — trivially
// exhausted by normal iteration (confirmed live: repeated catalog reads
// during development burned through it, and 403'd every read call after —
// same fix as apps/web/lib/model-catalog/github.ts). An authenticated
// request (even for public data) gets 5000/hour, so every read here
// accepts an optional token and uses it when the caller has one.
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

/** `assetApiUrl` is a release asset's own API `url` (from listReleasesForRepo),
 * which requires `Accept: application/octet-stream` to return raw bytes
 * instead of asset metadata JSON. `token` is optional — public repos'
 * release assets are downloadable unauthenticated, but passing a token
 * avoids the stricter unauthenticated rate limit. */
export async function downloadReleaseAsset(assetApiUrl: string, token?: string): Promise<Buffer> {
  const headers: Record<string, string> = { accept: "application/octet-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(assetApiUrl, { headers, ...NO_STORE });
  if (!res.ok) throw new Error(`Failed to download asset: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface UserRepository {
  owner: string;
  repo: string;
  private: boolean;
  description: string | null;
}

/** Extracts the `rel="next"` URL from a GitHub `Link` response header, or
 * null on the last page (GitHub's own pagination convention — no `next`
 * relation once there's nothing left). */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const nextPart = linkHeader.split(",").map((part) => part.trim()).find((part) => part.endsWith('rel="next"'));
  if (!nextPart) return null;
  const match = nextPart.match(/^<([^>]+)>/);
  return match ? match[1] : null;
}

/** Every repo the token has write access to — own account plus any
 * organization membership — paginated via the `Link` header since a
 * single `per_page` request caps at 100. Used to back the dataset-publish
 * repo picker (spec: docs/superpowers/specs/2026-07-20-dataset-publish-repo-picker-design.md). */
export async function listUserRepositories(token: string): Promise<UserRepository[]> {
  const results: UserRepository[] = [];
  let url: string | null = `${GITHUB_API}/user/repos?affiliation=owner,collaborator,organization_member&per_page=100`;

  while (url) {
    const res: Response = await fetch(url, { headers: authHeaders(token), ...NO_STORE });
    if (!res.ok) throw new Error(`Failed to list user repos: ${res.status}`);
    const body = (await res.json()) as Array<{
      owner: { login: string };
      name: string;
      private: boolean;
      description: string | null;
    }>;
    results.push(...body.map((r) => ({ owner: r.owner.login, repo: r.name, private: r.private, description: r.description })));
    url = parseNextLink(res.headers.get("link"));
  }

  return results;
}

/** The username the given token belongs to — a typed "create new repo"
 * name in the picker always creates under this login (GitHub's
 * `POST /user/repos` has no way to target an org). */
export async function getAuthenticatedLogin(token: string): Promise<string> {
  const res = await fetch(`${GITHUB_API}/user`, { headers: authHeaders(token), ...NO_STORE });
  if (!res.ok) throw new Error(`Failed to fetch authenticated user: ${res.status}`);
  const body = (await res.json()) as { login: string };
  return body.login;
}