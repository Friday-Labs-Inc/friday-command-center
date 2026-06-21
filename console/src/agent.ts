// Client for the local signing agent (holds the operator key in the OS keychain).
// The browser sends bytes to sign and never sees or stores the private key.

const AGENT = 'http://127.0.0.1:7070'

async function post(path: string, body: any) {
  const r = await fetch(`${AGENT}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`agent ${path} -> ${r.status}: ${await r.text()}`)
  return r.json()
}

export const agent = {
  async status(operator: string) {
    const r = await fetch(`${AGENT}/status/${operator}`)
    if (!r.ok) throw new Error('agent unreachable')
    return r.json()
  },
  async enroll(operator: string, privateKeyHex: string) {
    return post('/enroll', { operator, private_key_hex: privateKeyHex })
  },
  async sign(operator: string, bytesHex: string): Promise<string> {
    return (await post('/sign', { operator, bytes_hex: bytesHex })).signature
  },
}
