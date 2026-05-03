// Apples: a Microblogging app using Pear Runtime, Corestore, Autobase and Hyperswarm.

/** @typedef {import('pear-interface')} */
/* global Pear libraries */

import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Autobase from 'autobase'
import b4a from 'b4a'

const { teardown, updates, config } = Pear

console.log('Pear storage path:', config.storage)

// --- DOM --- //

const setupDiv = document.getElementById('setup')
const loadingDiv = document.getElementById('loading')
const feedDiv = document.getElementById('feed')
const postsDiv = document.getElementById('posts')

const peersCountSpan = document.getElementById('peers-count')
const currentKeySpan = document.getElementById('current-key')

const createBtn = document.getElementById('create-feed')

//const feedNameInput = document.getElementById('feed-name')
const postForm = document.getElementById('post-form')
const postInput = document.getElementById('post-text')

const feedSelect = document.getElementById('feed-select')
const addFeedInput = document.getElementById('add-feed-key')
const addFeedBtn = document.getElementById('add-feed-btn')

const avatarBox = document.getElementById('avatar-placeholder')
const avatarInput = document.getElementById('avatar-input')
const nicknameSpan = document.getElementById('nickname')
const followersSpan = document.getElementById('followers-count')
const followingSpan = document.getElementById('following-count')

// --- Userprofile creation and management: nickname, stats

//function for generating a random Nickname, like used in other social applications
function generateRandomNickname () {
    const adjectives = ['Silent', 'Happy', 'Cosmic', 'Neon', 'Swift', 'Lucky', 'Clever', 'Velvet', 'Rusty', 'Quantum']
    const nouns = ['Apple', 'Sentry', 'Comet', 'Circuit', 'Panda', 'Falcon', 'Pixel', 'Nova', 'Echo', 'Forest']

    const a = adjectives[Math.floor(Math.random() * adjectives.length)]
    const n = nouns[Math.floor(Math.random() * nouns.length)]
    const num = String(Math.floor(Math.random() * 10000)).padStart(4, '0')

    return `${a}-${n}${num}`
}

//function for managing the profile structure
// for this example, we're using the local browser's
// storage for storing pfps and other media but could be uppgraded

function setupProfile () {
    let nick = null
    try {
        nick = localStorage.getItem('apples.nickname')
    } catch (_) {}

    if (!nick) {
        nick = generateRandomNickname()
        try {
            localStorage.setItem('apples.nickname', nick)
        } catch (_) {}
    }

    if (nicknameSpan) nicknameSpan.textContent = nick

    try {
        const avatarData = localStorage.getItem('apples.avatar')
        if (avatarData && avatarBox) {
            avatarBox.style.backgroundImage = `url(${avatarData})`
        }
    } catch (_) {}
}

// function for managing the avatar uploading
function setupAvatarUpload () {
    if (!avatarBox || !avatarInput) return

    avatarBox.addEventListener('click', () => {
        avatarInput.click()
    })

    avatarInput.addEventListener('change', (e) => {
        const file = e.target.files[0]
        if (!file) return

        const reader = new FileReader()
        reader.onload = (ev) => {
            const dataUrl = ev.target.result
            avatarBox.style.backgroundImage = `url(${dataUrl})`
            try {
                localStorage.setItem('apples.avatar', dataUrl)
            } catch (_) {}
        }
        reader.readAsDataURL(file)
    })
}

//functions that manage the followers/following count
function updateFollowingCount () {
    if (!followingSpan) return
    let count = 0
    for (const key of feeds.keys()) {
        if (homeFeedKey && key === homeFeedKey) continue
        count++
    }
    followingSpan.textContent = String(count)
}

function updateFollowersFromPeers () {
    if (!followersSpan) return

    if (!homeFeedKey || !activeFeedKey || activeFeedKey !== homeFeedKey) {
        followersSpan.textContent = '0'
        return
    }

    followersSpan.textContent = String(swarm.connections.size)
}

// --- Corestore + Swarm --- //

//Defining corestores and swarm connections
const store = new Corestore(config.storage)
await store.ready()

const swarm = new Hyperswarm()
teardown(() => swarm.destroy())

swarm.on('connection', (conn) => store.replicate(conn))
swarm.on('update', () => {
    const peers = swarm.connections.size
    peersCountSpan.textContent = peers
    updateFollowersFromPeers()
})

// hot reload in dev - commented because not needed
// updates(() => Pear.reload())

// --- Defining writer's identity in a multi-writer setup ---

let writerCore = null

async function ensureWriterCore () {
    if (writerCore) return
    writerCore = store.get({ name: 'writer', valueEncoding: 'json' })
    await writerCore.ready()
}

// --- Multi-feed state ---

// baseKeyHex -> { base, lastSeq }
const feeds = new Map()
let activeFeedKey = null      //key of the active feed in the view
let homeFeedKey = null        //key of the home feed

//Initialize profile's structure in UI
setupProfile()
setupAvatarUpload()

// --- Autobase handlers --- //

// Function for getting the autobase's view, essentially opening it
function open (autostore) {
    return autostore.get({ name: 'view', valueEncoding: 'json' })
}

// Function that manages multiple writers in multiple nodes and views
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

            if (writerKeyBuf) {
                await host.addWriter(writerKeyBuf, { indexer: true })
            } else {
                console.warn('apply: addWriter with unknown format:', v)
            }
            continue
        }

        await view.append(value)
    }
}

// --- Rendering post ---

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

// --- View reading for a single feed ---

async function displayNewPostsFor (baseKeyHex) {
    const state = feeds.get(baseKeyHex)
    if (!state) return

    const { base } = state
    await base.update()

    while (state.lastSeq < base.view.length) {
        const post = await base.view.get(state.lastSeq)
        state.lastSeq++
        if (activeFeedKey === baseKeyHex) {
            appendPostToUI(post)
        }
    }
}

function setupBaseListeners (baseKeyHex) {
    const state = feeds.get(baseKeyHex)
    if (!state) return

    state.base.on('update', () => {
        displayNewPostsFor(baseKeyHex).catch((err) => console.error(err))
    })
}

// --- UI: select feed ---

function refreshFeedSelect () {
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
    const target = feeds.has(previous)
        ? previous
        : (activeFeedKey || [...feeds.keys()][0])

    feedSelect.value = target
}

function setActiveFeed (baseKeyHex) {
    if (!feeds.has(baseKeyHex)) return

    activeFeedKey = baseKeyHex
    currentKeySpan.textContent = baseKeyHex

    // reset UI e ricarica solo i post di questo feed
    postsDiv.innerHTML = ''
    const state = feeds.get(baseKeyHex)
    state.lastSeq = 0

    displayNewPostsFor(baseKeyHex).catch((err) => console.error(err))

    if (feedSelect.value !== baseKeyHex) {
        feedSelect.value = baseKeyHex
    }
    updateFollowersFromPeers()
}

// --- Feed's joining structure. Core part of the app. Here we manage to join various peers owned feeds ---

async function initFeed (bootstrapKeyBuffer, { makeHome = false } = {}) {
    await ensureWriterCore()

    const bootstrapHex = bootstrapKeyBuffer
        ? b4a.toString(bootstrapKeyBuffer, 'hex')
        : '(new feed)'
    console.log('[initFeed] bootstrap =', bootstrapHex)

    const isNew = !bootstrapKeyBuffer
    let baseStore
    let base
    let feedIdHex

    if (isNew) {
        // --- Case 1: Personal Feed ( Home ) ---
        // dedicated namespace for the home feed ensuring colliding free structure and functioning
        baseStore = store.namespace('home-base')

        base = new Autobase(baseStore, null, {
            open,
            apply,
            valueEncoding: 'json'
        })

        //await that the autobase is ready
        await base.ready()

        //add ourselves as writers
        const writerKeyHex = b4a.toString(writerCore.key, 'hex')
        console.log('[initFeed] new HOME base, addWriter =', writerKeyHex)
        await base.append({ addWriter: writerKeyHex })

        //swarm connection via discoveryKey
        const discovery = swarm.join(base.discoveryKey)
        await discovery.flushed()

        //autobase key = feed IDs
        feedIdHex = b4a.toString(base.key, 'hex')
    } else {
        // --- Case 2: existing feed join ( read-only ) ---
        // dedicated namespace for this feed, derived from its key
        const short = b4a.toString(bootstrapKeyBuffer, 'hex').slice(0, 16)
        baseStore = store.namespace('follow-' + short)

        base = new Autobase(baseStore, bootstrapKeyBuffer, {
            open,
            apply,
            valueEncoding: 'json'
        })

        //Synchronization between local and remote autobases
        await base.ready()

        //swarm connection on autobase's discoveryKey
        const discovery = swarm.join(base.discoveryKey)
        await discovery.flushed()

        //Official feedID = autobase's key ( equal to bootstrap )
        feedIdHex = b4a.toString(base.key, 'hex')
    }

    //various error logs, for avoiding bootstrap safe-lock, mismatching key usage or other autobase's errors
    base.on('error', (err) => {
        console.error('[autobase error]', feedIdHex, err)
    })

    console.log('[initFeed] feedIdHex =', feedIdHex)

    if (!feeds.has(feedIdHex)) {
        feeds.set(feedIdHex, { base, lastSeq: 0 })
        console.log('[initFeed] feed is now registered, feeds =', [...feeds.keys()])
        setupBaseListeners(feedIdHex)
        refreshFeedSelect()
        //updateFollowingCount()
    } else {
        console.log('[initFeed] known feed, reuse clause activated')
    }

    if (makeHome && !   homeFeedKey) {
        homeFeedKey = feedIdHex
        console.log('[initFeed] defined homeFeedKey =', homeFeedKey)
    }
    updateFollowingCount()
    return feedIdHex
}


// ---  High-level Handlers ---

//Function for creating the feed and putting it as the "Active" feed from a viewer standpoint
async function createFeed () {
    setupDiv.classList.add('hidden')
    loadingDiv.classList.remove('hidden')

    try {
        const baseKeyHex = await initFeed(null, { makeHome: true })

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

// function for joining other feeds
async function joinAdditionalFeed () {
    const keyStr = addFeedInput.value.trim()
    if (!keyStr) return

    console.log('[joinAdditionalFeed] join feed key request done =', keyStr)

    if (feeds.has(keyStr)) {
        console.log('[joinAdditionalFeed] known feed, we can just select it')
        setActiveFeed(keyStr)
        addFeedInput.value = ''
        return
    }

    try {
        const bootstrapBuffer = b4a.from(keyStr, 'hex')
        const baseKeyHex = await initFeed(bootstrapBuffer, { makeHome: false })

        //If we want to automatically go to the newest joined feed we remove the comment on the following line:
        // setActiveFeed(baseKeyHex)
        //If now, we leave it as it is so we'll stay on the home feed and the joined feeds will be chosen via menu

        addFeedInput.value = ''
    } catch (err) {
        console.error(err)
        alert('Error in feed\'s joining. Peer not found or mismatched key.')
    }
}



//function linked to create new posts
async function onPostSubmit (e) {
    e.preventDefault()
    const text = postInput.value.trim()
    if (!text) return

    if (!homeFeedKey) {
        console.warn('[post] no homeFeedKey, I ignore')
        return
    }

    const state = feeds.get(homeFeedKey)
    if (!state) {
        console.warn('[post] homeFeedKey not present:', homeFeedKey)
        return
    }

    const { base } = state
    const feedName = document.getElementById('feed-name')?.value.trim() || ''
    const post = {
        text,
        author: nicknameSpan?.textContent || 'anon',
        timestamp: Date.now(),
        feed: feedName || null
    }

    await base.append(post)
    postInput.value = ''
    if (document.getElementById('feed-name')) {
        document.getElementById('feed-name').value = ''
    }
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
    if (value) setActiveFeed(value)
})