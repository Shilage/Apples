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
const postForm = document.getElementById('post-form')
const postInput = document.getElementById('post-text')
const feedNameInput = document.getElementById('feed-name')

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

// Global variables for the current writer core, base and state
let writerCore = null
let base = null
let lastSeq = 0

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
async function displayNewPosts () {
    if (!base || !base.view) return

    await base.update()

    while (lastSeq < base.view.length) {
        const post = await base.view.get(lastSeq)
        appendPostToUI(post)
        lastSeq++
    }
}

// Setup event listeners for Autobase updates
function setupBaseListeners () {
  base.on('update', () => {
    displayNewPosts().catch((err) => console.error(err))
  })
}

// Initialise writer core and Autobase, optionally joining an existing base
async function initFeed (bootstrapKeyBuffer) {
    // Create or load writer core
    writerCore = store.get({ name: 'writer', valueEncoding: 'json' })
    await writerCore.ready()

    // Create or join Autobase
    base = new Autobase(store, bootstrapKeyBuffer, {
        open,
        apply,
        valueEncoding: 'json'
    })
    await base.ready()

    // If new base, add ourselves as writer
    if (!bootstrapKeyBuffer) {
        // salviamo la chiave del writer come stringa hex
        const writerKeyHex = b4a.toString(writerCore.key, 'hex')
        await base.append({ addWriter: writerKeyHex })
    }

    // Join swarm on base.discoveryKey and replicate Corestore
    const discovery = swarm.join(base.discoveryKey)
    await discovery.flushed()

    // Mostriamo la chiave della base nella GUI
    const baseKeyHex = b4a.toString(base.key, 'hex')
    currentKeySpan.textContent = baseKeyHex

    setupBaseListeners()
    await displayNewPosts()
}

// Handle creating a new feed
async function createFeed () {
  setupDiv.classList.add('hidden')
  loadingDiv.classList.remove('hidden')
  try {
    await initFeed(null)
    loadingDiv.classList.add('hidden')
    feedDiv.classList.remove('hidden')
  } catch (err) {
    console.error(err)
    alert('Errore nella creazione del feed')
    loadingDiv.classList.add('hidden')
    setupDiv.classList.remove('hidden')
  }
}

// Handle joining an existing feed
async function joinFeed (e) {
  e.preventDefault()
  const keyStr = feedKeyInput.value.trim()
  if (!keyStr) return
  setupDiv.classList.add('hidden')
  loadingDiv.classList.remove('hidden')
  try {
    const bootstrapBuffer = b4a.from(keyStr, 'hex')
    await initFeed(bootstrapBuffer)
    loadingDiv.classList.add('hidden')
    feedDiv.classList.remove('hidden')
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

    const feedName = (feedNameInput.value.trim() || 'main')

    postInput.value = ''
    try {
        const author = b4a.toString(writerCore.key, 'hex').substring(0, 6)
        const post = { feed: feedName, author, text, timestamp: Date.now() }
        await base.append(post)
        await displayNewPosts()
    } catch (err) {
        console.error('Append failed', err)
        alert('Impossibile inviare il post')
    }
}

// Attach event listeners to UI elements
createBtn.addEventListener('click', createFeed)
joinForm.addEventListener('submit', joinFeed)
postForm.addEventListener('submit', onPostSubmit)

// Optional: hot reload during development
updates(() => Pear.reload())