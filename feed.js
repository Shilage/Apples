// feed.js - Feed state, Autobase setup, follow/unfollow, post submission

import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Autobase from 'autobase'
import b4a from 'b4a'

// --- State ---
export const feeds = new Map()   // baseKeyHex -> { base, lastSeq }
export let activeFeedKey = null
export let homeFeedKey = null

let store = null
let swarm = null
let writerCore = null

// DOM refs used internally
const postsDiv = document.getElementById('posts')
const feedSelect = document.getElementById('feed-select')
const currentKeySpan = document.getElementById('current-key')
const peersCountSpan = document.getElementById('peers-count')

// Callbacks injected from app.js
let _onPeersUpdate = null
let _onFeedsUpdate = null

// --- Init ---

export async function initSwarmAndStore ({ config, teardown, onPeersUpdate, onFeedsUpdate }) {
    _onPeersUpdate = onPeersUpdate
    _onFeedsUpdate = onFeedsUpdate

    store = new Corestore(config.storage)
    await store.ready()

    swarm = new Hyperswarm()
    teardown(() => swarm.destroy())

    swarm.on('update', () => {
        console.log('[SWARM] update event - connections:', swarm.connections.size)
        peersCountSpan.textContent = swarm.connections.size
        _onPeersUpdate?.()
    })

    swarm.on('connection', (conn) => {
        console.log('[SWARM] new connection - total now:', swarm.connections.size + 1)
        store.replicate(conn)
    })

    return swarm
}

export function getSwarm () { return swarm }

async function ensureWriterCore () {
    if (writerCore) return
    writerCore = store.get({ name: 'writer', valueEncoding: 'json' })
    await writerCore.ready()
}

// --- Autobase open/apply ---

function open (autostore) {
    return autostore.get({ name: 'view', valueEncoding: 'json' })
}

async function apply (nodes, view, host) {
    for (const { value } of nodes) {
        if (!value) continue

        if (value.addWriter) {
            let v = value.addWriter
            let writerKeyBuf = null

            if (typeof v === 'string') {
                writerKeyBuf = b4a.from(v, 'hex')
            } else if (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
                writerKeyBuf = b4a.from(v.data)
            } else if (v instanceof Uint8Array) {
                writerKeyBuf = b4a.from(v)
            }

            if (writerKeyBuf) await host.addWriter(writerKeyBuf, { indexer: true })
            else console.warn('apply: addWriter with unknown format:', v)
            continue
        }

        await view.append(value)
    }
}
// --- Followed feed persistence ---

function saveFollowedFeeds () {
    try {
        const keys = []
        for (const key of feeds.keys()) {
            if (key === homeFeedKey) continue
            keys.push(key)
        }
        localStorage.setItem('apples.followedFeeds', JSON.stringify(keys))
    } catch (_) {}
}

function loadFollowedFeeds () {
    try {
        const raw = localStorage.getItem('apples.followedFeeds')
        return raw ? JSON.parse(raw) : []
    } catch (_) { return [] }
}

export async function restoreFollowedFeeds () {
    const keys = loadFollowedFeeds()
    for (const keyHex of keys) {
        try {
            const buf = b4a.from(keyHex, 'hex')
            await initFeed(buf, { makeHome: false })
        } catch (err) {
            console.warn('[restore] failed to restore feed:', keyHex, err)
        }
    }
}

// --- Post rendering ---

function appendPostToUI (post) {
    const wrapper = document.createElement('div')
    wrapper.className = 'post'

    const date = new Date(post.timestamp)
    const feedLabel = post.feed ? `[${post.feed}] ` : ''

    const header = document.createElement('div')
    header.className = 'post-header'
    header.textContent = `${date.toLocaleString()} ${feedLabel}<${post.author}>`

    const body = document.createElement('div')
    body.className = 'post-body'
    body.textContent = post.text

    wrapper.appendChild(header)
    wrapper.appendChild(body)
    postsDiv.appendChild(wrapper)
    postsDiv.scrollTop = postsDiv.scrollHeight
}

// --- Feed reading ---

async function displayNewPostsFor (baseKeyHex) {
    const state = feeds.get(baseKeyHex)
    if (!state) return

    await state.base.update()
    while (state.lastSeq < state.base.view.length) {
        const post = await state.base.view.get(state.lastSeq)
        state.lastSeq++
        if (activeFeedKey === baseKeyHex) appendPostToUI(post)
    }
}

function setupBaseListeners (baseKeyHex) {
    const state = feeds.get(baseKeyHex)
    if (!state) return
    state.base.on('update', () => {
        displayNewPostsFor(baseKeyHex).catch(console.error)
    })
}

// --- Feed select UI ---

export function refreshFeedSelect () {
    const previous = feedSelect.value
    feedSelect.innerHTML = ''

    for (const keyHex of feeds.keys()) {
        const opt = document.createElement('option')
        opt.value = keyHex
        let label = keyHex.slice(0, 16) + '…'
        if (homeFeedKey === keyHex) label = 'HOME ' + label
        opt.textContent = label
        feedSelect.appendChild(opt)
    }

    if (feeds.size === 0) {
        feedSelect.disabled = true
        currentKeySpan.textContent = ''
        return
    }

    feedSelect.disabled = false
    feedSelect.value = feeds.has(previous) ? previous : (activeFeedKey || [...feeds.keys()][0])
}

export function setActiveFeed (baseKeyHex) {
    if (!feeds.has(baseKeyHex)) return

    activeFeedKey = baseKeyHex
    currentKeySpan.textContent = baseKeyHex

    postsDiv.innerHTML = ''
    feeds.get(baseKeyHex).lastSeq = 0

    displayNewPostsFor(baseKeyHex).catch(console.error)
    if (feedSelect.value !== baseKeyHex) feedSelect.value = baseKeyHex

    _onPeersUpdate?.()
}

// --- Feed init ---

export async function initFeed (bootstrapKeyBuffer, { makeHome = false } = {}) {
    await ensureWriterCore()

    const isNew = !bootstrapKeyBuffer
    let baseStore, base, feedIdHex

    if (isNew) {
        baseStore = store.namespace('home-base')
        base = new Autobase(baseStore, null, { open, apply, valueEncoding: 'json' })
        await base.ready()

        const writerKeyHex = b4a.toString(writerCore.key, 'hex')
        await base.append({ addWriter: writerKeyHex })

        const discovery = swarm.join(base.discoveryKey)
        await discovery.flushed()

        feedIdHex = b4a.toString(base.key, 'hex')
    } else {
        const short = b4a.toString(bootstrapKeyBuffer, 'hex').slice(0, 16)
        baseStore = store.namespace('follow-' + short)
        base = new Autobase(baseStore, bootstrapKeyBuffer, { open, apply, valueEncoding: 'json' })
        await base.ready()

        const discovery = swarm.join(base.discoveryKey)
        await discovery.flushed()

        feedIdHex = b4a.toString(base.key, 'hex')
    }

    base.on('error', (err) => console.error('[autobase error]', feedIdHex, err))

    if (!feeds.has(feedIdHex)) {
        feeds.set(feedIdHex, { base, lastSeq: 0 })
        setupBaseListeners(feedIdHex)
        refreshFeedSelect()
    }

    if (makeHome && !homeFeedKey) homeFeedKey = feedIdHex

    _onFeedsUpdate?.()
    if (!makeHome) saveFollowedFeeds()
    return feedIdHex
}

// --- Unfollow ---

export async function unfollowFeed (feedKeyHex) {
    if (!feeds.has(feedKeyHex)) return
    if (feedKeyHex === homeFeedKey) {
        alert('Non puoi smettere di seguire il tuo feed home.')
        return
    }

    const state = feeds.get(feedKeyHex)
    try {
        if (state?.base?.discoveryKey) await swarm.leave(state.base.discoveryKey)
        await state?.base?.close()
    } catch (err) {
        console.warn('[unfollow] cleanup error:', err)
    }

    feeds.delete(feedKeyHex)
    saveFollowedFeeds()
    if (activeFeedKey === feedKeyHex) setActiveFeed(homeFeedKey)

    refreshFeedSelect()
    _onFeedsUpdate?.()
}

// --- Post submit ---

export async function submitPost (text, feedName, getNickname) {
    if (!homeFeedKey) return

    const state = feeds.get(homeFeedKey)
    if (!state) return

    const post = {
        text,
        author: getNickname(),
        timestamp: Date.now(),
        feed: feedName || null
    }

    await state.base.append(post)
}
