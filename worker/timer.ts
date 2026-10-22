// Starts the GitHub job that rebuilds data.json, on Cloudflare's timer: GitHub's own
// schedule runs late, skips runs, and stops altogether after 60 days without commits.
// Every 10 minutes while Premier League matches are usually on, hourly otherwise.

export interface TimerEnv {
  /** Fine-grained token with "Actions: read and write" on the repo (`wrangler secret put GITHUB_TOKEN`). */
  GITHUB_TOKEN?: string;
  /** owner/name */
  GITHUB_REPO?: string;
}

// UTC, in both BST and GMT: Saturday, Sunday, and weekday evenings (Friday and Monday
// games and midweek rounds). The timer fires every 10 minutes; outside these windows
// only the first firing of each hour starts a build.
export function buildDue(at: Date): boolean {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  const matchWindow =
    (day === 6 && hour >= 11 && hour <= 21) ||
    (day === 0 && hour >= 11 && hour <= 20) ||
    (day >= 1 && day <= 5 && hour >= 18 && hour <= 21);
  return matchWindow || at.getUTCMinutes() < 10;
}

export async function startBuild(env: TimerEnv): Promise<Response | null> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return null;
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/update.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cloudflare-worker', // GitHub's API refuses requests without one
    },
    body: JSON.stringify({ ref: 'main', inputs: { trigger: 'timer' } }),
  });
}
