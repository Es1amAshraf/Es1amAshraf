import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const LOGIN = process.env.GITHUB_ACTOR || "Es1amAshraf";
const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS_DIR = path.join(ROOT, "assets");

function resolveToken() {
  if (process.env.PROFILE_STATS_TOKEN?.trim()) {
    return { token: process.env.PROFILE_STATS_TOKEN.trim(), source: "PROFILE_STATS_TOKEN" };
  }
  if (process.env.GITHUB_TOKEN?.trim()) {
    return { token: process.env.GITHUB_TOKEN.trim(), source: "GITHUB_TOKEN" };
  }
  try {
    const cliToken = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
    if (cliToken) return { token: cliToken, source: "gh-cli" };
  } catch {
    // gh CLI not available
  }
  throw new Error("No GitHub token found (set PROFILE_STATS_TOKEN, GITHUB_TOKEN, or login via gh CLI).");
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function fetchStats(token) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        name
        login
        repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
          totalCount
          nodes {
            isPrivate
            stargazerCount
            forkCount
            defaultBranchRef {
              target {
                ... on Commit {
                  history(first: 1) {
                    totalCount
                  }
                }
              }
            }
            languages(first: 15, orderBy: { field: SIZE, direction: DESC }) {
              edges {
                size
                node { name color }
              }
            }
          }
        }
        contributionsCollection {
          totalCommitContributions
          restrictedContributionsCount
          totalPullRequestContributions
          totalIssueContributions
          contributionCalendar { totalContributions }
        }
      }
    }
  `;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Es1amAshraf-Profile-Stats-Generator"
    },
    body: JSON.stringify({ query, variables: { login: LOGIN } })
  });

  const body = await res.json();
  if (!res.ok || body.errors || !body.data?.user) {
    throw new Error(`GitHub GraphQL error: ${JSON.stringify(body.errors || body)}`);
  }

  const u = body.data.user;
  const langSizes = {};
  const langColors = {};
  let stars = 0;
  let forks = 0;
  let branchCommits = 0;
  let pubRepos = 0;
  let privRepos = 0;

  for (const repo of u.repositories.nodes) {
    stars += repo.stargazerCount || 0;
    forks += repo.forkCount || 0;
    branchCommits += repo.defaultBranchRef?.target?.history?.totalCount || 0;
    if (repo.isPrivate) privRepos++;
    else pubRepos++;

    for (const edge of repo.languages.edges) {
      langSizes[edge.node.name] = (langSizes[edge.node.name] || 0) + edge.size;
      langColors[edge.node.name] = edge.node.color || "#8b949e";
    }
  }

  const totalBytes = Object.values(langSizes).reduce((a, b) => a + b, 0) || 1;
  const sortedLangs = Object.entries(langSizes)
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes]) => ({
      name,
      bytes,
      pct: (bytes / totalBytes) * 100,
      color: langColors[name]
    }));

  const cc = u.contributionsCollection;
  return {
    displayName: u.name || u.login,
    scope: privRepos > 0 ? "public+private" : "public-only",
    pubRepos,
    privRepos,
    totalRepos: u.repositories.totalCount,
    stars,
    forks,
    branchCommits,
    contributionsYear: cc.contributionCalendar?.totalContributions || 0,
    prsAndIssues: (cc.totalPullRequestContributions || 0) + (cc.totalIssueContributions || 0),
    sortedLangs,
    updatedDate: new Date().toISOString().slice(0, 10)
  };
}

function renderStatsSvg(stats) {
  const scopeLabel = stats.scope === "public+private" ? `All ${stats.totalRepos} Repos (Public + Private)` : "Public Repos";
  const rows = [
    {
      label: "Total Stars Earned:",
      value: String(stats.stars),
      icon: `<path fill-rule="evenodd" d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>`
    },
    {
      label: "Total Commits (Default Branches):",
      value: String(stats.branchCommits),
      icon: `<path fill-rule="evenodd" d="M10.5 7.75a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm1.43.75a4.002 4.002 0 01-7.86 0H.75a.75.75 0 110-1.5h3.32a4.001 4.001 0 017.86 0h3.32a.75.75 0 110 1.5h-3.32z"/>`
    },
    {
      label: "Repositories (Public / Private):",
      value: `${stats.pubRepos} / ${stats.privRepos}`,
      icon: `<path fill-rule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z"/>`
    },
    {
      label: "Contributions (Last 12 Months):",
      value: String(stats.contributionsYear),
      icon: `<path fill-rule="evenodd" d="M4.75 0a.75.75 0 01.75.75V2h5V.75a.75.75 0 011.5 0V2h1.25c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0113.25 16H2.75A1.75 1.75 0 011 14.25V3.75C1 2.784 1.784 2 2.75 2H4V.75A.75.75 0 014.75 0zm0 3.5h-2a.25.25 0 00-.25.25V6h11V3.75a.25.25 0 00-.25-.25H4.75zm-2.25 4v6.75c0 .138.112.25.25.25h10.5a.25.25 0 00.25-.25V7.5h-11z"/>`
    },
    {
      label: "PRs &amp; Issues Contributed:",
      value: String(stats.prsAndIssues),
      icon: `<path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>`
    }
  ];

  const rowsXml = rows
    .map((r, i) => {
      const y = 63 + i * 24;
      return `
  <g transform="translate(25, ${y})">
    <svg x="0" y="-12" width="15" height="15" viewBox="0 0 16 16" fill="#bf91f3">${r.icon}</svg>
    <text x="23" y="0" class="stat-label">${r.label}</text>
    <text x="295" y="0" text-anchor="end" class="stat-value">${escapeXml(r.value)}</text>
  </g>`;
    })
    .join("");

  const r = 38;
  const circ = 2 * Math.PI * r;
  const dashOffset = (circ * 0.18).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" fill="none" role="img" aria-label="${escapeXml(stats.displayName)}'s GitHub Stats">
  <!-- stats-scope: ${stats.scope} -->
  <style>
    .title { font: 700 17px 'Segoe UI', Ubuntu, Sans-Serif; fill: #70a5fd; }
    .stat-label { font: 600 12.5px 'Segoe UI', Ubuntu, Sans-Serif; fill: #38bdae; }
    .stat-value { font: 700 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: #a9b1d6; }
    .ring-num { font: 800 22px 'Segoe UI', Ubuntu, Sans-Serif; fill: #70a5fd; }
    .ring-sub { font: 600 10.5px 'Segoe UI', Ubuntu, Sans-Serif; fill: #38bdae; }
    .foot { font: 500 9.5px 'Segoe UI', Ubuntu, Sans-Serif; fill: #565f89; }
  </style>
  <rect x="0.5" y="0.5" width="494" height="194" rx="4.5" fill="#1a1b27" stroke="#2f3549" stroke-opacity="0.55"/>
  <text x="25" y="34" class="title">${escapeXml(stats.displayName)}&apos;s GitHub Stats</text>
  ${rowsXml}
  <g transform="translate(415, 98)">
    <circle cx="0" cy="0" r="${r}" fill="none" stroke="#70a5fd" stroke-opacity="0.2" stroke-width="6"/>
    <circle cx="0" cy="0" r="${r}" fill="none" stroke="#bf91f3" stroke-width="6" stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${dashOffset}" transform="rotate(-90)"/>
    <text x="0" y="3" text-anchor="middle" class="ring-num">${escapeXml(stats.branchCommits)}</text>
    <text x="0" y="18" text-anchor="middle" class="ring-sub">Commits</text>
  </g>
  <text x="472" y="183" text-anchor="end" class="foot">${escapeXml(scopeLabel)} · ${stats.updatedDate}</text>
</svg>
`;
}

function renderTopLangsSvg(stats) {
  const top = stats.sortedLangs.slice(0, 8);
  const shownPct = top.reduce((s, l) => s + l.pct, 0);
  const segments = [...top];
  if (shownPct < 99.95) {
    segments.push({ name: "Other", pct: Math.max(0, 100 - shownPct), color: "#565f89" });
  }

  const barWidth = 445;
  let xCursor = 0;
  const barRects = segments
    .map((seg, i) => {
      const remaining = Math.max(0, barWidth - xCursor);
      const w = i === segments.length - 1 ? remaining : Math.min(remaining, Math.max(1.2, (seg.pct / 100) * barWidth));
      const rect = `<rect x="${xCursor.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="9" fill="${escapeXml(seg.color)}"/>`;
      xCursor += w;
      return rect;
    })
    .join("");

  const legendXml = top
    .map((lang, i) => {
      const col = i < 4 ? 0 : 1;
      const row = i % 4;
      const x = col === 0 ? 25 : 262;
      const y = 89 + row * 22;
      return `
  <g transform="translate(${x}, ${y})">
    <circle cx="5" cy="-4" r="5" fill="${escapeXml(lang.color)}" stroke="#ffffff" stroke-opacity="0.22" stroke-width="0.7"/>
    <text x="16" y="0" class="lang-name">${escapeXml(lang.name)} <tspan class="lang-pct">${lang.pct.toFixed(2)}%</tspan></text>
  </g>`;
    })
    .join("");

  const scopeLabel = stats.scope === "public+private" ? `All ${stats.totalRepos} Repos (Public + Private)` : "Public Repos";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195" fill="none" role="img" aria-label="Most Used Languages">
  <!-- stats-scope: ${stats.scope} -->
  <style>
    .title { font: 700 17px 'Segoe UI', Ubuntu, Sans-Serif; fill: #70a5fd; }
    .lang-name { font: 600 12.5px 'Segoe UI', Ubuntu, Sans-Serif; fill: #a9b1d6; }
    .lang-pct { font: 600 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: #38bdae; }
    .foot { font: 500 9.5px 'Segoe UI', Ubuntu, Sans-Serif; fill: #565f89; }
  </style>
  <defs>
    <clipPath id="bar-clip">
      <rect x="0" y="0" width="${barWidth}" height="9" rx="4.5"/>
    </clipPath>
  </defs>
  <rect x="0.5" y="0.5" width="494" height="194" rx="4.5" fill="#1a1b27" stroke="#2f3549" stroke-opacity="0.55"/>
  <text x="25" y="34" class="title">Most Used Languages</text>
  <g transform="translate(25, 52)" clip-path="url(#bar-clip)">
    ${barRects}
  </g>
  ${legendXml}
  <text x="472" y="183" text-anchor="end" class="foot">${escapeXml(scopeLabel)} · ${stats.updatedDate}</text>
</svg>
`;
}

async function main() {
  const { token, source } = resolveToken();
  const stats = await fetchStats(token);
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const statsSvgPath = path.join(ASSETS_DIR, "github-stats.svg");
  const langsSvgPath = path.join(ASSETS_DIR, "top-langs.svg");

  const existingHadPrivate =
    fs.existsSync(langsSvgPath) &&
    fs.readFileSync(langsSvgPath, "utf8").includes("<!-- stats-scope: public+private -->");

  if (stats.scope === "public-only" && existingHadPrivate && process.env.ALLOW_PUBLIC_DOWNGRADE !== "1") {
    console.log(`Token source (${source}) only returned public repos while existing cards include private repos; keeping existing public+private SVG cards untouched. Add secrets.PROFILE_STATS_TOKEN with repo scope for unattended private stats refresh.`);
    return;
  }

  fs.writeFileSync(statsSvgPath, renderStatsSvg(stats), "utf8");
  fs.writeFileSync(langsSvgPath, renderTopLangsSvg(stats), "utf8");
  console.log(`Generated ${stats.scope} SVG cards via ${source}: repos=${stats.totalRepos} (${stats.pubRepos} pub / ${stats.privRepos} priv), branchCommits=${stats.branchCommits}, contribs1y=${stats.contributionsYear}, topLang=${stats.sortedLangs[0]?.name} ${stats.sortedLangs[0]?.pct.toFixed(2)}%`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
