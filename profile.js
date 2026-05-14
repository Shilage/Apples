// profile.js - Nickname, avatar and stats management

const nicknameSpan = document.getElementById('nickname')
const followersSpan = document.getElementById('followers-count')
const followingSpan = document.getElementById('following-count')
const avatarBox = document.getElementById('avatar-placeholder')
const avatarInput = document.getElementById('avatar-input')

function generateRandomNickname () {
    const adjectives = ['Silent', 'Happy', 'Cosmic', 'Neon', 'Swift', 'Lucky', 'Clever', 'Velvet', 'Rusty', 'Quantum']
    const nouns = ['Apple', 'Sentry', 'Comet', 'Circuit', 'Panda', 'Falcon', 'Pixel', 'Nova', 'Echo', 'Forest']
    const a = adjectives[Math.floor(Math.random() * adjectives.length)]
    const n = nouns[Math.floor(Math.random() * nouns.length)]
    const num = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    return `${a}-${n}${num}`
}

export function getNickname () {
    return nicknameSpan?.textContent || 'anon'
}

export function setupProfile () {
    let nick = null
    try { nick = localStorage.getItem('apples.nickname') } catch (_) {}

    if (!nick) {
        nick = generateRandomNickname()
        try { localStorage.setItem('apples.nickname', nick) } catch (_) {}
    }

    if (nicknameSpan) nicknameSpan.textContent = nick

    try {
        const avatarData = localStorage.getItem('apples.avatar')
        if (avatarData && avatarBox) {
            avatarBox.style.backgroundImage = `url(${avatarData})`
        }
    } catch (_) {}
}

export function setupAvatarUpload () {
    if (!avatarBox || !avatarInput) return

    avatarBox.addEventListener('click', () => avatarInput.click())

    avatarInput.addEventListener('change', (e) => {
        const file = e.target.files[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
            const dataUrl = ev.target.result
            avatarBox.style.backgroundImage = `url(${dataUrl})`
            try { localStorage.setItem('apples.avatar', dataUrl) } catch (_) {}
        }
        reader.readAsDataURL(file)
    })
}

export function updateFollowingCount (feeds, homeFeedKey) {
    if (!followingSpan) return
    let count = 0
    for (const key of feeds.keys()) {
        if (homeFeedKey && key === homeFeedKey) continue
        count++
    }
    followingSpan.textContent = String(count)
}

export function updateFollowersFromPeers (swarm, homeFeedKey, activeFeedKey) {
    if (!followersSpan || !swarm) {
        console.log('[FOLLOWERS] skip:', { hasSpan: !!followersSpan, hasSwarm: !!swarm })
        return
    }

    const connCount = swarm.connections.size
    console.log('[FOLLOWERS] update:', {
        connections: connCount,
        homeFeedKey: homeFeedKey ? homeFeedKey.slice(0, 16) + '...' : null,
        activeFeedKey: activeFeedKey ? activeFeedKey.slice(0, 16) + '...' : null,
        stackHint: new Error().stack.split('\n')[2]?.trim()
    })

    followersSpan.textContent = String(connCount)
}
