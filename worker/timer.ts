// Starts the GitHub job that rebuilds data.json, on Cloudflare's timer: GitHub's own
// schedule runs late, skips runs, and stops altogether after 60 days without commits.
// Every 10 minutes while Premier League matches are usually on, hourly otherwise, and
// within 10 minutes of a transfer.

import { ElementStatus } from '../src/shared/fpl-api.ts';

export interface TimerEnv {
  /** Fine-grained token with "Actions: read and write" on the repo (`wrangler secret put GITHUB_TOKEN`). */
  GITHUB_TOKEN?: string;
  /** owner/name */
  GITHUB_REPO?: string;
  /** The deployed site, whose data.json the timer checks for owners it hasn't caught up with. */
  SITE_URL?: string;
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

// Whether a waiver, free-agent signing or trade has gone through since the site's
// data.json was built. The page picks moves up from the relay, but the projected XIs
// and the odds come from the build, and the odds freeze at the deadline.
export async function ownersMoved(env: TimerEnv, league: number): Promise<boolean> {
  if (!env.SITE_URL) return false;
  try {
    const [fpl, site] = await Promise.all([
      fetch(`https://draft.premierleague.com/api/league/${league}/element-status`),
      fetch(`${env.SITE_URL}/data.json?v=${Date.now()}`), // past GitHub Pages' 10-minute cache
    ]);
    if (!fpl.ok || !site.ok) return false;
    const status = ElementStatus.parse(await fpl.json()).element_status;
    const { players } = (await site.json()) as { players: Record<string, { owner: number | null }> };
    return status.some((s) => (players[s.element]?.owner ?? null) !== s.owner);
  } catch {
    return false; // the hourly build comes anyway
  }
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
