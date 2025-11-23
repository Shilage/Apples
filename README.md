# Apples – P2P Microblogging on Pear Runtime

Apples is a small peer-to-peer microblogging application (Twitter-style) built on top of the **Pear Runtime**, using **Corestore**, **Autobase**, and **Hyperswarm** to manage distributed feeds without any central server.

---

## Requirements

- OS: Windows / Linux / macOS  
- **Pear Runtime** installed  
  See official documentation / download page (section “Get Pear”).
- Internet connection for running tests between multiple peers.

No database or HTTP server needs to be installed manually: Pear manages local storage and replication.

---

## Running the app

From a terminal / command prompt, go to the project folder:

```bash
cd path/to/Apples
```

### Normal run

Launch the app with Pear:

```bash
pear run .
```

This starts Apples as a normal Pear app (no dev console).

### Development mode (with dev console)

To run in development mode and open the dev console:

```bash
pear run -d .
# or
pear run --dev .
```

In this mode you can open the developer tools (console, network, etc.), which is useful for debugging Autobase, replication and UI state.

---

## Quick usage

### 1. First screen – create your account

When the app opens:

1. Click **“Create account”**.
2. The app creates your personal **home feed**, and shows:
   - a **profile avatar box** on the left  
     - click it to choose a local image file;
   - an auto-generated **nickname** (two words + a number, similar to Reddit);
   - two counters:
     - **Subscribers** – peers currently connected to your home feed;
     - **Subscribed to** – number of other feeds you follow.

Your identity (nickname + avatar) is local to your device and not synced over the network.

---

### 2. Writing posts

In the right column (main feed area):

1. In the *“Feed name”* field you can set a label for the thread (e.g. `main`, `tech`, `personal`).
2. In the bottom input field type your message.
3. Press **“Send”**.

All posts are **always appended to your home feed** (your personal Autobase).  
Other peers who follow your feed will see these posts replicated in their timeline.

---

### 3. Following another feed

To follow someone else’s feed:

1. On another node / machine, the other person opens Apples and clicks **“Create account”**.
2. That node obtains a **feed key** (hex string) for their home feed.
3. On your instance of Apples:
   - copy that feed key;
   - paste it into the *“Add feed key…”* input;
   - click **“Join feed”**.

What happens then:

- The external feed is added to the **“Active feeds”** dropdown.
- Selecting it from the dropdown shows the **remote timeline** (read-only).
- Your posts are still written only to **your** home feed; the external feed is never overwritten.

This mirrors the “follow” model:
- your home feed = your profile / timeline,
- followed feeds = other timelines you can read.

---

## Notes

- Application data (feeds, posts, Autobase metadata) are stored inside Pear’s app storage directory, in a folder dedicated to this app.
- The **avatar image** and **nickname** are stored in the webview’s `localStorage` under keys like:
  - `apples.avatar`
  - `apples.nickname`
- Avatar and nickname are **not replicated** to other peers: each device can have its own local representation of the same feed.
