// Thin wrapper over the GitHub Contents API. The private data repository is the
// database; every Save is one commit.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status, kind = 'error') {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.kind = kind; // 'auth' | 'notfound' | 'conflict' | 'error'
  }
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeBase64(b64) {
  const binary = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function explain(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body && body.message ? ` — ${body.message}` : '';
  } catch { /* response had no JSON body */ }

  if (res.status === 401) {
    return new GitHubError(`Token rejected by GitHub${detail}. Check that it is correct and has not expired.`, 401, 'auth');
  }
  if (res.status === 403) {
    return new GitHubError(`Access denied${detail}. The token may not have permission for this repository.`, 403, 'auth');
  }
  if (res.status === 404) {
    return new GitHubError(`Not found${detail}. Check the owner, repository name and branch.`, 404, 'notfound');
  }
  if (res.status === 409 || res.status === 422) {
    return new GitHubError(`The file changed on GitHub since it was loaded${detail}.`, res.status, 'conflict');
  }
  return new GitHubError(`GitHub request failed (${res.status})${detail}`, res.status, 'error');
}

// Confirms the token can reach the repository before we do anything else.
export async function verifyAccess({ owner, repo, token }) {
  const res = await fetch(`${API}/repos/${owner}/${repo}`, {
    headers: headers(token),
    cache: 'no-store',
  });
  if (!res.ok) throw await explain(res);
  return res.json();
}

// Returns { text, sha } — text is null when the file does not exist yet.
export async function getFile({ owner, repo, path, branch, token }) {
  const url = `${API}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`;
  const res = await fetch(url, { headers: headers(token), cache: 'no-store' });

  if (res.status === 404) return { text: null, sha: null };
  if (!res.ok) throw await explain(res);

  const body = await res.json();
  if (Array.isArray(body)) {
    throw new GitHubError(`"${path}" is a folder, not a file. Point the path at a .json file.`, 400, 'error');
  }

  // Files over 1 MB come back without inline content; read the blob instead.
  if (!body.content && body.sha) {
    const blobRes = await fetch(`${API}/repos/${owner}/${repo}/git/blobs/${body.sha}`, {
      headers: headers(token),
      cache: 'no-store',
    });
    if (!blobRes.ok) throw await explain(blobRes);
    const blob = await blobRes.json();
    return { text: decodeBase64(blob.content), sha: body.sha };
  }

  return { text: decodeBase64(body.content), sha: body.sha };
}

// Creates or updates the file in a single commit. Passing the sha we loaded lets
// GitHub reject the write if someone else changed the file in the meantime.
export async function putFile({ owner, repo, path, branch, token, text, sha, message }) {
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: encodeBase64(text),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw await explain(res);
  const body = await res.json();
  return { sha: body.content.sha, commitUrl: body.commit && body.commit.html_url };
}

function encodePath(path) {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}
