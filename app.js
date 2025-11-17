// Microblog GUI using Pear Runtime, Corestore, Autobase and Hyperswarm.

/** @typedef {import('pear-interface')} */
/* global Pear */

import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Autobase from 'autobase'
import b4a from 'b4a'

const { teardown, updates, config } = Pear

console.log('Pear storage path:', config.storage)

// --- DOM ---

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
const postForm = document.getElementById('post-form')
const postInput = document.getElementById('post-text')

const feedSelect = document.getElementById('feed-select')
const addFeedInput = document.getElementById('add-feed-key')
const addFeedBtn = document.getElementById('add-feed-btn')

// --- Corestore + Swarm ---

const store = new Corestore(config.storage)
await store.ready()

const swarm = new Hyperswarm()
teardown(() => swarm.destroy())

swarm.on('connection', (conn) => store.replicate(conn))
swarm.on('update', () => {
    peersCountSpan.textContent = swarm.connections.size
})

// hot reload in dev
updates(() => Pear.reload())

// --- Writer identità ---

let writerCore = null

async function ensureWriterCore () {
    if (writerCore) return
    writerCore = store.get({ name: 'writer', valueEncoding: 'json' })
    await writerCore.ready()
}

// --- Multi-feed state ---
// baseKeyHex -> { base, lastSeq }
const feeds = new Map()
let activeFeedKey = null      // cosa sto guardando
let homeFeedKey = null        // dove scrivo i miei post

// --- Autobase handlers ---

function open (autostore) {
    return autostore.get({ name: 'view', valueEncoding: 'json' })
}

// robust apply: gestisce addWriter in vari formati e non lancia mai
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
                console.warn('apply: addWriter con formato non riconosciuto:', v)
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

// --- Lettura view per un singolo feed ---

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
}

// --- Creazione / join Autobase ---

async function initFeed (bootstrapKeyBuffer, { makeHome = false } = {}) {
    await ensureWriterCore()

    const bootstrapHex = bootstrapKeyBuffer
        ? b4a.toString(bootstrapKeyBuffer, 'hex')
        : '(nuovo feed)'
    console.log('[initFeed] bootstrap =', bootstrapHex)

    const isNew = !bootstrapKeyBuffer
    let base
    let feedIdHex

    if (isNew) {
        // --- CASO 1: NUOVO FEED PERSONALE (HOME) ---
        base = new Autobase(store, null, {
            open,
            apply,
            valueEncoding: 'json'
        })

        await base.ready()

        // aggiungiamo noi stessi come writer
        const writerKeyHex = b4a.toString(writerCore.key, 'hex')
        console.log('[initFeed] nuova base, addWriter =', writerKeyHex)
        await base.append({ addWriter: writerKeyHex })

        // topic = la feed key generata da Autobase
        const topic = base.key
        const discovery = swarm.join(topic)
        await discovery.flushed()

        feedIdHex = b4a.toString(base.key, 'hex')
    } else {
        // --- CASO 2: FEED ESTERNO (SOLO LETTURA) ---
        // qui la "feed key" CE L’HAI GIÀ: è bootstrapKeyBuffer
        base = new Autobase(store, bootstrapKeyBuffer, {
            open,
            apply,
            valueEncoding: 'json'
        })

        // usiamo direttamente la chiave che hai incollato come ID feed
        feedIdHex = b4a.toString(bootstrapKeyBuffer, 'hex')

        // partiamo SUBITO con la swarm su quella chiave
        const topic = bootstrapKeyBuffer
        const discovery = swarm.join(topic)
        await discovery.flushed()

        // e lasciamo che Autobase si sistemi in background
        base.ready().then(() => {
            console.log('[initFeed] ready (join) per', feedIdHex)
        }).catch((err) => {
            console.error('[initFeed] ready error (join) per', feedIdHex, err)
        })
    }

    console.log('[initFeed] feedIdHex =', feedIdHex)

    if (!feeds.has(feedIdHex)) {
        feeds.set(feedIdHex, { base, lastSeq: 0 })
        console.log('[initFeed] feed registrato, feeds =', [...feeds.keys()])
        setupBaseListeners(feedIdHex)
        refreshFeedSelect()
    } else {
        console.log('[initFeed] feed già noto, reuse')
    }

    if (makeHome && !homeFeedKey) {
        homeFeedKey = feedIdHex
        console.log('[initFeed] homeFeedKey impostata =', homeFeedKey)
    }

    return feedIdHex
}


// --- Handlers high-level ---

async function createFeed () {
    setupDiv.classList.add('hidden')
    loadingDiv.classList.remove('hidden')

    try {
        // nuova base: questa diventa la nostra HOME scrivibile
        const baseKeyHex = await initFeed(null, { makeHome: true })
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
        const baseKeyHex = await initFeed(bootstrapBuffer, { makeHome: false })
        loadingDiv.classList.add('hidden')
        feedDiv.classList.remove('hidden')
        setActiveFeed(baseKeyHex) // guardo quel feed, ma NON è home (solo lettura)
    } catch (err) {
        console.error(err)
        alert('Errore nell\'unione al feed. Chiave non valida o peer non trovato.')
        loadingDiv.classList.add('hidden')
        setupDiv.classList.remove('hidden')
    }
}

// join di un nuovo feed mentre l’app è già avviata
async function joinAdditionalFeed () {
    const keyStr = addFeedInput.value.trim()
    if (!keyStr) {
        alert('Inserisci una feed key completa (64 caratteri hex).')
        return
    }

    console.log('[joinAdditionalFeed] richiesta join feed key =', keyStr)
    addFeedInput.value = ''

    try {
        const bootstrapBuffer = b4a.from(keyStr, 'hex')

        const baseKeyHex = await initFeed(bootstrapBuffer, { makeHome: false })
        console.log('[joinAdditionalFeed] initFeed OK, baseKeyHex =', baseKeyHex)

        console.log('[joinAdditionalFeed] feeds attivi ora =', [...feeds.keys()])

        setActiveFeed(baseKeyHex)
        alert('Join riuscito. Ora stai seguendo il feed ' + baseKeyHex.slice(0, 16) + '…')
    } catch (err) {
        console.error('[joinAdditionalFeed] errore', err)
        alert('Errore nel join del nuovo feed. Controlla la chiave (64 hex) e riprova.')
    }
}



// post: scriviamo SEMPRE e SOLO sulla nostra HOME
async function onPostSubmit (e) {
    e.preventDefault()
    const text = postInput.value.trim()
    if (!text) return

    if (!homeFeedKey || !feeds.has(homeFeedKey)) {
        alert('Non hai ancora un feed personale (crea un feed con "Create").')
        return
    }

    const feedName = (feedNameInput?.value.trim() || 'main')
    postInput.value = ''

    try {
        await ensureWriterCore()
        const author = b4a.toString(writerCore.key, 'hex').substring(0, 6)
        const post = { feed: feedName, author, text, timestamp: Date.now() }

        const state = feeds.get(homeFeedKey)
        await state.base.append(post)
        await displayNewPostsFor(homeFeedKey)
    } catch (err) {
        console.error('Append failed', err)
        alert('Impossibile inviare il post')
    }
}

// --- Event listeners ---

createBtn.addEventListener('click', createFeed)
joinForm.addEventListener('submit', joinFeed)
postForm.addEventListener('submit', onPostSubmit)

addFeedBtn.addEventListener('click', (e) => {
    e.preventDefault()
    joinAdditionalFeed()
})

feedSelect.addEventListener('change', () => {
    const value = feedSelect.value
    if (value) setActiveFeed(value)
})