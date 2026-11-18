import { createHash } from 'node:crypto'

// Minimal obs-websocket v5 client: node scripts/obs.mjs start|stop|status
const command = (process.argv[2] ?? 'status').toLowerCase()
const password = process.env.OBS_PASSWORD
if (!password) {
  console.error('set OBS_PASSWORD (obs-websocket server password) before running')
  process.exit(1)
}
const requestType = command === 'start' ? 'StartRecord' : command === 'stop' ? 'StopRecord' : 'GetRecordStatus'

const socket = new WebSocket('ws://127.0.0.1:4455')
let requestId = 0

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.op === 0) {
    const auth = message.d?.authentication
    let authentication
    if (auth) {
      const secret = createHash('sha256').update(password + auth.salt).digest('base64')
      authentication = createHash('sha256').update(secret + auth.challenge).digest('base64')
    }
    socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication } }))
    return
  }
  if (message.op === 2) {
    requestId += 1
    socket.send(JSON.stringify({
      op: 6,
      d: { requestType, requestId: String(requestId), requestData: {} },
    }))
    return
  }
  if (message.op === 7) {
    console.log(JSON.stringify({ requestType, status: message.d?.requestStatus, data: message.d?.responseData ?? {} }))
    socket.close()
    process.exit(0)
  }
})

socket.addEventListener('error', () => {
  console.error('obs websocket error (is OBS running with websocket enabled?)')
  process.exit(1)
})

setTimeout(() => {
  console.error('obs websocket timeout')
  process.exit(1)
}, 15_000)
