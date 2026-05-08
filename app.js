// app.js - Apples: P2P microblog on Pear Runtime
// Wires together profile, feed and discovery modules.

/** @typedef {import('pear-interface')} */
/* global Pear */

import b4a from 'b4a'
import { setupProfile, setupAvatarUpload, getNickname, updateFollowingCount, updateFollowersFromPeers } from './profile.js'
import { initSwarmAndStore, getSwarm, initFeed, setActiveFeed, unfollowFeed, submitPost, refreshFeedSelect, feeds, homeFeedKey as _hfk } from './feed.js'
import { initDiscovery, renderDiscoveryPanel } from './discovery.js'

const { teardown, config } = Pear

// --- DOM ---
const setupDiv    = document.getElementById('setup')
const loadingDiv  = document.getElementById('loading')
const feedDiv     = document.getElementById('feed')
const createBtn   = document.getElementById('create-feed')
const postForm    = document.getElementById('post-form')
const postInput   = document.getElementById('post-text')
const addFeedInput = document.getElementById('add-feed-key')
const addFeedBtn  = document.getElementById('add-feed-btn')
const feedSelect  = document.getElementById('feed-select')

// homeFeedKey is managed inside feed.js but we need to read it here
// We use a getter so we always get the current value
function getHomeFeedKey () {
    // dynamic import trick: feed.js exports a let, we re-read it via the module
    return _currentHomeFeedKey
}
let _currentHomeFeedKey = null

// --- Profile ---
setupProfile()
setupAvatarUpload()

// --- Swarm + Store ---
await initSwarmAndStore({
    config,
    teardown,
    onPeersUpdate: () => {
        updateFollowersFromPeers(getSwarm(), _currentHomeFeedKey, getCurrentActiveFeedKey())
    },
    onFeedsUpdate: () => {
        updateFollowingCount(feeds, _currentHomeFeedKey)
        renderDiscoveryPanel(feeds, _currentHomeFeedKey)
    }
})

function getCurrentActiveFeedKey () {
    // read activeFeedKey from feed.js module scope via named import
    return _currentActiveFeedKey
}
let _currentActiveFeedKey = null

// --- Discovery ---
initDiscovery({
    teardown,
    getNickname,
    getHomeFeedKey: () => _currentHomeFeedKey,
    onJoin: async ({ action, feedKey }) => {
        if (action === 'follow') {
            addFeedInput.value = feedKey
            await joinAdditionalFeed()
        } else if (action === 'unfollow') {
            await unfollowFeed(feedKey)
            renderDiscoveryPanel(feeds, _currentHomeFeedKey)
        }
    }
})

// --- High-level handlers ---

async function createFeed () {
    setupDiv.classList.add('hidden')
    loadingDiv.classList.remove('hidden')

    try {
        const baseKeyHex = await initFeed(null, { makeHome: true })
        _currentHomeFeedKey = baseKeyHex
        _currentActiveFeedKey = baseKeyHex

        loadingDiv.classList.add('hidden')
        feedDiv.classList.remove('hidden')
        setActiveFeed(baseKeyHex)
    } catch (err) {
        console.error(err)
        alert('There was an error in creating the feed')
        loadingDiv.classList.add('hidden')
        setupDiv.classList.remove('hidden')
    }
}

async function joinAdditionalFeed () {
    const keyStr = addFeedInput.value.trim()
    if (!keyStr) return

    if (feeds.has(keyStr)) {
        setActiveFeed(keyStr)
        _currentActiveFeedKey = keyStr
        addFeedInput.value = ''
        return
    }

    try {
        const bootstrapBuffer = b4a.from(keyStr, 'hex')
        await initFeed(bootstrapBuffer, { makeHome: false })
        addFeedInput.value = ''
    } catch (err) {
        console.error(err)
        alert('Error joining feed. Peer not found or mismatched key.')
    }
}

async function onPostSubmit (e) {
    e.preventDefault()
    const text = postInput.value.trim()
    if (!text) return

    const feedName = document.getElementById('feed-name')?.value.trim() || ''
    await submitPost(text, feedName, getNickname)

    postInput.value = ''
    const feedNameEl = document.getElementById('feed-name')
    if (feedNameEl) feedNameEl.value = ''
}

// --- Event listeners ---

createBtn.addEventListener('click', createFeed)
postForm.addEventListener('submit', onPostSubmit)

addFeedBtn.addEventListener('click', (e) => {
    e.preventDefault()
    joinAdditionalFeed()
})

feedSelect.addEventListener('change', () => {
    const value = feedSelect.value
    if (value) {
        setActiveFeed(value)
        _currentActiveFeedKey = value
    }
})

document.getElementById('unfollow-btn')?.addEventListener('click', () => {
    if (!_currentActiveFeedKey || _currentActiveFeedKey === _currentHomeFeedKey) return
    if (confirm(`Smettere di seguire questo feed?\n${_currentActiveFeedKey.slice(0, 32)}…`)) {
        unfollowFeed(_currentActiveFeedKey).then(() => {
            _currentActiveFeedKey = _currentHomeFeedKey
            renderDiscoveryPanel(feeds, _currentHomeFeedKey)
        })
    }
})
