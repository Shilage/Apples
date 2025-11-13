// Microblog GUI using Pear Runtime, Corestore, Autobase and Hyperswarm.
// This script is loaded in the browser context of the Pear desktop app.

/** @typedef {import('pear-interface')} */
/* global Pear */

import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Autobase from 'autobase'
import b4a from 'b4a'

const { teardown, updates, config } = Pear

// Grab DOM elements
const setupDiv = document.getElementById('setup')
const loadingDiv = document.getElementById('loading')
const feedDiv = document.getElementById('feed')
const postsDiv = document.getElementById('posts')
const peersCountSpan = document.getElementById('peers-count')
const currentKeySpan = document.getElementById('current-key')
const createBtn = document.getElementById('create-feed')
const joinForm = document.getElementById('join-form')
const feedKeyInput = document.getElementById('feed-key')
const feedNameInput = document.getElementById('feed-name')
const feedSelect = document.getElementById('feed-select')
const postForm = document.getElementById('post-form')
const postInput = document.getElementById('post-text')
const addFeedForm = document.getElementById('add-feed-form')
const addFeedKeyInput = document.getElementById('add-feed-key')


// Initialise Corestore and Hyperswarm
const store = new Corestore(config.storage)
await store.ready()
const swarm = new Hyperswarm()
// Clean up on exit
teardown(() => swarm.destroy())
console.log('Pear storage path:', config.storage)

swarm.on('connection', (conn) => {
    // replica tutti i core (inclusi quelli usati da Autobase) su questa connessione
    store.replicate(conn)
})

// Aggiornamento numero peer
swarm.on('update', () => {
    peersCountSpan.textContent = swarm.connections.size
})
// writer "identità" unica
let writerCore = null
async function ensureWriterCore () {
    if (writerCore) return
    writerCore = store.get({ name: 'writer', valueEncoding: 'json' })
    await writerCore.ready()
}

// multi-feed: baseKeyHex → { base, lastSeq }
const feeds = new Map()
let activeFeedKey = null

// Open handler for Autobase: returns a Hypercore to store the view of posts
function open (autostore) {
  return autostore.get({ name: 'view', valueEncoding: 'json' })
}

// Apply handler for Autobase: append values to the view and handle addWriter messages
async function apply (nodes, view, host) {
    for (const { value } of nodes) {
        if (!value) continue

        if (value.addWriter) {
            let writerKeyBuf = null
            const v = value.addWriter

            if (typeof v === 'string') {
                // nuovo formato: chiave del writer in esadecimale
                writerKeyBuf = b4a.from(v, 'hex')
            } else if (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
                // vecchio formato JSONizzato di un Buffer: { type: 'Buffer', data: [...] }
                writerKeyBuf = b4a.from(v.data)
            } else if (v instanceof Uint8Array) {
                // già un buffer/Uint8Array
                writerKeyBuf = b4a.from(v)
            }

            if (writerKeyBuf) {
                await host.addWriter(writerKeyBuf, { indexer: true })
            } else {
                console.warn('apply: addWriter con formato non riconosciuto:', v)
            }
            continue
        }

        // normali post del microblog
        await view.append(value)
    }
}

// Show a message in the posts div
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

// Display any new posts since lastSeq
async function displayNewPostsFor (baseKeyHex) {
    const feedState = feeds.get(baseKeyHex)
    if (!feedState) return

    const { base } = feedState

    // è l'Autobase che aggiorna la view
    await base.update()

    while (feedState.lastSeq < base.view.length) {
        const post = await base.view.get(feedState.lastSeq)
        feedState.lastSeq++

        // renderizza solo se questo feed è quello attivo
        if (activeFeedKey === baseKeyHex) {
            appendPostToUI(post)
        }
    }
}

// Setup event listeners for Autobase updates
function setupBaseListeners (baseKeyHex) {
    const feedState = feeds.get(baseKeyHex)
    if (!feedState) return

    feedState.base.on('update', () => {
        displayNewPostsFor(baseKeyHex).catch((err) => console.error(err))
    })
}

// Initialise writer core and Autobase, optionally joining an existing base
async function initFeed (bootstrapKeyBuffer) {
    await ensureWriterCore()

    const base = new Autobase(store, bootstrapKeyBuffer, {
        open,
        apply,
        valueEncoding: 'json'
    })
    await base.ready()

    // se è una nuova base, appendiamo il messaggio addWriter
    if (!bootstrapKeyBuffer) {
        const writerKeyHex = b4a.toString(writerCore.key, 'hex')
        await base.append({ addWriter: writerKeyHex })
    }

    // join sul discoveryKey della base
    const discovery = swarm.join(base.discoveryKey)
    await discovery.flushed()

    const baseKeyHex = b4a.toString(base.key, 'hex')

    // registra la base nella mappa se non c'è già
    if (!feeds.has(baseKeyHex)) {
        feeds.set(baseKeyHex, { base, lastSeq: 0 })
        setupBaseListeners(baseKeyHex)
        refreshFeedSelect()
    }

    return baseKeyHex
}

async function createFeed () {
    setupDiv.classList.add('hidden')
    loadingDiv.classList.remove('hidden')

    try {
        const baseKeyHex = await initFeed(null)
        loadingDiv.classList.add('hidden')
        feedDiv.classList.remove('hidden')
        setActiveFeed(baseKeyHex)
    } catch (err) {
        console.error(err)
        alert('Errore nella creazione del feed')
        loadingDiv.classList.add('hidden')
        setupDiv.classList.remove('hidden')
    }
}

async function joinFeed (e) {
    e.preventDefault()
    const keyStr = feedKeyInput.value.trim()
    if (!keyStr) return

    setupDiv.classList.add('hidden')
    loadingDiv.classList.remove('hidden')

    try {
        const bootstrapBuffer = b4a.from(keyStr, 'hex')
        const baseKeyHex = await initFeed(bootstrapBuffer)
        loadingDiv.classList.add('hidden')
        feedDiv.classList.remove('hidden')
        setActiveFeed(baseKeyHex)
    } catch (err) {
        console.error(err)
        alert('Errore nell\'unione al feed. Chiave non valida o peer non trovato.')
        loadingDiv.classList.add('hidden')
        setupDiv.classList.remove('hidden')
    }
}
// Handle posting a new message
async function onPostSubmit (e) {
    e.preventDefault()
    const text = postInput.value.trim()
    if (!text) return

    if (!activeFeedKey || !feeds.has(activeFeedKey)) {
        alert('Nessun feed attivo')
        return
    }

    const feedName = (feedNameInput?.value.trim() || 'main')
    postInput.value = ''

    try {
        await ensureWriterCore()
        const author = b4a.toString(writerCore.key, 'hex').substring(0, 6)
        const post = { feed: feedName, author, text, timestamp: Date.now() }

        const feedState = feeds.get(activeFeedKey)
        await feedState.base.append(post)
        await displayNewPostsFor(activeFeedKey)
    } catch (err) {
        console.error('Append failed', err)
        alert('Impossibile inviare il post')
    }
}

function refreshFeedSelect () {
    const prev = feedSelect.value
    feedSelect.innerHTML = ''

    for (const keyHex of feeds.keys()) {
        const opt = document.createElement('option')
        opt.value = keyHex
        opt.textContent = keyHex.slice(0, 16) + '…'
        opt.title = keyHex
        feedSelect.appendChild(opt)
    }

    if (feeds.size === 0) {
        feedSelect.disabled = true
        return
    }

    feedSelect.disabled = false
    const target = feeds.has(prev) ? prev : [...feeds.keys()][0]
    feedSelect.value = target
}

function setActiveFeed (baseKeyHex) {
    if (!feeds.has(baseKeyHex)) return

    activeFeedKey = baseKeyHex
    currentKeySpan.textContent = baseKeyHex

    // reset UI e ricarica i post di quel feed
    postsDiv.innerHTML = ''
    const feedState = feeds.get(baseKeyHex)
    feedState.lastSeq = 0
    displayNewPostsFor(baseKeyHex).catch((err) => console.error(err))

    if (feedSelect.value !== baseKeyHex) {
        feedSelect.value = baseKeyHex
    }
}
async function joinAdditionalFeed (e) {
    e.preventDefault()
    const keyStr = addFeedKeyInput.value.trim()
    if (!keyStr) return

    addFeedKeyInput.value = ''

    try {
        const bootstrapBuffer = b4a.from(keyStr, 'hex')
        // riutilizziamo initFeed: crea/join la base e la registra in feeds
        const baseKeyHex = await initFeed(bootstrapBuffer)

        // la base potrebbe già esistere (se hai messo due volte la stessa chiave),
        // ma initFeed la gestisce. In ogni caso la rendiamo attiva.
        setActiveFeed(baseKeyHex)
    } catch (err) {
        console.error(err)
        alert('Errore nel join del nuovo feed. Chiave non valida o peer non trovato.')
    }
}


// Attach event listeners to UI elements
createBtn.addEventListener('click', createFeed)
joinForm.addEventListener('submit', joinFeed)
postForm.addEventListener('submit', onPostSubmit)
feedSelect.addEventListener('change', () => {
    const value = feedSelect.value
    if (value) setActiveFeed(value)
})
createBtn.addEventListener('click', createFeed)
joinForm.addEventListener('submit', joinFeed)
addFeedForm.addEventListener('submit', joinAdditionalFeed)

// Optional: hot reload during development
updates(() => Pear.reload())