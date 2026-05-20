// discovery.js - Peer discovery via shared Hyperswarm topic

import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'

const DISCOVERY_TOPIC = b4a.from(
    'apples-p2p-microblog-discovery-v1'.padEnd(32, '0').slice(0, 32)
)


const STALE_TIMEOUT = 2 * 60_000

export const discoveredPeers = new Map()

const persistentFollowers = new Map()

function _persistKey (homeFeedKey) {
    return 'apples.followers.' + (homeFeedKey || '').slice(0, 16)
}

function loadPersistentFollowers (homeFeedKey) {
    if (!homeFeedKey) return
    try {
        const raw = localStorage.getItem(_persistKey(homeFeedKey))
        if (!raw) return
        for (const f of JSON.parse(raw)) persistentFollowers.set(f.feedKey, f)
    } catch (_) {}
}

function savePersistentFollowers (homeFeedKey) {
    if (!homeFeedKey) return
    try {
        localStorage.setItem(_persistKey(homeFeedKey), JSON.stringify([...persistentFollowers.values()]))
    } catch (_) {}
}

let _getNickname = () => 'anon'
let _getHomeFeedKey = () => null
let _onJoin = null

export function initDiscovery ({ teardown, getNickname, getHomeFeedKey, onJoin, onPeersUpdate }) {
    _getNickname = getNickname
    _getHomeFeedKey = getHomeFeedKey
    _onJoin = onJoin

    const discoverySwarm = new Hyperswarm()
    teardown(() => discoverySwarm.destroy())
    discoverySwarm.join(DISCOVERY_TOPIC, { server: true, client: true })

    discoverySwarm.on('connection', (conn) => {
        const remoteKeyHex = b4a.toString(conn.remotePublicKey, 'hex')
        console.log('[DISCOVERY] connection from:', remoteKeyHex.slice(0, 16) + '...')

        if (!discoveredPeers.has(remoteKeyHex)) {
            discoveredPeers.set(remoteKeyHex, { nick: null, feedKey: null, lastSeen: Date.now() })
        }

        announce(conn)
        onPeersUpdate?.()

        conn.on('data', (data) => {
            try {
                const msg = JSON.parse(b4a.toString(data))
                if (msg.type === 'announce') {
                    console.log('[DISCOVERY] announce received from:', msg.nick, 'feed:', msg.feedKey?.slice(0, 16) + '...')

                    const gossipKey = 'gossip:' + msg.feedKey
                    if (discoveredPeers.has(gossipKey)) discoveredPeers.delete(gossipKey)

                    discoveredPeers.set(remoteKeyHex, {
                        nick:      msg.nick,
                        feedKey:   msg.feedKey,
                        following: Array.isArray(msg.following) ? msg.following : [],
                        lastSeen:  Date.now()
                    })

                    const myKey = _getHomeFeedKey()
                    if (myKey && msg.feedKey) {
                        const theyFollowMe = Array.isArray(msg.following) && msg.following.includes(myKey)
                        if (theyFollowMe) {
                            persistentFollowers.set(msg.feedKey, { feedKey: msg.feedKey, nick: msg.nick })
                        } else {
                            persistentFollowers.delete(msg.feedKey)
                        }
                        savePersistentFollowers(myKey)
                    }

                    if (Array.isArray(msg.knownPeers)) {
                        for (const p of msg.knownPeers) {
                            if (!p.feedKey || !p.nick) continue
                            if (p.feedKey === _getHomeFeedKey()) continue
                            const alreadyDirect = [...discoveredPeers.values()]
                                .some(e => e.feedKey === p.feedKey && !e.gossip)
                            if (alreadyDirect) continue
                            const gKey = 'gossip:' + p.feedKey
                            // Aggiorniamo (o creiamo) l'entry gossip
                            discoveredPeers.set(gKey, {
                                nick:      p.nick,
                                feedKey:   p.feedKey,
                                following: [],
                                gossip:    true,
                                lastSeen:  Date.now()
                            })
                        }
                    }

                    renderDiscoveryPanel()
                    onPeersUpdate?.()
                }
            } catch (_) {}
        })

        conn.on('close', () => {
            console.log('[DISCOVERY] connection closed:', remoteKeyHex.slice(0, 16) + '...')
            const peer = discoveredPeers.get(remoteKeyHex)
            if (peer) peer.disconnectedAt = Date.now()
            renderDiscoveryPanel()
        })

        conn.on('error', () => {})
    })


    setInterval(() => {
        for (const conn of discoverySwarm.connections) announce(conn)
        renderDiscoveryPanel()
        onPeersUpdate?.()
    }, 10_000)

    return discoverySwarm
}

function announce (conn) {
    const feedKey = _getHomeFeedKey()
    if (!feedKey) return
    const following = [..._feeds.keys()].filter(k => k !== feedKey)


    const knownPeers = []
    for (const [, info] of discoveredPeers) {
        if (info.feedKey && info.nick && !info.disconnectedAt && !info.gossip) {
            knownPeers.push({ nick: info.nick, feedKey: info.feedKey })
        }
    }

    const msg = JSON.stringify({ type: 'announce', nick: _getNickname(), feedKey, following, knownPeers })
    conn.write(b4a.from(msg))
}

let _feeds = new Map()
let _homeFeedKey = null


export function countFollowers (_homeFeedKey) {
    return persistentFollowers.size
}

export function setDiscoveryState (feeds, homeFeedKey) {
    const firstTime = !_homeFeedKey && homeFeedKey
    _feeds = feeds
    _homeFeedKey = homeFeedKey
    if (firstTime) loadPersistentFollowers(homeFeedKey)
}

export function renderDiscoveryPanel (feeds = _feeds, homeFeedKey = _homeFeedKey) {
    const panel = document.getElementById('discovery-list')
    if (!panel) return

    panel.innerHTML = ''
    const now = Date.now()

    for (const [key, info] of discoveredPeers) {
        if (info.gossip) {
            if ((now - info.lastSeen) >= STALE_TIMEOUT) discoveredPeers.delete(key)
        } else if (info.disconnectedAt && (now - info.disconnectedAt) >= STALE_TIMEOUT) {
            discoveredPeers.delete(key)
        }
    }

    const seenFeedKeys = new Map()
    for (const [, info] of discoveredPeers) {
        if (!info.feedKey) continue
        if (info.feedKey === homeFeedKey) continue
        const existing = seenFeedKeys.get(info.feedKey)
        if (!existing || info.lastSeen > existing.lastSeen) {
            seenFeedKeys.set(info.feedKey, info)
        }
    }

    const toRender = [...seenFeedKeys.values()]

    for (const info of toRender) {
        const isOnline = !info.gossip && !info.disconnectedAt && (now - info.lastSeen) < 30_000
        const isFollowing = info.feedKey && feeds.has(info.feedKey)

        const row = document.createElement('div')
        row.className = 'peer-row'

        const dot = document.createElement('span')
        // gossip = visto di recente via intermediario → trattato come "seen" (giallo), non "unknown" (grigio)
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

            const onFollow = async () => {
                btn.textContent = '✕ Unfollow'
                btn.style.opacity = '0.7'
                btn.removeEventListener('click', onFollow)
                btn.addEventListener('click', () => {
                    _onJoin?.({ action: 'unfollow', feedKey: info.feedKey })
                })
                await _onJoin?.({ action: 'follow', feedKey: info.feedKey })
            }

            btn.addEventListener('click', onFollow)
        } else {
            btn.textContent = 'no feed'
            btn.disabled = true
        }

        row.appendChild(dot)
        row.appendChild(infoDiv)
        row.appendChild(btn)
        panel.appendChild(row)
    }

    if (toRender.length === 0) {
        panel.innerHTML = '<div class="peer-empty">Nessun peer rilevato…</div>'
    }
}