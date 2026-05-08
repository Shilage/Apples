// discovery.js - Peer discovery via shared Hyperswarm topic

import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'

const DISCOVERY_TOPIC = b4a.from(
    'apples-p2p-microblog-discovery-v1'.padEnd(32, '0').slice(0, 32)
)

// remoteKeyHex -> { nick, feedKey, lastSeen }
export const discoveredPeers = new Map()

let _getNickname = () => 'anon'
let _getHomeFeedKey = () => null
let _onJoin = null

export function initDiscovery ({ teardown, getNickname, getHomeFeedKey, onJoin }) {
    _getNickname = getNickname
    _getHomeFeedKey = getHomeFeedKey
    _onJoin = onJoin

    const discoverySwarm = new Hyperswarm()
    teardown(() => discoverySwarm.destroy())
    discoverySwarm.join(DISCOVERY_TOPIC, { server: true, client: true })

    discoverySwarm.on('connection', (conn) => {
        const remoteKeyHex = b4a.toString(conn.remotePublicKey, 'hex')

        if (!discoveredPeers.has(remoteKeyHex)) {
            discoveredPeers.set(remoteKeyHex, { nick: null, feedKey: null, lastSeen: Date.now() })
        }

        announce(conn)

        conn.on('data', (data) => {
            try {
                const msg = JSON.parse(b4a.toString(data))
                if (msg.type === 'announce') {
                    discoveredPeers.set(remoteKeyHex, {
                        nick: msg.nick,
                        feedKey: msg.feedKey,
                        lastSeen: Date.now()
                    })
                    renderDiscoveryPanel()
                }
            } catch (_) {}
        })

        conn.on('close', () => {
            const peer = discoveredPeers.get(remoteKeyHex)
            if (peer) peer.lastSeen = Date.now() - 25_000
            renderDiscoveryPanel()
        })

        conn.on('error', () => {})
    })

    // Re-announce and refresh panel every 10s
    setInterval(() => {
        for (const conn of discoverySwarm.connections) announce(conn)
        renderDiscoveryPanel()
    }, 10_000)

    return discoverySwarm
}

function announce (conn) {
    const feedKey = _getHomeFeedKey()
    if (!feedKey) return
    const msg = JSON.stringify({ type: 'announce', nick: _getNickname(), feedKey })
    conn.write(b4a.from(msg))
}

export function renderDiscoveryPanel (feeds = new Map(), homeFeedKey = null) {
    const panel = document.getElementById('discovery-list')
    if (!panel) return

    panel.innerHTML = ''
    const now = Date.now()

    for (const [, info] of discoveredPeers) {
        const isOnline = (now - info.lastSeen) < 30_000
        const isFollowing = info.feedKey && feeds.has(info.feedKey)

        const row = document.createElement('div')
        row.className = 'peer-row'

        const dot = document.createElement('span')
        dot.className = 'peer-dot ' + (isOnline ? 'online' : 'seen')

        const infoDiv = document.createElement('div')
        infoDiv.className = 'peer-info'
        infoDiv.innerHTML = `
            <div class="peer-nick">${info.nick || 'Anon'}</div>
            <div class="peer-key">${(info.feedKey || '').slice(0, 16)}…</div>
        `

        const btn = document.createElement('button')
        if (isFollowing && info.feedKey !== homeFeedKey) {
            btn.textContent = '✕ Unfollow'
            btn.style.opacity = '0.7'
            btn.addEventListener('click', () => _onJoin?.({ action: 'unfollow', feedKey: info.feedKey }))
        } else if (isFollowing) {
            btn.textContent = '✓ Home'
            btn.disabled = true
        } else if (info.feedKey) {
            btn.textContent = '+ Segui'
            btn.addEventListener('click', () => _onJoin?.({ action: 'follow', feedKey: info.feedKey }))
        } else {
            btn.textContent = 'no feed'
            btn.disabled = true
        }

        row.appendChild(dot)
        row.appendChild(infoDiv)
        row.appendChild(btn)
        panel.appendChild(row)
    }

    if (discoveredPeers.size === 0) {
        panel.innerHTML = '<div class="peer-empty">Nessun peer rilevato…</div>'
    }
}
