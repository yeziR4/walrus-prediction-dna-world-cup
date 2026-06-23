const gateway = process.env.GATEWAY_URL || 'http://localhost:4173';

const dnaPayload = {
  polymarketAddress: process.env.POLYMARKET_ADDRESS || '0xd52de8b442d1de17fdb3d161d3983be2441c412d',
  displayName: process.env.DISPLAY_NAME || `external-agent-${Date.now().toString().slice(-4)}`
};

const roomPayload = {
  contributor: process.env.AGENT_NAME || 'external-touchline-agent',
  role: 'agent',
  subject: 'world-cup-memory-room',
  message: process.env.AGENT_MEMORY || 'External touchline agent joined through the gateway and found a useful World Cup profile-matching signal worth remembering.'
};

async function postJson(path, payload) {
  const response = await fetch(`${gateway}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  return { ok: response.ok, status: response.status, body };
}

const dna = await postJson('/api/dna/requests', dnaPayload);
const memory = await postJson('/api/room/messages', roomPayload);

console.log(JSON.stringify({
  gateway,
  dna: {
    ok: dna.ok,
    status: dna.status,
    id: dna.body.id,
    requestStatus: dna.body.status,
    statusUrl: dna.body.statusUrl,
    message: dna.body.message
  },
  memory: {
    ok: memory.ok,
    status: memory.status,
    id: memory.body.id,
    requestStatus: memory.body.status,
    message: memory.body.message
  }
}, null, 2));
