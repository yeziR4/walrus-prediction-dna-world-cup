const DATA_API = 'https://data-api.polymarket.com';

export async function buildPolymarketDna(address, displayName, fetchImpl = fetch) {
  const wallet = encodeURIComponent(address);
  const positions = await fetchJson(`${DATA_API}/positions?user=${wallet}&sizeThreshold=0&limit=500`, fetchImpl);
  const closed = [];
  let closedReadWarning = null;
  // Closed positions are capped at 50 per response. Fetch sequentially instead
  // of in parallel: heavy wallets can make Polymarket return 408 for one page,
  // and one slow page should not kill an otherwise useful DNA profile.
  for (let offset = 0; offset < 1_000; offset += 50) {
    try {
      const page = await fetchJson(`${DATA_API}/closed-positions?user=${wallet}&limit=50&offset=${offset}`, fetchImpl);
      closed.push(...page.map(item => ({ ...item, source: 'closed' })));
      if (page.length < 50) break;
    } catch (error) {
      closedReadWarning = `Closed Polymarket history stopped at offset ${offset}: ${error.message}`;
      break;
    }
  }
  return analyzeWorldCupPositions([...positions, ...closed], { address, displayName, metadata: closedReadWarning ? { closedReadWarning } : undefined });
}

async function fetchJson(url, fetchImpl) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'Prediction-DNA/1.0' }, signal: AbortSignal.timeout(25_000) });
      if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < 3) {
        await sleep(attempt * 700);
        continue;
      }
      if (!response.ok) throw new Error(`Polymarket returned HTTP ${response.status}.`);
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error('Polymarket returned an unexpected response.');
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 700);
    }
  }
  throw lastError;
}

export function analyzeWorldCupPositions(positions, { address, displayName, metadata } = {}) {
  const worldCup = positions.filter(isWorldCupPosition).map(normalizePosition);
  const unique = [...new Map(worldCup.map(item => [`${item.conditionId}:${item.asset}`, item])).values()];
  const resolved = unique.filter(item => item.status !== 'open');
  const wins = resolved.filter(item => item.status === 'win');
  const avgConfidence = average(resolved.map(item => item.confidence));
  const winRate = resolved.length ? (wins.length / resolved.length) * 100 : 0;
  const calibrationGap = resolved.length ? avgConfidence - winRate : null;
  const grouped = new Map();
  for (const item of resolved) {
    const group = grouped.get(item.marketType) || { name: item.marketType, n: 0, wins: 0 };
    group.n += 1; if (item.status === 'win') group.wins += 1; grouped.set(item.marketType, group);
  }
  const marketTypes = [...grouped.values()].map(item => ({ name: item.name, n: item.n, winRate: round((item.wins / item.n) * 100, 1) })).sort((a, b) => b.n - a.n);
  const playerGoalShare = unique.length ? unique.filter(item => item.marketType === 'player_goals').length / unique.length : 0;
  const noGoalShare = unique.length ? unique.filter(item => item.marketType === 'player_goals' && item.selection.toLowerCase() === 'no').length / unique.length : 0;
  const strongest = marketTypes.filter(item => item.n >= 2).sort((a, b) => b.winRate - a.winRate)[0];
  const traits = [];
  if (noGoalShare >= 0.3) traits.push('Goalscorer skeptic');
  if (avgConfidence && avgConfidence < 48) traits.push('Contrarian leaning');
  if (strongest) traits.push(`${titleCase(strongest.name)} edge`);
  if (calibrationGap !== null) traits.push(calibrationGap < -5 ? 'Underconfident' : calibrationGap > 5 ? 'Overconfident' : 'Tightly calibrated');
  if (!resolved.length) traits.push('Emerging sample', 'Awaiting outcomes', `${titleCase(unique[0]?.marketType || 'World Cup')} explorer`);
  const archetype = !resolved.length ? 'The Emerging Scout' : playerGoalShare >= 0.45 ? 'The Goalscorer Skeptic' : avgConfidence < 45 ? 'The Contrarian Scout' : 'The Market Cartographer';
  return {
    schemaVersion: '1.0', source: 'Polymarket public data API', generatedAt: new Date().toISOString(),
    address: address?.toLowerCase(), displayName: displayName?.trim() || shorten(address), archetype,
    summary: { totalWorldCupPositions: unique.length, resolved: resolved.length, open: unique.length - resolved.length, winRate: round(winRate, 1), avgConfidence: round(avgConfidence, 1), calibrationGap: calibrationGap === null ? null : round(calibrationGap, 1), reliability: reliability(resolved.length) },
    traits: traits.slice(0, 3), marketTypes,
    predictions: unique.sort((a, b) => String(b.endDate).localeCompare(String(a.endDate))),
    metadata: metadata || {}
  };
}

export function isWorldCupPosition(position) {
  const slug = String(position.slug || '').toLowerCase();
  const eventSlug = String(position.eventSlug || '').toLowerCase();
  const title = String(position.title || '').toLowerCase();
  const text = `${slug} ${eventSlug} ${title}`;
  if (/^fifwc-/i.test(slug) || /^fifwc-/i.test(eventSlug)) return true;
  if (/\b(icc|t20|cricket)\b/.test(text)) return false;
  return /^world-cup-/i.test(slug) || /^world-cup-/i.test(eventSlug) || /\bfifa\b.*\bworld cup\b/.test(text) || /\bworld cup goals h2h\b/.test(text);
}

function normalizePosition(position) {
  const resolved = position.redeemable === true || position.closed === true || position.source === 'closed';
  return {
    conditionId: position.conditionId, asset: position.asset, title: position.title || position.slug,
    eventSlug: position.eventSlug || '', slug: position.slug || '', selection: position.outcome || 'Unknown',
    confidence: round(Number(position.avgPrice || 0) * 100, 1),
    status: resolved ? Number(position.curPrice) >= 0.5 ? 'win' : 'loss' : 'open',
    marketType: classifyMarket(position), endDate: position.endDate || null,
    receipt: position.conditionId ? `https://polymarket.com/event/${position.eventSlug || position.slug}` : null,
    icon: position.icon || null
  };
}

function classifyMarket(position) {
  const text = `${position.slug || ''} ${position.eventSlug || ''} ${position.title || ''}`.toLowerCase();
  if (/goals-.+-gte|goalscorer|\d\+ goals/.test(text)) return 'player_goals';
  if (/exact-score/.test(text)) return 'exact_score';
  if (/both-teams|btts/.test(text)) return 'both_teams_score';
  if (/team-total/.test(text)) return 'team_total';
  if (/first-to-score/.test(text)) return 'first_to_score';
  if (/spread|handicap/.test(text)) return 'spread';
  if (/over-under|o\/u|total/.test(text)) return 'over_under';
  if (/winner|moneyline|to win/.test(text)) return 'match_winner';
  return 'match_prop';
}

function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function round(value, places) { const factor = 10 ** places; return Math.round((value + Number.EPSILON) * factor) / factor; }
function shorten(address) { return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Anonymous fan'; }
function titleCase(value) { return String(value).replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase()); }
function reliability(n) { return n === 0 ? 'No resolved sample' : n < 10 ? 'Early signal' : n < 30 ? 'Emerging profile' : 'Established signal'; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
